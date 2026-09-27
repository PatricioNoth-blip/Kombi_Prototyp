import { useEffect, useRef, useState } from 'react';
import type {
  Aktion, BausteinIdee, Einkaufsvorschlag, FeedbackEintrag, Gericht, GerichtKurz, Modus, Optionen, Snapshot,
} from '../supabase/functions/_shared/kombi/typen.ts';
import { kurz } from '../supabase/functions/_shared/kombi/bewertung.ts';
import { aehnlichkeit } from '../supabase/functions/_shared/kombi/aehnlichkeit.ts';
import { berechneLeitplanken, verletztAusschluss } from '../supabase/functions/_shared/kombi/praeferenz.ts';
import { GRUNDAUSSTATTUNG, kuehlschrankEintraege } from '../supabase/functions/_shared/kombi/snapshot.ts';
import { kochenBestaetigen, type EntnahmePosten } from '../supabase/functions/_shared/kombi/aktionen.ts';
import { uuid } from '../supabase/functions/_shared/kombi/id.ts';
import * as api from './api';
import { fehlerText } from './api';
import {
  holeVorschlaege, ladeRezepte, ladeSnapshot, protokolliereFeedback, protokolliereVorschlaege,
  speichereRezept, starteSession, type Quelle, type Rezept,
} from './essenApi';
import { GerichtKarte } from './GerichtKarte';
import { KochenBlatt } from './KochenBlatt';
import { Blatt } from './Blatt';
import { SorteFormular } from './Sorten';
import { farbe as farbInfo } from './farben';
import { euro } from './format';

type Props = {
  onMeldung: (text: string, rueckgaengig?: number[]) => void;
  onBestandGeaendert: () => void;
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
};

const SPEICHER = 'kombi-essen';
const PERSONEN = [1, 2, 3, 4];
const MINUTEN: (number | null)[] = [10, 15, 20, 30, null];
const START_OPTIONEN: Optionen = { personen: 2, max_minuten: 15, guenstig: true };

function ladeVorlieben(): { optionen: Optionen; kuehlschrank: string } {
  try {
    const d = JSON.parse(localStorage.getItem(SPEICHER) ?? '{}');
    return { optionen: { ...START_OPTIONEN, ...(d.optionen ?? {}) }, kuehlschrank: typeof d.kuehlschrank === 'string' ? d.kuehlschrank : '' };
  } catch {
    return { optionen: START_OPTIONEN, kuehlschrank: '' };
  }
}

