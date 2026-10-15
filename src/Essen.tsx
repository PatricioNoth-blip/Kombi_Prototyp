import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  Aktion, BausteinIdee, Einkaufsvorschlag, FeedbackEintrag, Gericht, GerichtKurz, Modus, Optionen, Snapshot,
} from '../supabase/functions/_shared/kombi/typen.ts';
import { kurz } from '../supabase/functions/_shared/kombi/bewertung.ts';
import { aehnlichkeit } from '../supabase/functions/_shared/kombi/aehnlichkeit.ts';
import { berechneLeitplanken, verletztAusschluss } from '../supabase/functions/_shared/kombi/praeferenz.ts';
import { GRUNDAUSSTATTUNG, kuehlschrankEintraege } from '../supabase/functions/_shared/kombi/snapshot.ts';
import { uuid } from '../supabase/functions/_shared/kombi/id.ts';
import { kategorieFuer, type PlanStand } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { restSnapshot, type AuftauEintrag } from '../supabase/functions/_shared/kombi/planung.ts';
import { grundrezepteFuer } from '../supabase/functions/_shared/kombi/grundrezepte.ts';
import { fehlerText, type Sorte } from './api';
import {
  baueSnapshotAus, favoritenAus, gespeicherteOptionen, grundrezeptVorschlaege, holeVorschlaege, ladeRezepte, ladeSnapshot,
  protokolliereFeedback, protokolliereVorschlaege, speichereRezept, starteSession, type Quelle, type Rezept,
} from './essenApi';
import { GerichtKarte } from './GerichtKarte';
import { GerichtBild } from './GerichtBild';
import { ohneDoppelte, schonGespeichert } from './rezepte';
import { Woche, TagWahl } from './Woche';
import { eintragHinzufuegen, naehrwerteGericht, planeGericht, type Plan } from './haushalt';
import { SorteFormular } from './Sorten';
import { Icon, type IconName } from './Icon';
import { ARTEN_INFO, farbe as farbInfo } from './farben';
import { kcalKurz, mengeText } from './format';
import { tagName } from './dashboard';
import type { NavZustand } from './navigation';
import { KiStatus } from './KiStatus';

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
  /** öffnet die Rezeptseite (entnommen wird erst nach Bestätigung); herkunft z. B. „Gespeichertes Rezept“ */
  onKochen: (g: Gericht, planId: string | null, herkunft?: string) => void;
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
  /** erst feste Grundrezepte, danach improvisiert die KI (bzw. die Kombi-Regeln) */
  phase: 'grundrezepte' | 'improvisieren';
};

type Entscheidung = 'dislike' | 'similar' | 'skip';

const SPEICHER = 'kombi-essen';
const MINUTEN: (number | null)[] = [10, 15, 20, 30, null];
const START_OPTIONEN: Optionen = { personen: 2, max_minuten: 15 };
/** Wohin die Karte bei welcher Entscheidung verschwindet */
const ABGANG: Record<Entscheidung, string> = { dislike: 'links', skip: 'oben', similar: 'klein' };
/** Passt nicht? Drei klare Wege zum nächsten Vorschlag – „Anderer Vorschlag“ lernt nichts, „Nicht meins“ schon. */
const ENTSCHEIDUNGEN: { aktion: Entscheidung; icon: IconName; text: string; label: string }[] = [
  { aktion: 'skip', icon: 'weiter', text: 'Anderer Vorschlag', label: 'Anderer Vorschlag' },
  { aktion: 'similar', icon: 'aehnlich', text: 'Ähnliches', label: 'Etwas Ähnliches zeigen' },
  { aktion: 'dislike', icon: 'nein', text: 'Nicht meins', label: 'Nicht meins – so etwas seltener vorschlagen' },
];

function ladeVorlieben(): { optionen: Optionen; kuehlschrank: string } {
  try {
    const d = JSON.parse(localStorage.getItem(SPEICHER) ?? '{}');
    return { optionen: gespeicherteOptionen(d.optionen), kuehlschrank: typeof d.kuehlschrank === 'string' ? d.kuehlschrank : '' };
  } catch {
    return { optionen: START_OPTIONEN, kuehlschrank: '' };
  }
}

const wenigBewegung = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const KEIN_GRUNDREZEPT = 'Gerade ist kein Grundrezept direkt kochbar – Kombi improvisiert mit dem, was da ist.';
const KEIN_RESTE_GRUNDREZEPT = 'Kein Grundrezept verwertet gerade deine Reste – Kombi improvisiert damit.';
const ALLE_GEZEIGT = 'Alle passenden Grundrezepte gezeigt – jetzt improvisiert Kombi mit dem, was da ist.';

