import { useEffect, useState } from 'react';
import type { EntnahmePosten, KochZeile } from '../supabase/functions/_shared/kombi/aktionen.ts';
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
import { GerichtBild } from './GerichtBild';

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
  /** z. B. „Gespeichertes Rezept“ – erklärt, woher das Rezept kommt */
  herkunft?: string | null;
  onGekocht: () => void;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void;
  onFehlendesMerken?: (fehlt: FehlendeZutat[]) => Promise<void>;
  onSchliessen: () => void;
};

type Gebucht = { text: string; rueck: () => Promise<unknown>; danach: { name: string; text: string }[]; wert: string | null; warnung: string | null };
type Stufe = 'rezept' | 'bestaetigen' | 'kochen' | 'fertig';

/**
 * Die Rezeptseite – eine eigene, ganze Seite statt einer schmalen Karte: Name, Dauer, Portionen,
 * Zutaten mit Mengen und die Zubereitung, gut lesbar. Anschauen ändert nichts. „Kochen starten“ fragt,
 * was aus dem Vorrat abgezogen wird (geöffnet → Ablauf → älteste), danach führt der Kochmodus
 * Schritt für Schritt durchs Rezept: Zurück, Weiter, Fertig.
 */
export function KochAnsicht({ gericht: g, naehrwerte: n, planId, bestand, reserviert, planung, protokoll, herkunft, onGekocht, onMeldung, onFehlendesMerken, onSchliessen }: Props) {
  const [stufe, setStufe] = useState<Stufe>('rezept');
  const daten = kochAnsicht(g, bestand, reserviert);
  const [posten, setPosten] = useState<EntnahmePosten[]>(daten.posten);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gebucht, setGebucht] = useState<Gebucht | null>(null);
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
      if (e.key === 'Escape' && stufe === 'rezept') onSchliessen();
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
        if (e.kosten_cent !== null) wert = `Wert ${e.kosten_unbekannt ? 'ab ' : ''}${euroText(e.kosten_cent)}`;
      } else if (planung) {
        const ids = await kochen(aktiv, planId);
        rueck = () => kochenRueckgaengig(ids, planId);
      } else {
        const e = await kochenBestaetigen(aktiv, { entnehmen: api.entnehmen });
        if (e.bewegungIds.length === 0 && e.fehler.length) throw new Error(e.fehler.map((f) => `${f.name}: ${f.meldung}`).join(' '));
        if (e.fehler.length) warnung = `Nicht abgezogen: ${e.fehler.map((f) => `${f.name} (${f.meldung})`).join(', ')}`;
        rueck = () => api.rueckgaengig(e.bewegungIds);
      }
      const danach = aktiv.map((p) => {
        const rest = Math.max(0, (sorteVon(p.block_typ_id)?.anzahl ?? 0) - p.menge);
        return { name: p.name, text: rest === 0 ? 'aufgebraucht' : `noch ${mengeText(rest, p.einheit)}` };
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
      setStufe('rezept');
      onMeldung('Rückgängig gemacht – alles ist wieder im Vorrat.');
      onGekocht();
    } catch (e) {
      onMeldung(fehlerText(e));
    } finally {
      setLaeuft(false);
    }
  }

  function schliessenNachKochen() {
    if (gebucht) onMeldung(`Guten Appetit! Aus dem Vorrat abgezogen: ${gebucht.text}.`, gebucht.rueck);
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

  function kochenStarten() {
    setFehler(null);
    if (daten.kann_kochen) {
      setPosten(daten.posten);
      setStufe('bestaetigen');
    } else {
      setStufe('kochen');
    }
  }

  const zeilen = daten.zeilen.filter((z) => z.quelle !== 'grundausstattung');
  const grund = daten.zeilen.filter((z) => z.quelle === 'grundausstattung').map((z) => z.name);
  const UNBEKANNT = /^Zusammensetzung von (.+) unbekannt\.?$/;
  const unbekannt = daten.hinweise.map((h) => UNBEKANNT.exec(h)?.[1]).filter((x): x is string => !!x);
  const hinweise = daten.hinweise.filter((h) => !UNBEKANNT.test(h)).slice(0, 2);
  const allesDa = g.fehlt.length === 0 && zeilen.every((z) => z.status === 'ok' || z.status === 'frei');
  const makros = [
    n.protein_g !== null ? `${n.protein_g.toLocaleString('de-DE')} g Eiweiß` : null,
    n.kohlenhydrate_g !== null ? `${n.kohlenhydrate_g.toLocaleString('de-DE')} g Kohlenhydrate` : null,
    n.fett_g !== null ? `${n.fett_g.toLocaleString('de-DE')} g Fett` : null,
  ].filter(Boolean);
  const fehltZahl = g.fehlt.length + zeilen.filter((z) => z.status !== 'ok' && z.status !== 'frei').length;

  return (
    <div className="rezept" role="dialog" aria-modal="true" aria-label={`Rezept: ${g.name}`}>
      <div className="rezept-leiste">
        <button type="button" className="zurueck-knopf" onClick={onSchliessen} aria-label="Zurück">
          <Icon name="zurueck" groesse={20} /> Zurück
        </button>
      </div>

      <div className="rezept-inhalt">
        <div className="rezept-bild"><GerichtBild g={g} groesse="kopf" suchen nachweis /></div>

        <header className="rezept-kopf">
          {(planId || herkunft) && <p className="held-ueber">{planId ? 'Für heute geplant' : herkunft}</p>}
          <h1>{g.name}</h1>
          {g.beschreibung && <p className="rezept-satz">{g.beschreibung}</p>}
          <dl className="rezept-fakten">
            <div><dt>Dauer ca.</dt><dd><Icon name="uhr" groesse={18} /> {g.zeit_min} Min</dd></div>
            <div><dt>Portionen</dt><dd><Icon name="personen" groesse={18} /> {g.portionen}</dd></div>
            <div className={allesDa ? 'status-ok' : 'status-achtung'}>
              <dt>Im Vorrat</dt>
              <dd><Icon name={allesDa ? 'haken' : 'wagen'} groesse={18} /> {allesDa ? 'Alles da' : `${fehltZahl} ${fehltZahl === 1 ? 'fehlt' : 'fehlen'}`}</dd>
            </div>
          </dl>
          {hinweise.map((h) => <p key={h} className="rezept-hinweis"><Icon name="info" groesse={16} /> {h}</p>)}
        </header>

        <section className="rezept-abschnitt" aria-label="Zutaten">
          <div className="abschnitt-kopf"><h2>Zutaten</h2><span className="abschnitt-zusatz">für {g.portionen} {g.portionen === 1 ? 'Portion' : 'Portionen'}</span></div>
          <ZutatenListe zeilen={zeilen} fehlt={g.fehlt} />
          {(grund.length > 0 || unbekannt.length > 0) && (
            <p className="abschnitt-fuss">
              {grund.length > 0 && `Außerdem: ${grund.join(', ')}. `}
              {unbekannt.length > 0 && `Was in ${unbekannt.join(', ')} steckt, ist nicht hinterlegt – Kombi erfindet nichts dazu.`}
            </p>
          )}
          {g.fehlt.length > 0 && planung && (planId ? (
            <p className="abschnitt-fuss">Was fehlt, steht für diese geplante Mahlzeit schon auf der Einkaufsliste.</p>
          ) : onFehlendesMerken && (
            <button type="button" className="knopf breit zweit abstand-oben" onClick={() => void merken()} disabled={gemerkt}>
              <Icon name={gemerkt ? 'haken' : 'wagen'} groesse={18} /> {gemerkt ? 'Steht auf der Einkaufsliste' : 'Fehlendes auf die Einkaufsliste'}
            </button>
          ))}
        </section>

        <section className="rezept-abschnitt" aria-label="Zubereitung">
          <div className="abschnitt-kopf">
            <h2>Zubereitung</h2>
            {g.schritte.length > 0 && <span className="abschnitt-zusatz">{g.schritte.length} {g.schritte.length === 1 ? 'Schritt' : 'Schritte'}</span>}
          </div>
          {g.schritte.length > 0 ? (
            <ol className="schritt-liste">
              {g.schritte.map((s, i) => (
                <li key={i}><span className="schritt-nr" aria-hidden="true">{i + 1}</span><p>{s}</p></li>
              ))}
            </ol>
          ) : (
            <p className="leise">Für dieses Gericht sind keine Schritte hinterlegt.</p>
          )}
        </section>

        <details className="mehr abstand-oben">
          <summary>Preis und Nährwerte</summary>
          <div className="info-zeilen">
            <div className="info-zeile"><span>Preis je Portion</span><span>{euroKurz(g.kosten)}</span></div>
            <div className="info-zeile"><span>Kalorien je Portion</span><span>{kcalKurz(n)}</span></div>
            {makros.length > 0 && <div className="info-zeile"><span>je Portion</span><span>{makros.join(' · ')}</span></div>}
            <div className="info-zeile"><span>Wert aus dem Vorrat</span><span>{g.kosten.gesamt_cent === null ? 'Preis unbekannt' : `${g.kosten.status === 'teilweise' ? 'ab ' : ''}${euroText(g.kosten.gesamt_cent)}`}</span></div>
          </div>
          <p className="meta-text">
            Nur aus hinterlegten Preisen und Nährwerten – Kombi schätzt nichts. „ab …“ heißt: mindestens, einiges fehlt.
            {g.kosten.unbekannt.length > 0 && ` Ohne Preis: ${g.kosten.unbekannt.join(', ')}.`}
            {n.unbekannt.length > 0 && ` Ohne Nährwerte: ${n.unbekannt.join(', ')}.`}
            {herkunft && ' Beim Kochen zählt der aktuelle Vorrat.'}
          </p>
        </details>
        {fehler && stufe === 'rezept' && <p className="fehlerbox abstand-oben">{fehler}</p>}
      </div>

      <div className="rezept-unten">
        <button type="button" className="knopf haupt" onClick={kochenStarten}>
          <Icon name="pfanne" /> {daten.kann_kochen ? 'Kochen starten' : 'Schritt für Schritt kochen'}
        </button>
        <p className="rezept-unten-text">
          {daten.kann_kochen ? 'Kombi fragt vorher, was aus dem Vorrat abgezogen wird.' : 'Nichts davon liegt im Vorrat – am Vorrat ändert sich nichts.'}
        </p>
      </div>

      {stufe === 'bestaetigen' && (
        <Blatt titel="Zutaten aus dem Vorrat nehmen?" untertitel="Damit dein Vorrat stimmt, zieht Kombi diese Mengen ab. Du kannst sie anpassen." onSchliessen={() => setStufe('rezept')}>
          <PostenListe posten={posten} bestand={bestand} onAendern={setPosten} />
          <p className="abschnitt-fuss">Zuerst Geöffnetes, dann was am frühesten abläuft.{planung ? ' Klappt etwas nicht, wird gar nichts abgezogen.' : ''}</p>
          {fehler && <p className="fehlertext">{fehler}</p>}
          <div className="abschnitt">
            <button type="button" className="knopf haupt" disabled={laeuft || aktiv.length === 0} onClick={() => void buchen()}>
              {laeuft ? 'Wird abgezogen …' : 'Abziehen & loslegen'}
            </button>
            <button type="button" className="link breit" onClick={() => setStufe('rezept')}>Abbrechen</button>
          </div>
        </Blatt>
      )}

      {(stufe === 'kochen' || stufe === 'fertig') && (
        <Kochmodus
          g={g}
          zeilen={zeilen}
          fehlt={g.fehlt}
          gebucht={gebucht}
          fertig={stufe === 'fertig'}
          laeuft={laeuft}
          onFertig={() => setStufe('fertig')}
          onWeiterKochen={() => setStufe('kochen')}
          onRueckgaengig={() => void rueckgaengig()}
          onVerlassen={() => (gebucht ? schliessenNachKochen() : setStufe('rezept'))}
          onSchliessen={schliessenNachKochen}
        />
      )}
    </div>
  );
}

