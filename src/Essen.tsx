import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  Aktion, BausteinIdee, Einkaufsvorschlag, FeedbackEintrag, Gericht, GerichtKurz, Modus, Optionen, Snapshot,
} from '../supabase/functions/_shared/kombi/typen.ts';
import { kurz } from '../supabase/functions/_shared/kombi/bewertung.ts';
import { aehnlichkeit } from '../supabase/functions/_shared/kombi/aehnlichkeit.ts';
import { berechneLeitplanken, verletztAusschluss } from '../supabase/functions/_shared/kombi/praeferenz.ts';
import { GRUNDAUSSTATTUNG, kuehlschrankEintraege } from '../supabase/functions/_shared/kombi/snapshot.ts';
import { kostenText } from '../supabase/functions/_shared/kombi/kosten.ts';
import { uuid } from '../supabase/functions/_shared/kombi/id.ts';
import { kategorieFuer, type PlanStand } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { restSnapshot, type AuftauEintrag } from '../supabase/functions/_shared/kombi/planung.ts';
import { fehlerText, type Sorte } from './api';
import {
  favoritenAus, holeVorschlaege, ladeRezepte, ladeSnapshot, protokolliereFeedback, protokolliereVorschlaege,
  speichereRezept, starteSession, type Quelle, type Rezept,
} from './essenApi';
import { GerichtKarte } from './GerichtKarte';
import { Woche, TagWahl } from './Woche';
import { eintragHinzufuegen, naehrwerteGericht, planeGericht, type Plan } from './haushalt';
import { Blatt } from './Blatt';
import { SorteFormular } from './Sorten';
import { Icon, type IconName } from './Icon';
import { ARTEN_INFO, farbe as farbInfo } from './farben';
import { kcalKurz } from './format';
import { tagName } from './dashboard';
import type { NavZustand } from './navigation';

type Props = {
  bestand: Sorte[];
  baukasten: boolean;
  /** Migration „planung_einkauf“ eingespielt */
  planung: boolean;
  heute: string;
  plaene: Plan[];
  proPlan: Map<string, PlanStand[]>;
  /** für Pläne reserviert – wird nicht noch einmal vorgeschlagen */
  reserviert: Map<number, number>;
  auftauEintraege: AuftauEintrag[];
  auftauen: ReactNode;
  nav: NavZustand['essen'];
  onNav: (teil: Partial<NavZustand['essen']>) => void;
  /** öffnet die Kochansicht (entnommen wird erst nach Bestätigung) */
  onKochen: (g: Gericht, planId: string | null) => void;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void;
  onGeaendert: () => void;
};

/** Veränderlicher Kontext einer „Was essen wir?“-Session. */
type Session = {
  id: string;
  gespeichert: boolean;
  snapshot: Snapshot;
  optionen: Optionen;
  kuehlschrank: string;
  gesehen: GerichtKurz[];
  feedback: FeedbackEintrag[];
  puffer: Gericht[];
  protokolliert: Set<string>;
  /** Protokoll-Schreibvorgänge nacheinander – Feedback nie vor seinem Vorschlag */
  warteschlange: Promise<void>;
  /** normal oder Resteverwertung – gilt für alle weiteren Vorschläge der Session */
  grundmodus: Modus;
};

type Entscheidung = 'like' | 'dislike' | 'similar' | 'skip';

const SPEICHER = 'kombi-essen';
const MINUTEN: (number | null)[] = [10, 15, 20, 30, null];
const START_OPTIONEN: Optionen = { personen: 2, max_minuten: 15, guenstig: true };
/** Wohin die Karte bei welcher Entscheidung verschwindet */
const ABGANG: Record<Entscheidung, string> = { like: 'rechts', dislike: 'links', skip: 'oben', similar: 'klein' };
const ENTSCHEIDUNGEN: { aktion: Entscheidung; icon: IconName; text: string; label: string }[] = [
  { aktion: 'dislike', icon: 'nein', text: 'Nicht meins', label: 'Nicht meins' },
  { aktion: 'similar', icon: 'aehnlich', text: 'Ähnlich', label: 'Ähnliches zeigen' },
  { aktion: 'skip', icon: 'weiter', text: 'Anderes', label: 'Gerade etwas anderes' },
  { aktion: 'like', icon: 'herz', text: 'Gefällt mir', label: 'Gefällt mir' },
];