export function Essen({ onMeldung, onBestandGeaendert }: Props) {
  const [optionen, setOptionen] = useState<Optionen>(() => ladeVorlieben().optionen);
  const [kuehlschrank, setKuehlschrank] = useState(() => ladeVorlieben().kuehlschrank);
  const session = useRef<Session | null>(null);

  const [aktuell, setAktuell] = useState<Gericht | null>(null);
  const [einkauf, setEinkauf] = useState<Einkaufsvorschlag | null>(null);
  const [notfall, setNotfall] = useState(false);
  const [baustein, setBaustein] = useState<BausteinIdee | null>(null);
  const [muster, setMuster] = useState<string[]>([]);
  const [quelle, setQuelle] = useState<{ art: Quelle; anbieter: string; hinweis: string | null } | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gemocht, setGemocht] = useState(false);
  const [kochen, setKochen] = useState<Gericht | null>(null);
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

  async function starten() {
    setLaedt(true);
    setFehler(null);
    try {
      const snapshot = await ladeSnapshot(kuehlschrank);
      const id = uuid();
      const gespeichert = await starteSession(id, optionen, kuehlschrank).catch(() => false);
      const s: Session = {
        id, gespeichert, snapshot, optionen, kuehlschrank,
        gesehen: [], feedback: [], puffer: [], protokolliert: new Set(), warteschlange: Promise.resolve(),
      };
      session.current = s;
      await anfordern(s, { art: 'normal' });
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
  }

  function merkeFeedback(g: Gericht, aktion: Aktion) {
    const s = session.current;
    if (!s) return;
    s.feedback.push({ ...kurz(g), aktion, vorschlag_id: g.id });
    s.warteschlange = s.warteschlange
      .then(() => (s.protokolliert.has(g.id) ? protokolliereFeedback(g.id, aktion) : undefined))
      .catch(() => undefined);
  }

  function entscheiden(aktion: 'like' | 'dislike' | 'similar' | 'skip') {
    const s = session.current;
    const g = aktuell;
    if (!s || !g) return;
    merkeFeedback(g, aktion);

    if (aktion === 'like') {
      setGemocht(true);
      return;
    }
    if (aktion === 'similar') {
      s.puffer = [];
      void anfordern(s, { art: 'aehnlich', zu: kurz(g) });
      return;
    }
    if (aktion === 'dislike') {
      // Vorgemerkte Vorschläge, die dem abgelehnten zu sehr ähneln oder jetzt ausgeschlossen sind, fallen weg.
      const l = berechneLeitplanken(s.feedback, { art: 'normal' });
      s.puffer = s.puffer.filter((p) => aehnlichkeit(kurz(p), kurz(g)) < 0.6 && !verletztAusschluss(kurz(p), l));
      setMuster(l.muster);
    }
    if (!zeigeNaechstes(s)) void anfordern(s, { art: 'normal' });
  }

  function weiter() {
    const s = session.current;
    if (!s) return;
    if (!zeigeNaechstes(s)) void anfordern(s, { art: 'normal' });
  }

  async function rezeptSpeichern(g: Gericht) {
    try {
      await session.current?.warteschlange;
      await speichereRezept(g, session.current?.protokolliert.has(g.id) ?? false);
      merkeFeedback(g, 'save');
      onMeldung(`⭐ ${g.name} gespeichert.`);
      setRezepte(await ladeRezepte());
    } catch (err) {
      onMeldung(fehlerText(err));
    }
  }

  async function gekocht(g: Gericht, posten: EntnahmePosten[]) {
    const ergebnis = await kochenBestaetigen(posten, { entnehmen: api.entnehmen });
    setKochen(null);
    setRezeptOffen(null);
    if (session.current && aktuell?.id === g.id) merkeFeedback(g, 'cook');
    const anzahl = posten.reduce((s, p) => s + p.anzahl, 0);
    if (ergebnis.fehler.length) {
      onMeldung(`Nicht alles ausgetragen: ${ergebnis.fehler.map((f) => `${f.name} – ${f.meldung}`).join(' ')}`, ergebnis.bewegungIds);
    } else {
      onMeldung(`🍳 ${g.name}: ${anzahl} ${anzahl === 1 ? 'Block' : 'Blöcke'} ausgetragen.`, ergebnis.bewegungIds);
    }
    onBestandGeaendert();
  }

  const kuehlschrankAnzahl = kuehlschrankEintraege(kuehlschrank).length;
  const optionenAendern = (neu: Partial<Optionen>) => {
    const o = { ...optionen, ...neu };
    setOptionen(o);
    if (session.current) session.current.optionen = o;
  };

  return (
    <section className="essen">
      <h2 className="essen-titel">🍽️ Was essen wir heute?</h2>

      {gestartet && !optionenOffen ? (
        <p className="essen-kurz">
          👥 {optionen.personen} · ⏱️ {optionen.max_minuten ? `${optionen.max_minuten}′` : 'egal'}
          {optionen.guenstig && ' · 💰 günstig'} · 🧊 {kuehlschrankAnzahl} ·{' '}
          <button type="button" className="link" onClick={() => setOptionenOffen(true)}>ändern</button> ·{' '}
          <button type="button" className="link" onClick={neuStarten}>neu starten</button>
        </p>
      ) : (
      <div className="essen-optionen" role="group" aria-label="Optionen">
        <div className="chip-reihe" aria-label="Personen">
          <span className="chip-label">👥</span>
          {PERSONEN.map((p) => (
            <button key={p} type="button" className={`chip${optionen.personen === p ? ' gewaehlt' : ''}`}
              aria-pressed={optionen.personen === p} onClick={() => optionenAendern({ personen: p })}>
              {p}
            </button>
          ))}
        </div>
        <div className="chip-reihe" aria-label="Maximale Zeit">
          <span className="chip-label">⏱️</span>
          {MINUTEN.map((m) => (
            <button key={String(m)} type="button" className={`chip${optionen.max_minuten === m ? ' gewaehlt' : ''}`}
              aria-pressed={optionen.max_minuten === m} onClick={() => optionenAendern({ max_minuten: m })}>
              {m ? `${m}′` : 'egal'}
            </button>
          ))}
        </div>
        <div className="chip-reihe">
          <button type="button" className={`chip${optionen.guenstig ? ' gewaehlt' : ''}`}
            aria-pressed={optionen.guenstig} onClick={() => optionenAendern({ guenstig: !optionen.guenstig })}>
            💰 möglichst günstig
          </button>
          {gestartet && (
            <button type="button" className="link" onClick={() => setOptionenOffen(false)}>fertig</button>
          )}
        </div>
      </div>
      )}

      {!gestartet ? (
        <div className="essen-start">
          <label className="feld">
            Was hast du noch im Kühlschrank?
            <textarea
              rows={3}
              maxLength={1000}
              value={kuehlschrank}
              onChange={(e) => setKuehlschrank(e.target.value)}
              placeholder="z. B. eine halbe Paprika, etwas Frischkäse, angebrochener Mais"
            />
          </label>
          <p className="leise klein">Immer vorhanden: {GRUNDAUSSTATTUNG.join(', ')}. Alles andere kommt aus eurem Bestand.</p>
          <button type="button" className="knopf haupt" onClick={() => void starten()} disabled={laedt}>
            {laedt ? 'Kombi überlegt …' : '✨ Vorschläge holen'}
          </button>
        </div>
      ) : null}

      {quelle && (
        <p className={`essen-quelle ${quelle.art}`}>
          {quelle.art === 'ki' ? `✨ KI-Vorschläge (${quelle.anbieter})` : '🎲 Ohne KI, nach Kombi-Regeln'}
          {quelle.hinweis && <span className="leise"> – {quelle.hinweis}</span>}
        </p>
      )}
      {fehler && <p className="fehlerbox">{fehler}</p>}

      {laedt && gestartet && (
        <div className="gericht gericht-laedt" aria-live="polite">
          <div className="gericht-emoji">🤔</div>
          <p>Kombi überlegt, was ihr aus eurem Vorrat machen könnt …</p>
        </div>
      )}

      {!laedt && aktuell && <GerichtKarte g={aktuell} />}


      {muster.length > 0 && (
        <p className="essen-muster">🧠 {muster.join(' ')}</p>
      )}

      {!laedt && gestartet && !aktuell && einkauf && (
        <div className="gericht notfall">
          <div className="gericht-emoji">😅</div>
          <h3 className="gericht-name">Dein Vorrat ist gerade etwas schwierig.</h3>
          <p>Mit einem Einkauf kann ich dir {einkauf.ermoeglicht.length} neue Möglichkeiten eröffnen:</p>
          <p className="einkauf-zeile">
            🛒 <strong>{einkauf.name}</strong> – {einkauf.preis_cent === null ? 'Preis unbekannt' : euro(einkauf.preis_cent)}
          </p>
          <p className="leise">{einkauf.begruendung}</p>
          <p>Damit sind unter anderem möglich:</p>
          <ul className="einkauf-liste">
            {einkauf.ermoeglicht.map((e) => <li key={e}>{e}</li>)}
          </ul>
          <button type="button" className="link" onClick={() => session.current && void anfordern(session.current, { art: 'normal' })}>
            Trotzdem weitersuchen
          </button>
        </div>
      )}

      {!laedt && gestartet && !aktuell && !einkauf && (
        <div className="gericht">
          <div className="gericht-emoji">🤷</div>
          <p>Gerade keine weiteren passenden Ideen.</p>
          <button type="button" className="knopf" onClick={() => session.current && void anfordern(session.current, { art: 'normal' })}>
            Nochmal suchen
          </button>
        </div>
      )}

      {!laedt && aktuell && notfall && einkauf && (
        <p className="essen-tipp">🛒 Tipp: Mit <strong>{einkauf.name}</strong> wären {einkauf.ermoeglicht.length} weitere Gerichte möglich.</p>
      )}

      {!laedt && baustein && (
        <div className={`baustein-idee f-${baustein.farbe}`}>
          <p><strong>💡 Neue Kombi-Idee:</strong> „{baustein.name}“</p>
          <p className="leise">
            <span className="punkt" aria-hidden="true" /> {farbInfo(baustein.farbe).name} · {baustein.portionen} Portionen vorkochen und einfrieren.
            {baustein.begruendung && ` ${baustein.begruendung}`}
          </p>
          <p className="leise">Später verwendbar für: {baustein.verwendbar_fuer.join(', ')}</p>
          <div className="baustein-knoepfe">
            <button type="button" className="knopf" onClick={() => setBausteinFormular(baustein)}>Baustein übernehmen</button>
            <button type="button" className="link" onClick={() => setBaustein(null)}>Nein danke</button>
          </div>
        </div>
      )}

      {rezepte.length > 0 && (
        <section className="abschnitt">
          <h3>⭐ Gespeicherte Rezepte</h3>
          <ul className="liste">
            {rezepte.map((r) => (
              <li key={r.id} className="zeile f-rot">
                <button type="button" className="zeile-info" onClick={() => setRezeptOffen(r)}>
                  <span className="zeile-name">{r.daten.emoji} {r.name}</span>
                  <span className="zeile-details">
                    ⏱️ {r.daten.zeit_min} Min. · {euro(r.daten.kosten.pro_portion_cent)} / Portion
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!laedt && aktuell && gemocht && (
        <div className="unten-leiste entscheidung essen-danach" role="group" aria-label="Gefällt dir – und jetzt?">
          <button type="button" onClick={() => void rezeptSpeichern(aktuell)} aria-label="Rezept speichern"><span>⭐</span>Speichern</button>
          <button type="button" className="mag" onClick={() => setKochen(aktuell)} aria-label="Heute kochen"><span>🍳</span>Heute kochen</button>
          <button type="button" onClick={weiter} aria-label="Weitere Vorschläge"><span>➡️</span>Weiter</button>
        </div>
      )}

      {!laedt && aktuell && !gemocht && (
        <div className="unten-leiste entscheidung" role="group" aria-label="Entscheidung">
          <button type="button" onClick={() => entscheiden('dislike')} aria-label="Nicht meins"><span>👎</span>Nicht meins</button>
          <button type="button" onClick={() => entscheiden('similar')} aria-label="Ähnliches zeigen"><span>🔄</span>Ähnlich</button>
          <button type="button" onClick={() => entscheiden('skip')} aria-label="Überspringen"><span>➡️</span>Weiter</button>
          <button type="button" className="mag" onClick={() => entscheiden('like')} aria-label="Gefällt mir"><span>❤️</span>Gefällt mir</button>
        </div>
      )}

      {kochen && (
        <KochenBlatt gericht={kochen} onBestaetigen={(p) => gekocht(kochen, p)} onSchliessen={() => setKochen(null)} />
      )}

      {rezeptOffen && (
        <Blatt titel="Gespeichertes Rezept" onSchliessen={() => setRezeptOffen(null)}>
          <GerichtKarte g={rezeptOffen.daten} />
          <p className="leise klein">Gespeichert am {new Date(rezeptOffen.erstellt_am).toLocaleDateString('de-DE')} – Preise und Mengen von damals.</p>
          <button
            type="button"
            className="knopf haupt"
            onClick={() => {
              setKochen(rezeptOffen.daten);
              setRezeptOffen(null);
            }}
          >
            🍳 Heute kochen
          </button>
        </Blatt>
      )}

      {bausteinFormular && (
        <SorteFormular
          sorte={null}
          vorlage={{ name: bausteinFormular.name, farbe: bausteinFormular.farbe, lagerort: 'gefrierfach' }}
          onFertig={(text) => {
            setBausteinFormular(null);
            setBaustein(null);
            onMeldung(`💡 ${text} Jetzt vorkochen und einfrieren.`);
            onBestandGeaendert();
          }}
          onSchliessen={() => setBausteinFormular(null)}
        />
      )}
    </section>
  );
}