/** Zutaten mit Menge rechts – und klar markiert, was fehlt oder nicht reicht. */
function ZutatenListe({ zeilen, fehlt }: { zeilen: KochZeile[]; fehlt: FehlendeZutat[] }) {
  const zustand = (z: KochZeile) => {
    switch (z.status) {
      case 'zu_wenig': return <span className="status-achtung">nur {mengeText(z.verfuegbar!, z.einheit)} da</span>;
      case 'leer': return <span className="status-kritisch">aufgebraucht</span>;
      case 'unbekannt': return <span className="status-kritisch">nicht mehr im Vorrat</span>;
      case 'frei': return <span>Rest aus dem Kühlschrank</span>;
      default: return null;
    }
  };
  return (
    <ul className="liste zutaten-liste">
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
      {fehlt.map((f) => (
        <li key={`fehlt-${f.name}`} className="fehlt">
          <div className="zeile">
            <span className="punkt" aria-hidden="true" />
            <span className="zeile-haupt">
              <span className="zeile-titel">{f.name}</span>
              <span className="zeile-meta status-achtung">fehlt – nicht im Vorrat</span>
            </span>
            {f.menge !== null && f.einheit && <span className="menge-rechts">{mengeText(f.menge, f.einheit)}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Kochmodus: ein Schritt pro Bildschirm, große Schrift, Zurück / Weiter / Fertig unten in Daumennähe.
 * Die Zutaten bleiben über „Zutaten“ erreichbar. Nach dem letzten Schritt: „Guten Appetit“ mit dem,
 * was abgezogen wurde und was im Vorrat bleibt – Rückgängig ist noch möglich.
 */
function Kochmodus({ g, zeilen, fehlt, gebucht, fertig, laeuft, onFertig, onWeiterKochen, onRueckgaengig, onVerlassen, onSchliessen }: {
  g: Gericht; zeilen: KochZeile[]; fehlt: FehlendeZutat[]; gebucht: Gebucht | null; fertig: boolean; laeuft: boolean;
  onFertig: () => void; onWeiterKochen: () => void; onRueckgaengig: () => void; onVerlassen: () => void; onSchliessen: () => void;
}) {
  const schritte = g.schritte.length ? g.schritte : ['Für dieses Gericht sind keine Schritte hinterlegt – einfach wie gewohnt zubereiten.'];
  const [i, setI] = useState(0);
  const [zutatenOffen, setZutatenOffen] = useState(false);
  const letzter = i === schritte.length - 1;

  useEffect(() => {
    const beiTaste = (e: KeyboardEvent) => {
      if (fertig || zutatenOffen) return;
      if (e.key === 'ArrowRight') setI((x) => Math.min(schritte.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', beiTaste);
    return () => window.removeEventListener('keydown', beiTaste);
  }, [fertig, zutatenOffen, schritte.length]);

  if (fertig) {
    return (
      <div className="kochmodus" role="dialog" aria-modal="true" aria-label={`${g.name}: fertig`}>
        <div className="km-fertig">
          <span className="km-fertig-icon" aria-hidden="true"><Icon name="haken" groesse={34} /></span>
          <h2>Guten Appetit!</h2>
          <p className="leise">{gebucht ? `Aus dem Vorrat abgezogen: ${gebucht.text}${gebucht.wert ? ` · ${gebucht.wert}` : ''}.` : 'Am Vorrat wurde nichts geändert.'}</p>
          {gebucht?.warnung && <p className="status-achtung klein">{gebucht.warnung}</p>}
          {gebucht && gebucht.danach.length > 0 && (
            <section className="abschnitt">
              <h3 className="unterkopf">Im Vorrat bleibt</h3>
              <ul className="liste">
                {gebucht.danach.map((d) => (
                  <li key={d.name}><div className="zeile"><span className="zeile-haupt"><span className="zeile-titel">{d.name}</span></span><span className={`zeile-wert${d.text === 'aufgebraucht' ? ' status-achtung' : ''}`}>{d.text}</span></div></li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="km-unten">
          <button type="button" className="knopf zweit" onClick={onWeiterKochen}><Icon name="zurueck" groesse={18} /> Schritte</button>
          <button type="button" className="knopf haupt" onClick={onSchliessen}><Icon name="haken" /> Fertig</button>
        </div>
        {gebucht && (
          <button type="button" className="link breit km-rueck" disabled={laeuft} onClick={onRueckgaengig}>Doch nicht gekocht? Rückgängig machen</button>
        )}
      </div>
    );
  }

  return (
    <div className="kochmodus" role="dialog" aria-modal="true" aria-label={`${g.name} – Schritt ${i + 1} von ${schritte.length}`}>
      <div className="km-leiste">
        <button type="button" className="icon-knopf" onClick={onVerlassen} aria-label={gebucht ? 'Kochmodus beenden' : 'Zurück zum Rezept'}>
          <Icon name="schliessen" groesse={20} />
        </button>
        <span className="km-titel">{g.name}</span>
        <button type="button" className="knopf klein zweit" onClick={() => setZutatenOffen(true)}>Zutaten</button>
      </div>
      <div className="km-fortschritt" role="progressbar" aria-label="Fortschritt" aria-valuemin={1} aria-valuemax={schritte.length} aria-valuenow={i + 1}>
        {schritte.map((_, j) => <span key={j} className={j <= i ? 'an' : ''} />)}
      </div>

      <div className="km-inhalt">
        {gebucht && i === 0 && (
          <div className="erfolg" role="status">
            <Icon name="haken" groesse={20} />
            <span><strong>Aus dem Vorrat abgezogen</strong><small>{gebucht.text}</small></span>
            <button type="button" className="link" onClick={onRueckgaengig} disabled={laeuft}>Rückgängig</button>
          </div>
        )}
        <p className="km-nummer">Schritt {i + 1} von {schritte.length}</p>
        <p className="km-text" aria-live="polite">{schritte[i]}</p>
      </div>

      <div className="km-unten">
        <button type="button" className="knopf zweit" disabled={i === 0} onClick={() => setI(i - 1)}>
          <Icon name="zurueck" groesse={18} /> Zurück
        </button>
        {letzter ? (
          <button type="button" className="knopf haupt" onClick={onFertig}><Icon name="haken" /> Fertig</button>
        ) : (
          <button type="button" className="knopf haupt" onClick={() => setI(i + 1)}>Weiter <Icon name="weiter" groesse={18} /></button>
        )}
      </div>

      {zutatenOffen && (
        <Blatt titel="Zutaten" untertitel={`für ${g.portionen} ${g.portionen === 1 ? 'Portion' : 'Portionen'}`} onSchliessen={() => setZutatenOffen(false)}>
          <ZutatenListe zeilen={zeilen} fehlt={fehlt} />
        </Blatt>
      )}
    </div>
  );
}