function ladeVorlieben(): { optionen: Optionen; kuehlschrank: string } {
  try {
    const d = JSON.parse(localStorage.getItem(SPEICHER) ?? '{}');
    return { optionen: { ...START_OPTIONEN, ...(d.optionen ?? {}) }, kuehlschrank: typeof d.kuehlschrank === 'string' ? d.kuehlschrank : '' };
  } catch {
    return { optionen: START_OPTIONEN, kuehlschrank: '' };
  }
}

const wenigBewegung = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Essen({
  bestand, baukasten, planung, heute, plaene, proPlan, reserviert, auftauEintraege, auftauen, nav, onNav, onKochen, onMeldung, onGeaendert,
}: Props) {
  const [optionen, setOptionen] = useState<Optionen>(() => ladeVorlieben().optionen);
  const [kuehlschrank, setKuehlschrank] = useState(() => ladeVorlieben().kuehlschrank);
  const session = useRef<Session | null>(null);

  const [aktuell, setAktuell] = useState<Gericht | null>(null);
  const [abgang, setAbgang] = useState<string | null>(null);
  const [einkauf, setEinkauf] = useState<Einkaufsvorschlag | null>(null);
  const [notfall, setNotfall] = useState(false);
  const [baustein, setBaustein] = useState<BausteinIdee | null>(null);
  const [muster, setMuster] = useState<string[]>([]);
  const [quelle, setQuelle] = useState<{ art: Quelle; anbieter: string; hinweis: string | null } | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gemocht, setGemocht] = useState(false);
  const [einplanen, setEinplanen] = useState<Gericht | null>(null);
  const [ergebnisHinweis, setErgebnisHinweis] = useState<string | null>(null);
  const [bausteinFormular, setBausteinFormular] = useState<BausteinIdee | null>(null);
  const [rezepte, setRezepte] = useState<Rezept[]>([]);
  const [rezeptOffen, setRezeptOffen] = useState<Rezept | null>(null);
  const [optionenOffen, setOptionenOffen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SPEICHER, JSON.stringify({ optionen, kuehlschrank }));
    } catch {
      // Speichern der Vorlieben ist nur Komfort
    }
  }, [optionen, kuehlschrank]);

  useEffect(() => {
    void ladeRezepte().then(setRezepte);
  }, []);

  const gestartet = session.current !== null;

  function zeigeNaechstes(s: Session): boolean {
    const g = s.puffer.shift() ?? null;
    setAktuell(g);
    setGemocht(false);
    if (g) s.gesehen.push(kurz(g));
    return g !== null;
  }

  async function anfordern(s: Session, modus: Modus) {
    setLaedt(true);
    setFehler(null);
    setAktuell(null);
    try {
      const antwort = await holeVorschlaege({
        snapshot: s.snapshot,
        optionen: s.optionen,
        gesehen: s.gesehen,
        favoriten: favoritenAus(rezepte),
        feedback: s.feedback,
        modus,
        anzahl: 3,
      });
      const e = antwort.ergebnis;
      setQuelle({ art: antwort.quelle, anbieter: e.anbieter, hinweis: antwort.hinweis });
      setMuster(e.leitplanken.muster);
      setEinkauf(e.einkauf);
      setNotfall(e.notfall);
      setBaustein(e.baustein_idee);
      setErgebnisHinweis(e.hinweis ?? null);
      s.puffer = [...e.gerichte];
      if (s.gespeichert) {
        const alle = [...e.gerichte, ...(e.einkauf ? [e.einkauf] : []), ...(e.baustein_idee ? [e.baustein_idee] : [])];
        s.warteschlange = s.warteschlange
          .then(() => protokolliereVorschlaege(s.id, alle, e.anbieter))
          .then((ids) => ids.forEach((id) => s.protokolliert.add(id)))
          .catch(() => undefined);
      }
      zeigeNaechstes(s);
    } catch (err) {
      setFehler(fehlerText(err));
    } finally {
      setLaedt(false);
    }
  }

  async function starten(grundmodus: Modus = { art: 'normal' }) {
    setLaedt(true);
    setFehler(null);
    try {
      // Nur der freie Vorrat: was für geplante Mahlzeiten reserviert ist, wird nicht noch einmal verplant.
      const snapshot = restSnapshot(await ladeSnapshot(kuehlschrank), reserviert);
      const id = uuid();
      const gespeichert = await starteSession(id, optionen, kuehlschrank).catch(() => false);
      const s: Session = {
        id, gespeichert, snapshot, optionen, kuehlschrank, grundmodus,
        gesehen: [], feedback: [], puffer: [], protokolliert: new Set(), warteschlange: Promise.resolve(),
      };
      session.current = s;
      setOptionenOffen(false);
      await anfordern(s, grundmodus);
    } catch (err) {
      setFehler(fehlerText(err));
      setLaedt(false);
    }
  }

  function neuStarten() {
    session.current = null;
    setAktuell(null);
    setEinkauf(null);
    setNotfall(false);
    setBaustein(null);
    setMuster([]);
    setQuelle(null);
    setGemocht(false);
    setOptionenOffen(false);
    setErgebnisHinweis(null);
  }

  function merkeFeedback(g: Gericht, aktion: Aktion) {
    const s = session.current;
    if (!s) return;
    s.feedback.push({ ...kurz(g), aktion, vorschlag_id: g.id });
    s.warteschlange = s.warteschlange
      .then(() => (s.protokolliert.has(g.id) ? protokolliereFeedback(g.id, aktion) : undefined))
      .catch(() => undefined);
  }

  function entscheiden(aktion: Entscheidung) {
    const s = session.current;
    const g = aktuell;
    if (!s || !g || abgang) return;
    merkeFeedback(g, aktion);

    if (aktion === 'like') {
      setGemocht(true);
      return;
    }
    const weiterMachen = () => {
      setAbgang(null);
      if (aktion === 'similar') {
        s.puffer = [];
        void anfordern(s, { art: 'aehnlich', zu: kurz(g) });
        return;
      }
      if (aktion === 'dislike') {
        // Vorgemerkte Vorschläge, die dem abgelehnten zu sehr ähneln oder jetzt ausgeschlossen sind, fallen weg.
        const l = berechneLeitplanken(s.feedback, s.grundmodus);
        s.puffer = s.puffer.filter((p) => aehnlichkeit(kurz(p), kurz(g)) < 0.6 && !verletztAusschluss(kurz(p), l));
        setMuster(l.muster);
      }
      if (aktion === 'skip') {
        // „Gerade etwas anderes“: sehr Ähnliches aus dem Puffer zurückstellen – ohne etwas zu lernen.
        s.puffer = s.puffer.filter((p) => aehnlichkeit(kurz(p), kurz(g)) < 0.5);
      }
      if (!zeigeNaechstes(s)) void anfordern(s, s.grundmodus);
    };
    if (wenigBewegung()) weiterMachen();
    else {
      setAbgang(ABGANG[aktion]);
      window.setTimeout(weiterMachen, 220);
    }
  }

  function weiter() {
    const s = session.current;
    if (!s) return;
    if (!zeigeNaechstes(s)) void anfordern(s, s.grundmodus);
  }

  async function rezeptSpeichern(g: Gericht) {
    try {
      const s = session.current;
      await s?.warteschlange;
      const aktionen = s?.feedback.filter((f) => f.vorschlag_id === g.id).map((f) => f.aktion) ?? [];
      await speichereRezept(g, s?.protokolliert.has(g.id) ?? false, [...aktionen, 'save']);
      merkeFeedback(g, 'save');
      onMeldung(`${g.name} gespeichert.`);
      setRezepte(await ladeRezepte());
    } catch (err) {
      onMeldung(fehlerText(err));
    }
  }

  /** „Kochen“ ist ein starkes Signal – gezählt wird es beim Öffnen der Kochansicht. */
  function kochen(g: Gericht, planId: string | null) {
    if (session.current && aktuell?.id === g.id) merkeFeedback(g, 'cook');
    onKochen(g, planId);
  }

  async function einkaufMerken(e: Einkaufsvorschlag) {
    try {
      await eintragHinzufuegen({ name: e.name, menge: null, einheit: null, kategorie: kategorieFuer(e.name), quelle: 'notfall', grund: 'ermöglicht mehrere Gerichte' });
      onMeldung(`${e.name} steht auf der Einkaufsliste.`);
      onGeaendert();
    } catch (err) {
      onMeldung(fehlerText(err));
    }
  }

  async function planen(g: Gericht, datum: string | null) {
    setEinplanen(null);
    try {
      await planeGericht(g, datum);
      const s = session.current;
      if (s && aktuell?.id === g.id) {
        // reserviert → aus dem Snapshot dieser Session nehmen, damit es nicht noch einmal vorgeschlagen wird
        s.snapshot = restSnapshot(s.snapshot, new Map(g.zutaten.filter((z) => z.quelle === 'bestand' && z.block_typ_id !== null && z.menge !== null)
          .map((z) => [z.block_typ_id as number, z.menge as number])));
      }
      onMeldung(`${g.name}: ${datum ? tagName(heute, datum) : 'flexibel'} eingeplant.${g.fehlt.length ? ' Fehlendes steht auf der Einkaufsliste.' : ''}`);
      onGeaendert();
    } catch (err) {
      onMeldung(fehlerText(err));
    }
  }

  const reste = kuehlschrankEintraege(kuehlschrank).length;
  const heuteGeplant = plaene
    .filter((p) => p.art === 'mahlzeit' && p.daten.gericht && p.datum !== null && p.datum <= heute)
    .sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? ''));
  const reserviertSorten = [...reserviert.values()].filter((m) => m > 0).length;
  const favoriten = favoritenAus(rezepte);
  const optionenAendern = (neu: Partial<Optionen>) => {
    const o = { ...optionen, ...neu };
    setOptionen(o);
    if (session.current) session.current.optionen = o;
  };

  const optionenFelder = (
    <div className="flaeche optionen" role="group" aria-label="Einstellungen">
      <div className="option-zeile">
        <span className="option-name"><Icon name="personen" groesse={18} /> Personen</span>
        <div className="stepper">
          <button type="button" className="icon-knopf klein" aria-label="Weniger Personen" disabled={optionen.personen <= 1}
            onClick={() => optionenAendern({ personen: optionen.personen - 1 })}><Icon name="minus" groesse={16} /></button>
          <strong aria-live="polite">{optionen.personen}</strong>
          <button type="button" className="icon-knopf klein" aria-label="Mehr Personen" disabled={optionen.personen >= 12}
            onClick={() => optionenAendern({ personen: optionen.personen + 1 })}><Icon name="plus" groesse={16} /></button>
        </div>
      </div>
      <div className="option-zeile">
        <span className="option-name"><Icon name="uhr" groesse={18} /> Zeit</span>
        <div className="segment klein" aria-label="Maximale Zeit">
          {MINUTEN.map((m) => (
            <button key={String(m)} type="button" className={optionen.max_minuten === m ? 'gewaehlt' : ''}
              aria-pressed={optionen.max_minuten === m} onClick={() => optionenAendern({ max_minuten: m })}>
              {m ? `${m}′` : 'egal'}
            </button>
          ))}
        </div>
      </div>
      <label className="option-zeile schalter">
        <span className="option-name"><Icon name="preis" groesse={18} /> Möglichst günstig</span>
        <input type="checkbox" role="switch" checked={optionen.guenstig} onChange={() => optionenAendern({ guenstig: !optionen.guenstig })} />
      </label>
    </div>
  );

  const einstellungenText = [
    session.current?.grundmodus.art === 'reste' ? 'Reste verwerten' : null,
    `${optionen.personen} ${optionen.personen === 1 ? 'Person' : 'Personen'}`,
    optionen.max_minuten ? `${optionen.max_minuten} Min` : 'Zeit egal',
    optionen.guenstig ? 'günstig' : null,
    reste > 0 ? `${reste} ${reste === 1 ? 'Rest' : 'Reste'}` : null,
  ].filter(Boolean) as string[];

  const heuteAnsicht = (
    <>
      {planung && heuteGeplant.length > 0 && (
        <section aria-label="Heute geplant">
          <ul className="liste mit-icon">
            {heuteGeplant.map((p) => (
              <li key={p.id}>
                <div className="zeile">
                  <span className="gericht-bild klein" aria-hidden="true">{p.daten.gericht!.emoji}</span>
                  <span className="zeile-haupt">
                    <span className="zeile-meta">{p.datum === heute ? 'Heute geplant' : `Geplant: ${tagName(heute, p.datum!)}`}</span>
                    <span className="zeile-titel">{p.titel}</span>
                  </span>
                  <button type="button" className="knopf klein akzent" onClick={() => kochen(p.daten.gericht!, p.id)}>Kochen</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="einstellungen">
        <p className="meta">{einstellungenText.map((t) => <span key={t}>{t}</span>)}</p>
        <button type="button" className="link" onClick={() => setOptionenOffen((o) => !o)}>{optionenOffen ? 'Fertig' : 'Ändern'}</button>
        {gestartet && <button type="button" className="link" onClick={neuStarten}>Neu</button>}
      </div>
      {optionenOffen && optionenFelder}

      {!gestartet && (
        <>
          <label className="feld">
            <span>Reste im Kühlschrank <small>(optional)</small></span>
            <textarea
              rows={2}
              maxLength={1000}
              value={kuehlschrank}
              onChange={(e) => setKuehlschrank(e.target.value)}
              placeholder="z. B. eine halbe Paprika, etwas Frischkäse"
            />
          </label>
          <button type="button" className="knopf haupt" onClick={() => void starten()} disabled={laedt}>
            {laedt ? 'Kombi überlegt …' : 'Vorschläge zeigen'}
          </button>
          <button type="button" className="knopf breit" onClick={() => void starten({ art: 'reste' })} disabled={laedt}>
            Reste zuerst verwerten
          </button>
          <p className="meta-text">
            Immer da: {GRUNDAUSSTATTUNG.join(', ')}.
            {reserviertSorten > 0 && ` Für geplante Gerichte Reserviertes wird nicht noch einmal vorgeschlagen.`}
          </p>
        </>
      )}

      {fehler && <p className="fehlerbox">{fehler}</p>}

      {laedt && gestartet && (
        <article className="gericht laedt" aria-live="polite">
          <div className="gericht-kopf" aria-hidden="true">🍳</div>
          <div className="gericht-inhalt">
            <p className="gericht-name">Kombi schaut in den Vorrat …</p>
            <p className="gericht-text">Gleich gibt’s Ideen aus dem, was da ist.</p>
          </div>
        </article>
      )}

      {!laedt && aktuell && (
        <div key={aktuell.id} className={`karten-buehne${abgang ? ` abgang-${abgang}` : ''}`}>
          <GerichtKarte g={aktuell} naehrwerte={naehrwerteGericht(aktuell, bestand)} />
        </div>
      )}

      {!laedt && aktuell && gemocht && (
        <div className="entscheidung danach" role="group" aria-label="Gefällt dir – und jetzt?">
          <button type="button" onClick={() => void rezeptSpeichern(aktuell)} aria-label="Rezept speichern">
            <span className="kreis"><Icon name="stern" /></span>Speichern
          </button>
          <button type="button" className="haupt" onClick={() => kochen(aktuell, null)} aria-label="Jetzt kochen">
            <span className="kreis"><Icon name="pfanne" /></span>Kochen
          </button>
          {planung && (
            <button type="button" onClick={() => setEinplanen(aktuell)} aria-label="Für einen Tag einplanen">
              <span className="kreis"><Icon name="kalender" /></span>Einplanen
            </button>
          )}
          <button type="button" onClick={weiter} aria-label="Weitere Vorschläge">
            <span className="kreis"><Icon name="weiter" /></span>Weiter
          </button>
        </div>
      )}

      {!laedt && aktuell && !gemocht && (
        <div className="entscheidung" role="group" aria-label="Entscheidung">
          {ENTSCHEIDUNGEN.map((e) => (
            <button key={e.aktion} type="button" className={`e-${e.aktion}`} onClick={() => entscheiden(e.aktion)} aria-label={e.label}>
              <span className="kreis"><Icon name={e.icon} /></span>
              {e.text}
            </button>
          ))}
        </div>
      )}

      {!laedt && gestartet && (quelle || muster.length > 0 || ergebnisHinweis) && (
        <p className="meta-text">
          {ergebnisHinweis && `${ergebnisHinweis} `}
          {muster.length > 0 && `${muster.join(' ')} `}
          {quelle && (quelle.art === 'ki' ? `Idee von der KI (${quelle.anbieter}) – Mengen, Preise und Kalorien rechnet Kombi selbst.` : 'Ohne KI nach Kombi-Regeln.')}
          {quelle?.hinweis && ` ${quelle.hinweis}`}
        </p>
      )}

      {!laedt && gestartet && !aktuell && einkauf && (
        <div className="flaeche vorschlag">
          <div className="vorschlag-titel">
            <span className="zeile-meta">Eine Sache fehlt</span>
            <h3>{einkauf.name}</h3>
          </div>
          <p className="vorschlag-text">{einkauf.begruendung}</p>
          {einkauf.heute && <p className="klein"><strong>Heute z. B.:</strong> {einkauf.heute}</p>}
          {einkauf.ermoeglicht.length > 0 && <p className="meta-text">Damit möglich: {einkauf.ermoeglicht.join(', ')}</p>}
          {planung && <button type="button" className="knopf haupt" onClick={() => void einkaufMerken(einkauf)}>Auf die Einkaufsliste</button>}
          <button type="button" className="link breit" onClick={() => session.current && void anfordern(session.current, { art: 'normal' })}>
            Trotzdem weitersuchen
          </button>
        </div>
      )}

      {!laedt && gestartet && !aktuell && !einkauf && (
        <div className="leer-zustand">
          <Icon name="essen" groesse={40} />
          <p>Gerade keine weiteren passenden Ideen.</p>
          <button type="button" className="knopf" onClick={() => session.current && void anfordern(session.current, { art: 'normal' })}>
            Nochmal suchen
          </button>
        </div>
      )}

      {!laedt && aktuell && notfall && einkauf && (
        <p className="meta-text">Mit {einkauf.name} wären {einkauf.ermoeglicht.length} weitere Gerichte möglich.</p>
      )}

      {!laedt && baustein && (
        <section className="abschnitt" aria-label="Idee für deine Komponenten">
          <ul className="liste">
            <li className={`f-${baustein.farbe}`}>
              <div className="zeile">
                <span className="punkt" aria-hidden="true" />
                <span className="zeile-haupt">
                  <span className="zeile-meta">Idee für deine Komponenten</span>
                  <span className="zeile-titel">{baustein.name}</span>
                  <span className="zeile-meta">
                    {ARTEN_INFO.find((a) => a.id === baustein.bestandsart)!.name} · {farbInfo(baustein.farbe).bedeutung} · {baustein.portionen} Portionen · {kostenText(baustein.kosten)}
                  </span>
                </span>
                <button type="button" className="knopf klein" onClick={() => setBausteinFormular(baustein)}>Übernehmen</button>
                <button type="button" className="icon-knopf klein" aria-label="Nein danke" onClick={() => setBaustein(null)}>
                  <Icon name="schliessen" groesse={14} />
                </button>
              </div>
            </li>
          </ul>
        </section>
      )}

      {rezepte.length > 0 && (!gestartet || !aktuell) && (
        <section className="abschnitt" aria-label="Gespeichert">
          <div className="abschnitt-kopf"><h2>Gespeichert</h2></div>
          <ul className="liste mit-icon">
            {rezepte.map((r) => (
              <li key={r.id}>
                <button type="button" className="zeile" onClick={() => setRezeptOffen(r)}>
                  <span className="gericht-bild klein" aria-hidden="true">{r.daten.emoji}</span>
                  <span className="zeile-haupt">
                    <span className="zeile-titel">{r.name}</span>
                    <span className="zeile-meta">{r.daten.zeit_min} Min · {kcalKurz(naehrwerteGericht(r.daten, bestand))} / Portion</span>
                  </span>
                  <Icon name="pfeil" groesse={16} className="zeile-pfeil" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );

  return (
    <section className="essen">
      {planung && (
        <div className="segment" role="tablist" aria-label="Essen">
          <button type="button" role="tab" aria-selected={nav.ansicht === 'heute'} className={nav.ansicht === 'heute' ? 'gewaehlt' : ''} onClick={() => onNav({ ansicht: 'heute' })}>
            Heute
          </button>
          <button type="button" role="tab" aria-selected={nav.ansicht === 'woche'} className={nav.ansicht === 'woche' ? 'gewaehlt' : ''} onClick={() => onNav({ ansicht: 'woche' })}>
            Woche{plaene.filter((p) => p.art === 'mahlzeit').length > 0 ? ` · ${plaene.filter((p) => p.art === 'mahlzeit').length}` : ''}
          </button>
        </div>
      )}

      {planung && nav.ansicht === 'woche' ? (
        <Woche
          bestand={bestand}
          plaene={plaene}
          proPlan={proPlan}
          reserviert={reserviert}
          auftauEintraege={auftauEintraege}
          auftauen={auftauen}
          optionen={optionen}
          favoriten={favoriten}
          planung={planung}
          heute={heute}
          onKochen={kochen}
          onMeldung={onMeldung}
          onGeaendert={onGeaendert}
        />
      ) : heuteAnsicht}

      {einplanen && (
        <TagWahl heute={heute} titel={`${einplanen.name} einplanen`} untertitel="Für welchen Tag?" onWahl={(d) => void planen(einplanen, d)} onSchliessen={() => setEinplanen(null)} />
      )}

      {rezeptOffen && (
        <Blatt titel={rezeptOffen.name} untertitel={`Gespeichert am ${new Date(rezeptOffen.erstellt_am).toLocaleDateString('de-DE')}`} onSchliessen={() => setRezeptOffen(null)}>
          <GerichtKarte g={rezeptOffen.daten} naehrwerte={naehrwerteGericht(rezeptOffen.daten, bestand)} />
          <p className="meta-text abstand-oben">Kosten von damals. Beim Kochen prüft Kombi den aktuellen Vorrat, Kalorien kommen aus den heutigen Nährwerten.</p>
          <button
            type="button"
            className="knopf haupt abstand-oben"
            onClick={() => {
              kochen(rezeptOffen.daten, null);
              setRezeptOffen(null);
            }}
          >
            <Icon name="pfanne" /> Kochen
          </button>
        </Blatt>
      )}

      {bausteinFormular && (
        <SorteFormular
          sorte={null}
          baukasten={baukasten}
          vorlage={{
            name: bausteinFormular.name,
            art: bausteinFormular.bestandsart,
            farbe: bausteinFormular.farbe,
            lagerort: bausteinFormular.lagerort,
            einheit: 'portion',
            groesse_g: bausteinFormular.portion_g ?? 100,
            herkunft: 'selbstgemacht',
            zusammensetzung: bausteinFormular.zutaten.length ? bausteinFormular.zutaten : null,
            // Preis nur, wenn er vollständig aus bekannten Preisen berechnet wurde
            kosten_cent: bausteinFormular.kosten.status === 'berechnet' ? bausteinFormular.kosten.pro_portion_cent : null,
            kosten_menge: 1,
          }}
          onFertig={(text) => {
            setBausteinFormular(null);
            setBaustein(null);
            onMeldung(`${text} Jetzt vorkochen und einbuchen.`);
            onGeaendert();
          }}
          onSchliessen={() => setBausteinFormular(null)}
        />
      )}
    </section>
  );
}