/** „Ähnliches“ unter den Grundrezepten: erkennbare Gemeinsamkeit, aber ein anderes Gericht (Nähe um 0,5). */
function aehnlichstes(puffer: Gericht[], zu: Gericht): number {
  let beste = -1;
  let besterWert = -1;
  puffer.forEach((p, i) => {
    const a = aehnlichkeit(kurz(p), kurz(zu));
    if (a < 0.25) return;
    const wert = 1 - Math.abs(a - 0.5) * 2;
    if (wert > besterWert) {
      besterWert = wert;
      beste = i;
    }
  });
  return beste;
}

const fehltText = (g: Gericht) => g.fehlt.map((f) => (f.menge !== null && f.einheit ? `${mengeText(f.menge, f.einheit)} ${f.name}` : f.name)).join(', ');

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
  const [gemerkt, setGemerkt] = useState(false);
  const [einplanen, setEinplanen] = useState<Gericht | null>(null);
  const [ergebnisHinweis, setErgebnisHinweis] = useState<string | null>(null);
  const [bausteinFormular, setBausteinFormular] = useState<BausteinIdee | null>(null);
  const [rezepte, setRezepte] = useState<Rezept[]>([]);
  const [optionenOffen, setOptionenOffen] = useState(false);
  const [rezeptListe, setRezeptListe] = useState<'kochbar' | 'fehlt'>('kochbar');

  useEffect(() => {
    try {
      localStorage.setItem(SPEICHER, JSON.stringify({ optionen, kuehlschrank }));
    } catch {
      // Speichern der Vorlieben ist nur Komfort
    }
  }, [optionen, kuehlschrank]);

  useEffect(() => {
    void ladeRezepte().then((r) => setRezepte(ohneDoppelte(r)));
  }, []);

  const gestartet = session.current !== null;

  function zeigeNaechstes(s: Session): boolean {
    const g = s.puffer.shift() ?? null;
    setAktuell(g);
    setGemerkt(false);
    if (g) s.gesehen.push(kurz(g));
    return g !== null;
  }

  /** Grundrezepte zeigen – lokal, ohne Wartezeit. */
  function zeigeGrundrezepte(s: Session, fest: Gericht[]) {
    setQuelle({ art: 'grundrezepte', anbieter: 'grundrezepte', hinweis: null });
    setMuster([]);
    setEinkauf(null);
    setNotfall(false);
    setBaustein(null);
    setErgebnisHinweis(null);
    s.puffer = [...fest];
    if (s.gespeichert) {
      s.warteschlange = s.warteschlange
        .then(() => protokolliereVorschlaege(s.id, fest, 'grundrezepte'))
        .then((ids) => ids.forEach((id) => s.protokolliert.add(id)))
        .catch(() => undefined);
    }
    zeigeNaechstes(s);
  }

  /** Improvisieren: KI (bzw. Kombi-Regeln) – erst, wenn die Grundrezepte nicht (mehr) passen. */
  async function anfordern(s: Session, modus: Modus, wechsel: string | null = null) {
    s.phase = 'improvisieren';
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
      setErgebnisHinweis([wechsel, e.hinweis].filter(Boolean).join(' ') || null);
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
      const snapshot = restSnapshot(await ladeSnapshot(kuehlschrank, { alleReste: grundmodus.art === 'reste' }), reserviert);
      // Frisch geladen – die Übersicht (direkt kochbar / es fehlt etwas) zieht nach, damit beides passt.
      onGeaendert();
      const id = uuid();
      const gespeichert = await starteSession(id, optionen, kuehlschrank).catch(() => false);
      const s: Session = {
        id, gespeichert, snapshot, optionen, kuehlschrank, grundmodus, phase: 'grundrezepte',
        gesehen: [], feedback: [], puffer: [], protokolliert: new Set(), warteschlange: Promise.resolve(),
      };
      session.current = s;
      setOptionenOffen(false);
      // Erst die festen Grundrezepte, die mit dem Vorrat direkt kochbar sind – dann improvisiert die KI.
      const fest = grundrezeptVorschlaege({
        snapshot, optionen, gesehen: [], favoriten: favoritenAus(rezepte), feedback: [], modus: grundmodus, anzahl: 25,
      });
      if (fest.length) {
        zeigeGrundrezepte(s, fest);
        setLaedt(false);
      } else {
        await anfordern(s, grundmodus, grundmodus.art === 'reste' ? KEIN_RESTE_GRUNDREZEPT : KEIN_GRUNDREZEPT);
      }
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
    setGemerkt(false);
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
    const weiterMachen = () => {
      setAbgang(null);
      if (aktion === 'similar') {
        // Unter den Grundrezepten etwas Ähnliches? Sonst improvisiert die KI etwas Ähnliches.
        const i = s.phase === 'grundrezepte' ? aehnlichstes(s.puffer, g) : -1;
        if (i >= 0) {
          s.puffer.unshift(...s.puffer.splice(i, 1));
          zeigeNaechstes(s);
          return;
        }
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
        // „Gerade etwas anderes“: sehr Ähnliches zurückstellen – ohne etwas zu lernen. Grundrezepte nur nach
        // hinten schieben: Jedes mögliche Grundrezept kommt dran, bevor improvisiert wird.
        const aehnlich = (p: Gericht) => aehnlichkeit(kurz(p), kurz(g)) >= 0.5;
        s.puffer = s.phase === 'grundrezepte'
          ? [...s.puffer.filter((p) => !aehnlich(p)), ...s.puffer.filter(aehnlich)]
          : s.puffer.filter((p) => !aehnlich(p));
      }
      if (!zeigeNaechstes(s)) void anfordern(s, s.grundmodus, s.phase === 'grundrezepte' ? ALLE_GEZEIGT : null);
    };
    if (wenigBewegung()) weiterMachen();
    else {
      setAbgang(ABGANG[aktion]);
      window.setTimeout(weiterMachen, 220);
    }
  }

  /** „Merken“ = gefällt mir + speichern. Gibt es das Rezept schon, wird es nicht noch einmal gespeichert. */
  async function rezeptSpeichern(g: Gericht) {
    const s = session.current;
    if (s && aktuell?.id === g.id) merkeFeedback(g, 'like');
    if (schonGespeichert(rezepte, g.name)) {
      setGemerkt(true);
      onMeldung(`${g.name} ist schon unter „Gemerkt“.`);
      return;
    }
    try {
      await s?.warteschlange;
      const aktionen = s?.feedback.filter((f) => f.vorschlag_id === g.id).map((f) => f.aktion) ?? [];
      await speichereRezept(g, s?.protokolliert.has(g.id) ?? false, [...aktionen, 'save']);
      merkeFeedback(g, 'save');
      setGemerkt(true);
      onMeldung(`${g.name} gemerkt – du findest es unten unter „Gemerkt“.`);
      setRezepte(ohneDoppelte(await ladeRezepte()));
    } catch (err) {
      onMeldung(fehlerText(err));
    }
  }

  /** „Kochen“ ist ein starkes Signal – gezählt wird es beim Öffnen der Rezeptseite. */
  function kochen(g: Gericht, planId: string | null, herkunft?: string) {
    if (session.current && aktuell?.id === g.id) merkeFeedback(g, 'cook');
    onKochen(g, planId, herkunft);
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

  // Alle Grundrezepte für den freien Vorrat (+ was zusätzlich genannt ist): direkt kochbar oder es fehlt etwas
  const uebersicht = useMemo(
    () => grundrezepteFuer(restSnapshot(baueSnapshotAus(bestand, kuehlschrank), reserviert), optionen),
    [bestand, kuehlschrank, reserviert, optionen],
  );
  const kochbar = uebersicht.filter((x) => x.kochbar);
  const fastKochbar = uebersicht.filter((x) => !x.kochbar);
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
      <KiStatus />
    </div>
  );

  const einstellungenText = [
    session.current?.grundmodus.art === 'reste' ? 'Reste verwerten' : null,
    `${optionen.personen} ${optionen.personen === 1 ? 'Person' : 'Personen'}`,
    optionen.max_minuten ? `${optionen.max_minuten} Min` : 'Zeit egal',
    reste > 0 ? `${reste} zusätzlich` : null,
  ].filter(Boolean) as string[];

  const heuteAnsicht = (
    <>
      {planung && heuteGeplant.length > 0 && (
        <section aria-label="Heute geplant">
          <ul className="liste mit-icon">
            {heuteGeplant.map((p) => (
              <li key={p.id}>
                <button type="button" className="zeile" onClick={() => kochen(p.daten.gericht!, p.id)}>
                  <span className="mini-teller"><GerichtBild g={p.daten.gericht!} groesse="klein" /></span>
                  <span className="zeile-haupt">
                    <span className="zeile-meta">{p.datum === heute ? 'Für heute geplant' : `Geplant: ${tagName(heute, p.datum!)}`}</span>
                    <span className="zeile-titel">{p.titel}</span>
                  </span>
                  <span className="idee-aktion">Kochen <Icon name="pfeil" groesse={15} /></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!gestartet && (
        <section className="essen-start" aria-label="Ideen aus deinem Vorrat">
          <h2>Ideen aus deinem Vorrat</h2>
          <p className="leise klein">Erst Grundrezepte, die du mit dem kochen kannst, was zu Hause ist – Lebensmittel, die bald weg müssen, zuerst. Passt keins, improvisiert Kombi.</p>
          <label className="feld">
            <span>Was hast du sonst noch da? <small>(optional)</small></span>
            <textarea
              rows={2}
              maxLength={1000}
              value={kuehlschrank}
              onChange={(e) => setKuehlschrank(e.target.value)}
              placeholder="z. B. Reis, Kokosmilch, eine halbe Paprika"
            />
            <small>Zutaten, die nicht im Vorrat stehen. Kombi nutzt sie, bucht sie aber nicht ab. „Halbe …“ oder „Rest …“ kommt zuerst dran.</small>
          </label>
          <button type="button" className="knopf haupt" onClick={() => void starten()} disabled={laedt}>
            {laedt ? 'Kombi überlegt …' : 'Ideen zeigen'}
          </button>
          <button type="button" className="knopf breit zweit" onClick={() => void starten({ art: 'reste' })} disabled={laedt}>
            Nur Reste verwerten
          </button>
        </section>
      )}

      <div className="einstellungen">
        <p className="meta">{einstellungenText.map((t) => <span key={t}>{t}</span>)}</p>
        <button type="button" className="link" onClick={() => setOptionenOffen((o) => !o)}>{optionenOffen ? 'Fertig' : 'Ändern'}</button>
        {gestartet && <button type="button" className="link" onClick={neuStarten}>Von vorn</button>}
      </div>
      {optionenOffen && optionenFelder}
      {!gestartet && (
        <p className="meta-text">
          Immer da: {GRUNDAUSSTATTUNG.join(', ')}.
          {reserviertSorten > 0 && ' Was für geplante Gerichte reserviert ist, schlägt Kombi nicht noch einmal vor.'}
        </p>
      )}

      {fehler && <p className="fehlerbox">{fehler}</p>}

      {laedt && gestartet && (
        <article className="gericht laedt" aria-live="polite">
          <div className="gericht-kopf"><span className="teller teller-karte teller-neutral" aria-hidden="true"><span className="teller-platte" /></span></div>
          <div className="gericht-inhalt">
            <p className="gericht-name serif">Kombi schaut in deinen Vorrat …</p>
            <p className="gericht-text">Gleich gibt’s Ideen aus dem, was da ist.</p>
          </div>
        </article>
      )}

      {!laedt && aktuell && (
        <div key={aktuell.id} className={`karten-buehne${abgang ? ` abgang-${abgang}` : ''}`}>
          <GerichtKarte
            g={aktuell}
            naehrwerte={naehrwerteGericht(aktuell, bestand)}
            aktionen={{
              onKochen: () => kochen(aktuell, null),
              onMerken: () => void rezeptSpeichern(aktuell),
              onEinplanen: planung ? () => setEinplanen(aktuell) : undefined,
              gemerkt,
            }}
          />
        </div>
      )}

      {!laedt && aktuell && (
        <div className="entscheidung" role="group" aria-label="Passt nicht?">
          <p className="entscheidung-titel">Passt nicht?</p>
          <div className="entscheidung-knoepfe">
            {ENTSCHEIDUNGEN.map((e) => (
              <button key={e.aktion} type="button" className={`e-${e.aktion}`} onClick={() => entscheiden(e.aktion)} aria-label={e.label}>
                <Icon name={e.icon} groesse={18} /> {e.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {!laedt && gestartet && (quelle || muster.length > 0 || ergebnisHinweis) && (
        <p className="meta-text">
          {ergebnisHinweis && `${ergebnisHinweis} `}
          {muster.length > 0 && `${muster.join(' ')} `}
          {quelle && (quelle.art === 'grundrezepte'
            ? 'Grundrezept aus deinem Grundvorrat – Mengen und Kalorien rechnet Kombi mit deinem Vorrat.'
            : quelle.art === 'ki' ? `Improvisiert von der KI (${quelle.anbieter}) – Mengen und Kalorien rechnet Kombi selbst.` : 'Improvisiert nach Kombi-Regeln (ohne KI).')}
          {quelle?.hinweis && ` ${quelle.hinweis}`}
        </p>
      )}

      {!laedt && gestartet && !aktuell && einkauf && (
        <div className="flaeche vorschlag">
          <div className="vorschlag-titel">
            <span className="zeile-meta">Mit einer Zutat mehr geht viel mehr</span>
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
        <div className="leer-karte">
          <span className="leer-icon" aria-hidden="true"><Icon name="essen" groesse={28} /></span>
          <h2>Gerade keine weiteren Ideen</h2>
          <p>
            {session.current?.grundmodus.art === 'reste'
              ? 'Es gibt gerade nichts, das dringend weg muss – oder es passt nicht sinnvoll zusammen.'
              : 'Kombi hat alles gezeigt, was zu deinen Einstellungen und deinem Vorrat passt.'}
            {optionen.max_minuten ? ` Mit mehr Zeit als ${optionen.max_minuten} Minuten findet Kombi oft mehr.` : ''}
          </p>
          {optionen.max_minuten ? (
            <button type="button" className="knopf haupt" onClick={() => {
              optionenAendern({ max_minuten: null });
              if (session.current) void anfordern(session.current, { art: 'normal' });
            }}>
              Ohne Zeitlimit suchen
            </button>
          ) : (
            <button type="button" className="knopf haupt" onClick={() => session.current && void anfordern(session.current, { art: 'normal' })}>
              Nochmal suchen
            </button>
          )}
          {planung && <button type="button" className="knopf breit zweit" onClick={() => onNav({ ansicht: 'woche' })}>Zum Wochenplan</button>}
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
                  <span className="zeile-meta">Idee zum Vorkochen</span>
                  <span className="zeile-titel">{baustein.name}</span>
                  <span className="zeile-meta">
                    {ARTEN_INFO.find((a) => a.id === baustein.bestandsart)!.name} · {farbInfo(baustein.farbe).bedeutung} · {baustein.portionen} Portionen
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

      {uebersicht.length > 0 && (!gestartet || !aktuell) && (
        <section className="abschnitt" aria-label="Grundrezepte">
          <div className="abschnitt-kopf">
            <h2>Grundrezepte</h2>
            <span className="abschnitt-zusatz">{kochbar.length} direkt kochbar</span>
          </div>
          <div className="segment klein" role="tablist" aria-label="Grundrezepte">
            <button type="button" role="tab" aria-selected={rezeptListe === 'kochbar'} className={rezeptListe === 'kochbar' ? 'gewaehlt' : ''} onClick={() => setRezeptListe('kochbar')}>
              Direkt kochbar · {kochbar.length}
            </button>
            <button type="button" role="tab" aria-selected={rezeptListe === 'fehlt'} className={rezeptListe === 'fehlt' ? 'gewaehlt' : ''} onClick={() => setRezeptListe('fehlt')}>
              Es fehlt etwas · {fastKochbar.length}
            </button>
          </div>
          {(rezeptListe === 'kochbar' ? kochbar : fastKochbar).length === 0 ? (
            <p className="leise klein abstand-oben">
              {rezeptListe === 'kochbar'
                ? 'Mit deinem Vorrat ist gerade kein Grundrezept vollständig – unter „Es fehlt etwas“ steht, was dir fehlt.'
                : 'Für jedes passende Grundrezept ist alles da.'}
            </p>
          ) : (
            <ul className="liste mit-icon abstand-oben">
              {(rezeptListe === 'kochbar' ? kochbar : fastKochbar).map(({ rezept, gericht }) => (
                <li key={rezept.id}>
                  <button type="button" className="zeile" onClick={() => kochen(gericht, null, 'Grundrezept')}>
                    <span className="mini-teller"><GerichtBild g={gericht} groesse="klein" /></span>
                    <span className="zeile-haupt">
                      <span className="zeile-titel">{gericht.name}</span>
                      {gericht.fehlt.length === 0
                        ? <span className="zeile-meta">Alles da · {gericht.zeit_min} Min</span>
                        : <span className="zeile-meta status-achtung">Fehlt: {fehltText(gericht)}</span>}
                    </span>
                    <Icon name="pfeil" groesse={16} className="zeile-pfeil" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {rezepte.length > 0 && (!gestartet || !aktuell) && (
        <section className="abschnitt" aria-label="Gemerkt">
          <div className="abschnitt-kopf"><h2>Gemerkt</h2><span className="abschnitt-zusatz">{rezepte.length} {rezepte.length === 1 ? 'Rezept' : 'Rezepte'}</span></div>
          <ul className="liste mit-icon">
            {rezepte.map((r) => (
              <li key={r.id}>
                <button type="button" className="zeile" onClick={() => kochen(r.daten, null, 'Gemerktes Rezept')}>
                  <span className="mini-teller"><GerichtBild g={r.daten} groesse="klein" /></span>
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
