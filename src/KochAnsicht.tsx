import { useEffect, useState, type CSSProperties } from 'react';
import type { EntnahmePosten } from '../supabase/functions/_shared/kombi/aktionen.ts';
import { entnahmeText, kochAnsicht, kochenBestaetigen, kurzMenge, type KochZeile } from '../supabase/functions/_shared/kombi/aktionen.ts';
import type { FehlendeZutat, Gericht } from '../supabase/functions/_shared/kombi/typen.ts';
import { euroText } from '../supabase/functions/_shared/kombi/kosten.ts';
import * as api from './api';
import { fehlerText, type Sorte } from './api';
import { kochen, kochenRueckgaengig } from './haushalt';
import { Blatt, useScrollSperre } from './Blatt';
import { Icon } from './Icon';
import { mengeText } from './format';
import { PostenListe } from './PostenListe';

type Props = {
  gericht: Gericht;
  /** gekocht wird eine geplante Mahlzeit → Plan wird erledigt */
  planId: string | null;
  bestand: Sorte[];
  /** was andere Pläne schon reserviert haben */
  reserviert: Map<number, { menge: number; plaene: string[] }>;
  /** Migration „planung_einkauf“: eine Buchung für alles (sonst nacheinander) */
  planung: boolean;
  onGekocht: () => void;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void;
  onFehlendesMerken?: (fehlt: FehlendeZutat[]) => Promise<void>;
  onSchliessen: () => void;
};

type Gebucht = { text: string; rueck: () => Promise<unknown>; danach: { name: string; text: string }[]; warnung: string | null };

function zeilenStatus(z: KochZeile): string {
  switch (z.status) {
    case 'ok':
      return `da: ${mengeText(z.verfuegbar!, z.einheit)} · danach ${mengeText(z.danach!, z.einheit)}`;
    case 'zu_wenig':
      return `nur ${mengeText(z.verfuegbar!, z.einheit)} da`;
    case 'leer':
      return 'schon aufgebraucht';
    case 'unbekannt':
      return 'nicht mehr im Vorrat';
    default:
      return z.quelle === 'kuehlschrank' ? 'Kühlschrank-Rest · wird nicht gebucht' : 'immer da';
  }
}

/**
 * „Heute kochen“ als eigene Ansicht: groß, übersichtlich, mit den echten Vorratsobjekten.
 * Ablauf: ansehen → „Kochen starten“ → Entnahme bestätigen → buchen (geöffnet → Ablauf → älteste) → Kochmodus.
 */
