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
import { reserviertAusser, restSnapshot, type AuftauEintrag } from '../supabase/functions/_shared/kombi/planung.ts';
import { fehlerText, type Sorte } from './api';
import {
  favoritenAus, holeVorschlaege, ladeRezepte, ladeSnapshot, protokolliereFeedback, protokolliereVorschlaege,
  speichereRezept, starteSession, type Quelle, type Rezept,
} from './essenApi';
import { GerichtKarte } from './GerichtKarte';
import { KochAnsicht } from './KochAnsicht';
import { Woche, TagWahl } from './Woche';
import { eintragHinzufuegen, planeGericht, type Plan } from './haushalt';
import { Blatt } from './Blatt';
import { SorteFormular } from './Sorten';
import { Icon, type IconName } from './Icon';
import { ARTEN_INFO, farbe as farbInfo, lagerort as lagerInfo } from './farben';
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
  bestand, baukasten, planung, heute, plaene, proPlan, reserviert, auftauEintraege, auftauen, nav, onNav, onMeldung, onGeaendert,
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
  const [kochen, setKochen] = useState<{ g: Gericht; planId: string | null } | null>(null);
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

  function gekocht(g: Gericht) {
    if (session.current && aktuell?.id === g.id) merkeFeedback(g, 'cook');
    onGeaendert();
  }

  async function fehlendesMerken(g: Gericht) {
    for (const f of g.fehlt) {
      await eintragHinzufuegen({
        name: f.name, menge: f.menge, einheit: f.einheit, kategorie: kategorieFuer(f.name), quelle: 'rezept', grund: `für ${g.name}`,
      });
    }
    onGeaendert();
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
    <div className="optionen" role="group" aria-label="Optionen">
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

  const heuteAnsicht = (
    <>
      {planung && heuteGeplant.length > 0 && (
        <section className="heute-geplant" aria-label="Heute geplant">
          {heuteGeplant.map((p) => (
            <div key={p.id} className="heute-plan">
              <span className="plan-emoji" aria-hidden="true">{p.daten.gericht!.emoji}</span>
              <span className="plan-titel">
                <span className={`plan-tag${p.datum! < heute ? ' vorbei' : ' heute'}`}>{p.datum === heute ? 'Heute geplant' : `Geplant: ${tagName(heute, p.datum!)}`}</span>
                <strong>{p.titel}</strong>
              </span>
              <button type="button" className="knopf klein-knopf haupt-klein" onClick={() => setKochen({ g: p.daten.gericht!, planId: p.id })}>
                <Icon name="pfanne" groesse={16} /> Kochen
              </button>
            </div>
          ))}
        </section>
      )}

      {!gestartet && (
        <div className="essen-start">
          <div className="karte-flach">{optionenFelder}</div>
          <label className="feld karte-flach">
            <span className="feld-titel">Was muss weg?</span>
            <textarea
              rows={3}
              maxLength={1000}
              value={kuehlschrank}
              onChange={(e) => setKuehlschrank(e.target.value)}
              placeholder="Reste aus dem Kühlschrank, z. B. eine halbe Paprika, etwas Frischkäse"
            />
            <small>Immer da: {GRUNDAUSSTATTUNG.join(', ')}. Alles andere kommt aus eurem Vorrat.</small>
          </label>
          <button type="button" className="knopf haupt" onClick={() => void starten()} disabled={laedt}>
            <Icon name="funken" /> {laedt ? 'Kombi überlegt …' : 'Vorschläge holen'}
          </button>
          <button type="button" className="knopf breit" onClick={() => void starten({ art: 'reste' })} disabled={laedt}>
            <Icon name="blatt" /> Reste zuerst verwerten
          </button>
          {reserviertSorten > 0 && (
            <p className="leise klein essen-reserviert">
              <Icon name="kalender" groesse={14} /> {reserviertSorten} {reserviertSorten === 1 ? 'Sorte ist' : 'Sorten sind'} ganz oder teilweise für geplante Mahlzeiten reserviert – das wird nicht noch einmal vorgeschlagen.
            </p>
          )}
        </div>
      )}

      {gestartet && (
        <div className="essen-leiste">
          <p className="essen-kurz">
            {session.current?.grundmodus.art === 'reste' && <strong className="modus-marke">Reste verwerten · </strong>}
            {optionen.personen} {optionen.personen === 1 ? 'Person' : 'Personen'} · {optionen.max_minuten ? `${optionen.max_minuten} Min.` : 'Zeit egal'}
            {optionen.guenstig && ' · günstig'}{reste > 0 && ` · ${reste} ${reste === 1 ? 'Rest' : 'Reste'}`}
          </p>
          <button type="button" className="link" onClick={() => setOptionenOffen((o) => !o)}>{optionenOffen ? 'Fertig' : 'Ändern'}</button>
          <button type="button" className="link" onClick={neuStarten}>Neu</button>
        </div>
      )}
      {gestartet && optionenOffen && <div className="karte-flach">{optionenFelder}</div>}

      {fehler && <p className="fehlerbox">{fehler}</p>}

      {laedt && gestartet && (
        <div className="essen-karte laedt" aria-live="polite">
          <div className="karte-hero"><span className="karte-emoji denkt" aria-hidden="true">🍳</span></div>
          <div className="karte-inhalt">
            <p className="gericht-name">Kombi schaut in euren Vorrat …</p>
            <p className="leise">Gleich gibt’s Ideen aus dem, was da ist.</p>
          </div>
        </div>
      )}

      {!laedt && aktuell && (
        <div key={aktuell.id} className={`karten-buehne${abgang ? ` abgang-${abgang}` : ''}`}>
          <GerichtKarte g={aktuell} />
        </div>
      )}

      {!laedt && gestartet && (quelle || muster.length > 0) && (
        <div className="essen-info">
          {muster.length > 0 && <p><Icon name="info" groesse={14} /> {muster.join(' ')}</p>}
          {quelle && (
            <p className="leise">
              {quelle.art === 'ki' ? `Ideen von der KI (${quelle.anbieter}) – Mengen und Preise rechnet Kombi selbst.` : 'Demo ohne KI: nach Kombi-Regeln.'}
              {quelle.hinweis && ` ${quelle.hinweis}`}
            </p>
          )}
        </div>
      )}

      {!laedt && gestartet && ergebnisHinweis && (
        <p className="essen-hinweis"><Icon name="info" groesse={18} /> {ergebnisHinweis}</p>
      )}

      {!laedt && gestartet && !aktuell && einkauf && (
        <article className="essen-karte notfall">
          <div className="karte-inhalt">
            <p className="ueberzeile"><Icon name="korb" groesse={16} /> Eine Sache fehlt</p>
            <h3 className="gericht-name">{einkauf.name}</h3>
            <p className="gericht-beschreibung">{einkauf.begruendung}</p>
            {einkauf.heute && <p className="heute-kombi"><strong>Heute z. B.:</strong> {einkauf.heute}</p>}
            <ul className="gruende">
              {einkauf.gruende.map((g) => <li key={g}>{g}</li>)}
            </ul>
            <details className="gericht-details">
              <summary>Damit möglich ({einkauf.ermoeglicht.length})</summary>
              <p className="chips">{einkauf.ermoeglicht.map((e) => <span key={e} className="chip-statisch">{e}</span>)}</p>
            </details>
            <button type="button" className="link" onClick={() => session.current && void anfordern(session.current, { art: 'normal' })}>
              Trotzdem weitersuchen
            </button>
          </div>
        </article>
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
        <p className="essen-tipp"><Icon name="korb" groesse={16} /> Mit <strong>{einkauf.name}</strong> wären {einkauf.ermoeglicht.length} weitere Gerichte möglich.</p>
      )}

      {!laedt && baustein && (
        <article className={`baustein-idee f-${baustein.farbe}`}>
          <p className="ueberzeile"><Icon name="funken" groesse={16} /> Idee für euren Baukasten</p>
          <h3>{baustein.name}</h3>
          <p className="leise">
            {ARTEN_INFO.find((a) => a.id === baustein.bestandsart)!.name} · {farbInfo(baustein.farbe).bedeutung} · {lagerInfo(baustein.lagerort).name} ·{' '}
            {baustein.portionen} Portionen{baustein.portion_g ? ` à ${baustein.portion_g} g` : ''} · {kostenText(baustein.kosten)}
          </p>
          {baustein.zutaten.length > 0 && <p className="leise klein">Aus: {baustein.zutaten.join(', ')}</p>}
          {baustein.begruendung && <p>{baustein.begruendung}</p>}
          <p className="leise klein">Später für: {baustein.verwendbar_fuer.join(', ')}</p>
          <div className="knopf-reihe">
            <button type="button" className="knopf" onClick={() => setBausteinFormular(baustein)}>Baustein übernehmen</button>
            <button type="button" className="link" onClick={() => setBaustein(null)}>Nein danke</button>
          </div>
        </article>
      )}

      {rezepte.length > 0 && (!gestartet || !aktuell) && (
        <section className="gruppe">
          <h2 className="abschnitt-titel">Gespeichert</h2>
          <ul className="liste">
            {rezepte.map((r) => (
              <li key={r.id} className="zeile">
                <span className="zeile-emoji" aria-hidden="true">{r.daten.emoji}</span>
                <button type="button" className="zeile-info" onClick={() => setRezeptOffen(r)}>
                  <span className="zeile-name">{r.name}</span>
                  <span className="zeile-details">{r.daten.zeit_min} Min. · {kostenText(r.daten.kosten)}</span>
                </button>
                <span className="pfeil" aria-hidden="true"><Icon name="pfeil" groesse={18} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!laedt && aktuell && gemocht && (
        <div className="entscheidung danach" role="group" aria-label="Gefällt dir – und jetzt?">
          <button type="button" onClick={() => void rezeptSpeichern(aktuell)} aria-label="Rezept speichern">
            <span className="kreis"><Icon name="stern" /></span>Speichern
          </button>
          <button type="button" className="haupt" onClick={() => setKochen({ g: aktuell, planId: null })} aria-label="Heute kochen">
            <span className="kreis"><Icon name="pfanne" /></span>Heute kochen
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

    </>
  );

  return (
    <section className="essen">
      {planung && (
        <div className="segment essen-umschalter" role="tablist" aria-label="Essen">
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
          onKochen={(g, planId) => setKochen({ g, planId })}
          onMeldung={onMeldung}
          onGeaendert={onGeaendert}
        />
      ) : heuteAnsicht}

      {kochen && (
        <KochAnsicht
          gericht={kochen.g}
          planId={kochen.planId}
          bestand={bestand}
          reserviert={reserviertAusser(proPlan, plaene, kochen.planId)}
          planung={planung}
          onGekocht={() => gekocht(kochen.g)}
          onMeldung={onMeldung}
          onFehlendesMerken={planung ? () => fehlendesMerken(kochen.g) : undefined}
          onSchliessen={() => setKochen(null)}
        />
      )}

      {einplanen && (
        <TagWahl heute={heute} titel={`${einplanen.name} einplanen`} untertitel="Für welchen Tag?" onWahl={(d) => void planen(einplanen, d)} onSchliessen={() => setEinplanen(null)} />
      )}

      {rezeptOffen && (
        <Blatt titel={rezeptOffen.name} untertitel={`Gespeichert am ${new Date(rezeptOffen.erstellt_am).toLocaleDateString('de-DE')}`} onSchliessen={() => setRezeptOffen(null)}>
          <GerichtKarte g={rezeptOffen.daten} />
          <p className="leise klein">Mengen und Kosten von damals. Beim Kochen prüft Kombi den aktuellen Vorrat.</p>
          <button
            type="button"
            className="knopf haupt"
            onClick={() => {
              setKochen({ g: rezeptOffen.daten, planId: null });
              setRezeptOffen(null);
            }}
          >
            <Icon name="pfanne" /> Heute kochen
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
