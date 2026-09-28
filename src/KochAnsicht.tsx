import { useEffect, useState } from 'react';
import type { EntnahmePosten } from '../supabase/functions/_shared/kombi/aktionen.ts';
import { entnahmeText, kochAnsicht, kochenBestaetigen } from '../supabase/functions/_shared/kombi/aktionen.ts';
import type { FehlendeZutat, Gericht } from '../supabase/functions/_shared/kombi/typen.ts';
import type { Naehrwerte } from '../supabase/functions/_shared/kombi/naehrwerte.ts';
import { euroText } from '../supabase/functions/_shared/kombi/kosten.ts';
import * as api from './api';
import { fehlerText, type Sorte } from './api';
import { essen, essenRueckgaengig, kochen, kochenRueckgaengig } from './haushalt';
import { Blatt, useScrollSperre } from './Blatt';
import { Icon } from './Icon';
import { euroKurz, kcalKurz, mengeText } from './format';
import { PostenListe } from './PostenListe';
import { Bild } from './Bild';

type Props = {
  gericht: Gericht;
  naehrwerte: Naehrwerte;
  /** gekocht wird eine geplante Mahlzeit → Plan wird erledigt */
  planId: string | null;
  bestand: Sorte[];
  /** was andere Pläne schon reserviert haben */
  reserviert: Map<number, { menge: number; plaene: string[] }>;
  /** Migration „planung_einkauf“: eine Buchung für alles (sonst nacheinander) */
  planung: boolean;
  /** Migration „kosten_naehrwerte“: Kosten und kcal der Mahlzeit werden festgehalten */
  protokoll: boolean;
  onGekocht: () => void;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void;
  onFehlendesMerken?: (fehlt: FehlendeZutat[]) => Promise<void>;
  onSchliessen: () => void;
};

type Gebucht = { text: string; rueck: () => Promise<unknown>; danach: { name: string; text: string }[]; wert: string | null; warnung: string | null };

/**
 * „Heute kochen“: groß und übersichtlich. Anzeigen ändert nichts – erst „Kochen starten“ und die
 * Bestätigung entnehmen aus dem Vorrat (geöffnet → Ablauf → älteste), dann Kochmodus.
 */