export function KochAnsicht({ gericht: g, planId, bestand, reserviert, planung, onGekocht, onMeldung, onFehlendesMerken, onSchliessen }: Props) {
  const [stufe, setStufe] = useState<'ansicht' | 'bestaetigen' | 'kochen'>('ansicht');
  const daten = kochAnsicht(g, bestand, reserviert);
  const [posten, setPosten] = useState<EntnahmePosten[]>(daten.posten);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gebucht, setGebucht] = useState<Gebucht | null>(null);
  const [erledigt, setErledigt] = useState<Set<number>>(new Set());
  const [gemerkt, setGemerkt] = useState(false);

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

  useScrollSperre();
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
      if (planung) {
        // eine Transaktion: alles oder nichts
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
      setGebucht({ text: entnahmeText(aktiv), rueck, danach, warnung });
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

  const farben = [...new Set(g.zutaten.filter((z) => z.farbe).map((z) => z.farbe))];
  const stil = { '--a': `var(--tint-${farben[0] ?? 'neutral'})`, '--b': `var(--tint-${farben[1] ?? farben[0] ?? 'neutral'})` } as CSSProperties;
  const zeilen = daten.zeilen.filter((z) => z.quelle !== 'grundausstattung');
  const grund = daten.zeilen.filter((z) => z.quelle === 'grundausstattung').map((z) => z.name);
  const UNBEKANNT = /^Zusammensetzung von (.+) unbekannt\.?$/;
  const unbekannt = daten.hinweise.map((h) => UNBEKANNT.exec(h)?.[1]).filter((n): n is string => !!n);
  const gruende = daten.hinweise.filter((h) => !UNBEKANNT.test(h));
  const probleme = zeilen.filter((z) => z.status === 'zu_wenig' || z.status === 'leer' || z.status === 'unbekannt').length;
  const kosten = g.kosten;

  return (
    <div className={`koch-ansicht stufe-${stufe}`} role="dialog" aria-modal="true" aria-label={`${g.name} kochen`}>
      <header className="koch-kopf">
        <button type="button" className="icon-knopf" onClick={stufe === 'kochen' ? fertig : onSchliessen} aria-label="Zurück">
          <Icon name="zurueck" />
        </button>
        <span>{stufe === 'kochen' ? 'Kochmodus' : 'Heute kochen'}</span>
        <span className="koch-kopf-platz" />
      </header>

      <div className="koch-inhalt">
        <div className="koch-hero" style={stil}>
          <span aria-hidden="true">{g.emoji}</span>
          {g.gerichtsart !== 'rezept' && <span className="badge badge-komplett">Komplettgericht</span>}
        </div>
        <h1 className="koch-name">{g.name}</h1>
        {g.beschreibung && <p className="koch-beschreibung">{g.beschreibung}</p>}

        <div className="koch-fakten">
          <div><Icon name="uhr" groesse={18} /><strong>{g.zeit_min}</strong><small>Minuten</small></div>
          <div><Icon name="personen" groesse={18} /><strong>{g.portionen}</strong><small>{g.portionen === 1 ? 'Portion' : 'Portionen'}</small></div>
          <div>
            <Icon name="preis" groesse={18} />
            <strong>{kosten.pro_portion_cent === null ? '–' : `${kosten.status === 'teilweise' ? 'ab ' : ''}${euroText(kosten.pro_portion_cent)}`}</strong>
            <small>{kosten.pro_portion_cent === null ? 'Preis unbekannt' : 'pro Portion'}</small>
          </div>
        </div>

        {gebucht && (
          <div className="koch-erfolg" role="status">
            <span className="koch-erfolg-haken"><Icon name="haken" groesse={20} /></span>
            <span>
              <strong>Aus dem Vorrat entnommen</strong>
              <small>{gebucht.text}</small>
              {gebucht.warnung && <small className="status-warn">{gebucht.warnung}</small>}
            </span>
            <button type="button" className="link" onClick={() => void rueckgaengig()} disabled={laeuft}>Rückgängig</button>
          </div>
        )}

        {stufe !== 'kochen' && (
          <section className="koch-abschnitt">
            <h2>Du brauchst</h2>
            <ul className="koch-zutaten">
              {zeilen.map((z, i) => (
                <li key={`${z.name}-${i}`} className={`koch-zutat f-${z.farbe ?? 'kuehlschrank'} z-${z.status}`}>
                  <span className="farbpunkt" aria-hidden="true" />
                  <span className="koch-zutat-text">
                    <strong>{z.text ? `${z.text} ${z.name}` : z.name}</strong>
                    <small>{zeilenStatus(z)}</small>
                  </span>
                  <span className="koch-zutat-zeichen" aria-hidden="true">
                    {z.status === 'ok' ? <Icon name="haken" groesse={18} /> : z.status === 'frei' ? null : '!'}
                  </span>
                </li>
              ))}
            </ul>
            {grund.length > 0 && <p className="leise klein koch-grund">Immer da: {grund.join(', ')}</p>}
          </section>
        )}

        {stufe !== 'kochen' && (gruende.length > 0 || unbekannt.length > 0) && (
          <ul className="koch-hinweise">
            {gruende.slice(0, 4).map((h) => <li key={h}><Icon name="blatt" groesse={16} /> {h}</li>)}
            {unbekannt.length > 0 && (
              <li className="grau"><Icon name="info" groesse={16} /> Zusammensetzung unbekannt: {unbekannt.join(', ')} – Kombi erfindet nichts dazu.</li>
            )}
          </ul>
        )}

        {stufe !== 'kochen' && g.fehlt.length > 0 && (
          <section className="koch-abschnitt koch-fehlt">
            <h2>Fehlt noch</h2>
            <ul className="koch-zutaten">
              {g.fehlt.map((f) => (
                <li key={f.name} className="koch-zutat z-fehlt">
                  <Icon name="korb" groesse={18} />
                  <span className="koch-zutat-text">
                    <strong>{f.menge !== null && f.einheit ? `${kurzMenge(f.menge, f.einheit)} ` : ''}{f.name}</strong>
                    <small>{f.preis_cent !== null ? `${euroText(f.preis_cent)} ${f.preis_bezug ?? ''}` : 'Preis unbekannt'}</small>
                  </span>
                </li>
              ))}
            </ul>
            {planung && (planId ? (
              <p className="leise klein">Steht für diese geplante Mahlzeit schon auf der Einkaufsliste.</p>
            ) : onFehlendesMerken && (
              <button type="button" className="knopf breit" onClick={() => void merken()} disabled={gemerkt}>
                <Icon name={gemerkt ? 'haken' : 'wagen'} groesse={18} /> {gemerkt ? 'Auf der Einkaufsliste' : 'Auf die Einkaufsliste'}
              </button>
            ))}
          </section>
        )}

        {gebucht && gebucht.danach.length > 0 && (
          <section className="koch-abschnitt koch-bleibt">
            <h2>Im Vorrat bleibt</h2>
            <ul className="koch-danach">
              {gebucht.danach.map((d) => <li key={d.name}><span>{d.name}</span><strong>{d.text}</strong></li>)}
            </ul>
          </section>
        )}

        {g.schritte.length > 0 && (
          <section className="koch-abschnitt">
            <h2>Zubereitung</h2>
            <ol className="koch-schritte">
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
                    <span className="schritt-nr">{erledigt.has(i) ? <Icon name="haken" groesse={16} /> : i + 1}</span>
                    <span>{s}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
        {fehler && stufe !== 'bestaetigen' && <p className="fehlerbox">{fehler}</p>}
      </div>

      <div className="koch-unten">
        {stufe === 'kochen' ? (
          <button type="button" className="knopf haupt" onClick={fertig}>
            <Icon name="haken" /> Fertig
          </button>
        ) : daten.kann_kochen ? (
          <button type="button" className="knopf haupt gross" onClick={() => { setFehler(null); setPosten(daten.posten); setStufe('bestaetigen'); }}>
            <Icon name="pfanne" /> Kochen starten
          </button>
        ) : (
          <>
            <p className="leise klein koch-unten-text">
              {probleme > 0 ? 'Die Zutaten aus dem Vorrat sind nicht mehr da.' : 'Nichts aus dem Vorrat nötig.'}
            </p>
            <button type="button" className="knopf haupt" onClick={() => setStufe('kochen')}>
              <Icon name="pfanne" /> Ohne Entnahme kochen
            </button>
          </>
        )}
      </div>

      {stufe === 'bestaetigen' && (
        <Blatt
          titel="Aus dem Vorrat entnehmen?"
          untertitel={entnahmeText(aktiv)}
          onSchliessen={() => setStufe('ansicht')}
        >
          <PostenListe posten={posten} bestand={bestand} onAendern={setPosten} />
          <p className="leise klein abstand-oben">
            Entnommen wird zuerst Geöffnetes, dann was am frühesten abläuft. {planung ? 'Alles in einem Schritt – klappt etwas nicht, wird nichts gebucht.' : ''}
          </p>
          {fehler && <p className="fehlertext">{fehler}</p>}
          <div className="abschnitt">
            <button type="button" className="knopf haupt" disabled={laeuft || aktiv.length === 0} onClick={() => void buchen()}>
              <Icon name="pfanne" /> {laeuft ? 'Entnehme …' : 'Entnehmen & loslegen'}
            </button>
            <button type="button" className="link breit" onClick={() => setStufe('ansicht')}>Abbrechen</button>
          </div>
        </Blatt>
      )}
    </div>
  );
}