export function KochAnsicht({ gericht: g, naehrwerte: n, planId, bestand, reserviert, planung, protokoll, onGekocht, onMeldung, onFehlendesMerken, onSchliessen }: Props) {
  const [stufe, setStufe] = useState<'ansicht' | 'bestaetigen' | 'kochen'>('ansicht');
  const daten = kochAnsicht(g, bestand, reserviert);
  const [posten, setPosten] = useState<EntnahmePosten[]>(daten.posten);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gebucht, setGebucht] = useState<Gebucht | null>(null);
  const [erledigt, setErledigt] = useState<Set<number>>(new Set());
  const [gemerkt, setGemerkt] = useState(false);

  useScrollSperre();
  // Beim Kochen soll das Display anbleiben (wo der Browser es kann).
  useEffect(() => {
    if (stufe !== 'kochen' || !('wakeLock' in navigator)) return;
    let sperre: WakeLockSentinel | null = null;
    let aktiv = true;
    navigator.wakeLock.request('screen').then((s) => {
      if (aktiv) sperre = s;
      else void s.release();
    }).catch(() => undefined);
    return () => {
      aktiv = false;
      void sperre?.release().catch(() => undefined);
    };
  }, [stufe]);
  useEffect(() => {
    const beiTaste = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stufe === 'ansicht') onSchliessen();
    };
    window.addEventListener('keydown', beiTaste);
    return () => window.removeEventListener('keydown', beiTaste);
  }, [stufe, onSchliessen]);

  const sorteVon = (id: number) => bestand.find((s) => s.id === id);
  const aktiv = posten.filter((p) => p.menge > 0);

  async function buchen() {
    setLaeuft(true);
    setFehler(null);
    try {
      let rueck: () => Promise<unknown>;
      let warnung: string | null = null;
      let wert: string | null = null;
      if (protokoll) {
        // eine Transaktion – und der tatsächliche Wert der entnommenen Chargen wird festgehalten
        const e = await essen(aktiv, planId, g.name, g.portionen);
        rueck = () => essenRueckgaengig(e.mahlzeit_id);
        if (e.kosten_cent !== null) wert = `${e.kosten_unbekannt ? 'ab ' : ''}${euroText(e.kosten_cent)} aus dem Vorrat`;
      } else if (planung) {
        const ids = await kochen(aktiv, planId);
        rueck = () => kochenRueckgaengig(ids, planId);
      } else {
        const e = await kochenBestaetigen(aktiv, { entnehmen: api.entnehmen });
        if (e.bewegungIds.length === 0 && e.fehler.length) throw new Error(e.fehler.map((f) => `${f.name}: ${f.meldung}`).join(' '));
        if (e.fehler.length) warnung = `Nicht entnommen: ${e.fehler.map((f) => `${f.name} (${f.meldung})`).join(', ')}`;
        rueck = () => api.rueckgaengig(e.bewegungIds);
      }
      const danach = aktiv.map((p) => {
        const rest = Math.max(0, (sorteVon(p.block_typ_id)?.anzahl ?? 0) - p.menge);
        return { name: p.name, text: rest === 0 ? 'aufgebraucht' : `${mengeText(rest, p.einheit)} übrig` };
      });
      setGebucht({ text: entnahmeText(aktiv), rueck, danach, wert, warnung });
      setStufe('kochen');
      onGekocht();
    } catch (e) {
      setFehler(fehlerText(e));
    } finally {
      setLaeuft(false);
    }
  }

  async function rueckgaengig() {
    if (!gebucht) return;
    setLaeuft(true);
    try {
      await gebucht.rueck();
      setGebucht(null);
      setStufe('ansicht');
      onMeldung('Rückgängig gemacht – alles ist wieder im Vorrat.');
      onGekocht();
    } catch (e) {
      onMeldung(fehlerText(e));
    } finally {
      setLaeuft(false);
    }
  }

  function fertig() {
    if (gebucht) onMeldung(`Guten Appetit! Entnommen: ${gebucht.text}.`, gebucht.rueck);
    onSchliessen();
  }

  async function merken() {
    if (!onFehlendesMerken) return;
    try {
      await onFehlendesMerken(g.fehlt);
      setGemerkt(true);
    } catch (e) {
      setFehler(fehlerText(e));
    }
  }

  const farbe = g.zutaten.find((z) => z.farbe)?.farbe ?? 'neutral';
  const zeilen = daten.zeilen.filter((z) => z.quelle !== 'grundausstattung');
  const grund = daten.zeilen.filter((z) => z.quelle === 'grundausstattung').map((z) => z.name);
  const UNBEKANNT = /^Zusammensetzung von (.+) unbekannt\.?$/;
  const unbekannt = daten.hinweise.map((h) => UNBEKANNT.exec(h)?.[1]).filter((x): x is string => !!x);
  const hinweise = daten.hinweise.filter((h) => !UNBEKANNT.test(h)).slice(0, 2);
  const kochmodus = stufe === 'kochen';
  const makros = [
    n.protein_g !== null ? `${n.protein_g.toLocaleString('de-DE')} g Eiweiß` : null,
    n.kohlenhydrate_g !== null ? `${n.kohlenhydrate_g.toLocaleString('de-DE')} g Kohlenhydrate` : null,
    n.fett_g !== null ? `${n.fett_g.toLocaleString('de-DE')} g Fett` : null,
  ].filter(Boolean);

  const zustand = (z: (typeof zeilen)[number]) => {
    switch (z.status) {
      case 'zu_wenig': return <span className="status-achtung">nur {mengeText(z.verfuegbar!, z.einheit)} da</span>;
      case 'leer': return <span className="status-kritisch">schon aufgebraucht</span>;
      case 'unbekannt': return <span className="status-kritisch">nicht mehr im Vorrat</span>;
      case 'frei': return <span>Kühlschrank-Rest</span>;
      default: return null;
    }
  };

  return (
    <div className={`kochen${kochmodus ? ' kochmodus' : ''}`} role="dialog" aria-modal="true" aria-label={`${g.name} kochen`}>
      <div className="kochen-leiste">
        <button type="button" className="icon-knopf" onClick={kochmodus ? fertig : onSchliessen} aria-label="Zurück">
          <Icon name="zurueck" />
        </button>
        <span>{kochmodus ? 'Kochmodus' : 'Heute kochen'}</span>
        <span className="platz" />
      </div>

      <div className="kochen-inhalt">
        <header className="kochen-kopf">
          {!kochmodus && <div className="kochen-foto"><Bild name={g.name} emoji={g.emoji} farbe={farbe === 'neutral' ? null : farbe} art="flaeche" /></div>}
          <h1>{g.name}</h1>
          <p className="meta-icons">
            <span><Icon name="uhr" groesse={18} /> {g.zeit_min} Min</span>
            <span><Icon name="flamme" groesse={18} className="flamme" /> {kcalKurz(n)}{n.kcal_portion !== null ? ' / Portion' : ''}</span>
            <span><Icon name="preis" groesse={18} /> {euroKurz(g.kosten)}{g.kosten.pro_portion_cent !== null ? ' / Portion' : ''}</span>
          </p>
          {!kochmodus && g.beschreibung && <p className="leise klein">{g.beschreibung}</p>}
          {!kochmodus && hinweise.map((h) => (
            <p key={h} className="kochen-hinweis"><Icon name="info" groesse={15} /> {h}</p>
          ))}
        </header>

        {gebucht && (
          <div className="erfolg abstand-oben" role="status">
            <Icon name="haken" groesse={22} />
            <span>
              <strong>Aus dem Vorrat entnommen</strong>
              <small>{gebucht.text}{gebucht.wert ? ` · ${gebucht.wert}` : ''}</small>
              {gebucht.warnung && <small className="status-achtung">{gebucht.warnung}</small>}
            </span>
            <button type="button" className="link" onClick={() => void rueckgaengig()} disabled={laeuft}>Rückgängig</button>
          </div>
        )}

        {!kochmodus && (
          <section className="abschnitt">
            <div className="abschnitt-kopf"><h2>Deine Zutaten</h2></div>
            <ul className="liste">
              {zeilen.map((z, i) => (
                <li key={`${z.name}-${i}`} className={`f-${z.farbe ?? 'kuehlschrank'}`}>
                  <div className="zeile">
                    <span className="punkt" aria-hidden="true" />
                    <span className="zeile-haupt">
                      <span className="zeile-titel">{z.name}</span>
                      {zustand(z) && <span className="zeile-meta">{zustand(z)}</span>}
                    </span>
                    {z.menge !== null && <span className="menge-rechts">{mengeText(z.menge, z.einheit)}</span>}
                  </div>
                </li>
              ))}
            </ul>
            {(grund.length > 0 || unbekannt.length > 0) && (
              <p className="abschnitt-fuss">
                {grund.length > 0 && `Außerdem: ${grund.join(', ')}. `}
                {unbekannt.length > 0 && `Zusammensetzung unbekannt: ${unbekannt.join(', ')} – Kombi erfindet nichts dazu.`}
              </p>
            )}
          </section>
        )}

        {!kochmodus && g.fehlt.length > 0 && (
          <section className="abschnitt">
            <div className="abschnitt-kopf"><h2>Fehlt</h2></div>
            <ul className="liste">
              {g.fehlt.map((f) => (
                <li key={f.name}>
                  <div className="zeile">
                    <span className="zeile-haupt"><span className="zeile-titel">{f.name}</span></span>
                    {f.menge !== null && f.einheit && <span className="menge-rechts">{mengeText(f.menge, f.einheit)}</span>}
                  </div>
                </li>
              ))}
            </ul>
            {planung && (planId ? (
              <p className="abschnitt-fuss">Steht für diese geplante Mahlzeit schon auf der Einkaufsliste.</p>
            ) : onFehlendesMerken && (
              <button type="button" className="knopf breit abstand-oben" onClick={() => void merken()} disabled={gemerkt}>
                <Icon name={gemerkt ? 'haken' : 'wagen'} groesse={18} /> {gemerkt ? 'Steht auf der Einkaufsliste' : 'Auf die Einkaufsliste'}
              </button>
            ))}
          </section>
        )}

        {g.schritte.length > 0 && (
          <section className="abschnitt">
            <div className="abschnitt-kopf"><h2>Zubereitung</h2></div>
            <ol className="schritte">
              {g.schritte.map((s, i) => (
                <li key={i} className={erledigt.has(i) ? 'erledigt' : ''}>
                  <button
                    type="button"
                    aria-pressed={erledigt.has(i)}
                    onClick={() => setErledigt((alt) => {
                      const neu = new Set(alt);
                      if (neu.has(i)) neu.delete(i);
                      else neu.add(i);
                      return neu;
                    })}
                  >
                    <span className="schritt-nr">{erledigt.has(i) ? <Icon name="haken" groesse={15} /> : i + 1}</span>
                    <span>{s}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        {gebucht && gebucht.danach.length > 0 && (
          <section className="abschnitt">
            <div className="abschnitt-kopf"><h2>Im Vorrat bleibt</h2></div>
            <ul className="liste">
              {gebucht.danach.map((d) => (
                <li key={d.name}><div className="zeile"><span className="zeile-haupt"><span className="zeile-titel">{d.name}</span></span><span className="zeile-wert">{d.text}</span></div></li>
              ))}
            </ul>
          </section>
        )}

        {!kochmodus && (
          <details className="mehr abstand-oben">
            <summary>Nährwerte und Kosten</summary>
            <div className="info-zeilen">
              <div className="info-zeile"><span>Kalorien je Portion</span><span>{n.kcal_portion === null ? 'unbekannt' : kcalKurz(n)}</span></div>
              {makros.length > 0 && <div className="info-zeile"><span>je Portion</span><span>{makros.join(' · ')}</span></div>}
              <div className="info-zeile"><span>Wert aus dem Vorrat</span><span>{g.kosten.gesamt_cent === null ? 'unbekannt' : `${g.kosten.status === 'teilweise' ? 'ab ' : ''}${euroText(g.kosten.gesamt_cent)}`}</span></div>
            </div>
            <p className="meta-text">
              Nur aus hinterlegten Nährwerten und Preisen – nichts geschätzt.
              {n.unbekannt.length > 0 && ` Ohne Nährwerte: ${n.unbekannt.join(', ')}.`}
              {g.kosten.unbekannt.length > 0 && ` Ohne Preis: ${g.kosten.unbekannt.join(', ')}.`}
            </p>
          </details>
        )}
        {fehler && stufe !== 'bestaetigen' && <p className="fehlerbox abstand-oben">{fehler}</p>}
      </div>

      <div className="kochen-unten">
        {kochmodus ? (
          <button type="button" className="knopf haupt" onClick={fertig}><Icon name="haken" /> Fertig</button>
        ) : daten.kann_kochen ? (
          <button type="button" className="knopf haupt" onClick={() => { setFehler(null); setPosten(daten.posten); setStufe('bestaetigen'); }}>
            <Icon name="pfanne" /> Kochen starten
          </button>
        ) : (
          <button type="button" className="knopf haupt" onClick={() => setStufe('kochen')}>
            <Icon name="pfanne" /> Ohne Entnahme kochen
          </button>
        )}
      </div>

      {stufe === 'bestaetigen' && (
        <Blatt titel="Aus dem Vorrat entnehmen?" untertitel={entnahmeText(aktiv)} onSchliessen={() => setStufe('ansicht')}>
          <PostenListe posten={posten} bestand={bestand} onAendern={setPosten} />
          <p className="abschnitt-fuss">Zuerst Geöffnetes, dann was am frühesten abläuft.{planung ? ' Klappt etwas nicht, wird nichts gebucht.' : ''}</p>
          {fehler && <p className="fehlertext">{fehler}</p>}
          <div className="abschnitt">
            <button type="button" className="knopf haupt" disabled={laeuft || aktiv.length === 0} onClick={() => void buchen()}>
              {laeuft ? 'Entnehme …' : 'Entnehmen & loslegen'}
            </button>
            <button type="button" className="link breit" onClick={() => setStufe('ansicht')}>Abbrechen</button>
          </div>
        </Blatt>
      )}
    </div>
  );
}
