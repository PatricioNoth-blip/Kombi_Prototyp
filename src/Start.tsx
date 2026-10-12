import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Gericht, KomponentenVorschlag, Optionen } from '../supabase/functions/_shared/kombi/typen.ts';
import { mangelVorschlaege, type Einkaufsliste, type PlanStand } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { restSnapshot } from '../supabase/functions/_shared/kombi/planung.ts';
import { erzeugeKomponenten, erzeugeVorschlaege } from '../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { euroText } from '../supabase/functions/_shared/kombi/kosten.ts';
import { fehlerText, type Sorte } from './api';
import { baueSnapshotAus } from './essenApi';
import { alsVorratSorte, ausgabeEintragen, ausgabeEntfernen, type Haushaltsdaten } from './haushalt';
import { GerichtBild } from './GerichtBild';
import { Blatt } from './Blatt';
import { SoGehts } from './Hilfe';
import { Icon, type IconName } from './Icon';
import { euro, euroKompakt, euroZuCent } from './format';
import {
  monatsbilanz, produktionsZeile, sinnvolleProduktion, startAbschnitte, startVorschlaege, tagesuebersicht,
  type Monatsbilanz, type StartAbschnitt, type StartVorschlag, type Tagesuebersicht,
} from './startseite';
import { nachzukochen, vorratsLage, vorratsLageText } from './dashboard';
import type { Bereich } from './navigation';

type Props = {
  bestand: Sorte[];
  heute: string;
  h: Haushaltsdaten;
  liste: Einkaufsliste;
  proPlan: Map<string, PlanStand[]>;
  /** „Auftauen“ (fertig gerendert, kann leer sein) und ob heute etwas fällig ist */
  auftauen: ReactNode;
  auftauFaellig: number;
  /** lokal nach Kombi-Regeln berechnet (null = wird berechnet) */
  ideen: LokaleIdeen | null;
  /** öffnet die Rezeptseite – dort wird erst nach Bestätigung etwas aus dem Vorrat genommen */
  onKochen: (g: Gericht, planId: string | null) => void;
  onBereich: (b: Bereich) => void;
  /** Einbuchen-Dialog öffnen (etwas in den Vorrat aufnehmen) */
  onEinbuchen: () => void;
  /** „So funktioniert Kombi“ öffnen */
  onHilfe: () => void;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void;
  onGeaendert: () => void;
};

const START_OPTIONEN: Optionen = { personen: 2, max_minuten: 15, guenstig: true };

/** Dieselben Vorlieben wie unter „Essen“ (Personen, Zeit, günstig) */
function optionenAusEssen(): Optionen {
  try {
    const d = JSON.parse(localStorage.getItem('kombi-essen') ?? '{}');
    return { ...START_OPTIONEN, ...(d.optionen ?? {}) };
  } catch {
    return START_OPTIONEN;
  }
}

/**
 * Ein Vorschlag aus dem freien Vorrat – lokal nach Kombi-Regeln, ohne KI-Aufruf: schnell,
 * nachvollziehbar und ohne erfundene Werte. Weitere Ideen (auch von der KI) gibt es unter „Essen“.
 */
export type LokaleIdeen = { gerichte: Gericht[]; komponenten: KomponentenVorschlag[] };

export function useLokaleIdeen(bestand: Sorte[] | null, reserviert: Map<number, number>) {
  const [ideen, setIdeen] = useState<LokaleIdeen | null>(null);
  useEffect(() => {
    if (!bestand) return;
    let aktiv = true;
    const snapshot = restSnapshot(baueSnapshotAus(bestand, ''), reserviert);
    const basis = { snapshot, optionen: optionenAusEssen(), gesehen: [], favoriten: [], feedback: [], modus: { art: 'normal' as const } };
    Promise.all([
      erzeugeVorschlaege(regelbasiert(), { ...basis, anzahl: 3 }),
      erzeugeKomponenten(regelbasiert(), { ...basis, anzahl: 6, aufgabe: 'komponenten' }),
    ]).then(([g, k]) => {
      if (aktiv) setIdeen({ gerichte: g.gerichte, komponenten: k.komponenten });
    }).catch(() => {
      if (aktiv) setIdeen({ gerichte: [], komponenten: [] });
    });
    return () => {
      aktiv = false;
    };
  }, [bestand, reserviert]);
  return ideen;
}

const ZIEL_SPEICHER = 'kombi-kcal-ziel';

/** Persönliches Tagesziel – je Gerät (jede Person hat ihr eigenes Handy), optional. */
function ladeZiel(): number | null {
  try {
    const z = Number(localStorage.getItem(ZIEL_SPEICHER));
    return Number.isFinite(z) && z >= 500 && z <= 8000 ? Math.round(z) : null;
  } catch {
    return null;
  }
}

const kcalZahl = (n: number) => n.toLocaleString('de-DE');

const WILLKOMMEN_SPEICHER = 'kombi-willkommen';

function willkommenGesehen(): boolean {
  try {
    return localStorage.getItem(WILLKOMMEN_SPEICHER) === '1';
  } catch {
    return false;
  }
}

/**
 * Die Startseite beantwortet eine Frage: „Was möchtest du heute kochen?“ (steht als Überschrift oben).
 * Darunter EIN großer Vorschlag aus dem Vorrat mit „Jetzt kochen“, zwei weitere Ideen und – ruhig und
 * nachrangig – der Überblick über den Haushalt. Kennzahlen öffnen sich erst beim Antippen.
 */
export function Start({ bestand, heute, h, liste, proPlan, auftauen, auftauFaellig, ideen, onKochen, onBereich, onEinbuchen, onHilfe, onMeldung, onGeaendert }: Props) {
  const [geldOffen, setGeldOffen] = useState(false);
  const [tagOffen, setTagOffen] = useState(false);
  const [ziel, setZiel] = useState<number | null>(ladeZiel);
  const [willkommen, setWillkommen] = useState(() => !willkommenGesehen());

  if (bestand.length === 0) return <ErsterStart onEinbuchen={onEinbuchen} onBereich={onBereich} onHilfe={onHilfe} />;

  const bilanz = monatsbilanz(h, heute);
  const tag = tagesuebersicht(h.mahlzeiten, h.sonstige, heute, ziel);
  const lage = vorratsLage(bestand, heute);
  const gekochtHeute = h.mahlzeiten.filter((m) => !m.rueckgaengig && m.datum === heute).map((m) => m.titel);
  const vorschlaege = startVorschlaege(h.plaene, ideen?.gerichte ?? [], gekochtHeute, heute);
  const [held, ...weitere] = vorschlaege;

  const vorgemerkt = h.plaene.filter((p) => p.art === 'komponente').map((p) => {
    const stand = proPlan.get(p.id) ?? [];
    return { plan_id: p.id, titel: p.titel, portionen: p.portionen, alles_da: stand.every((x) => x.fehlt === 0) };
  });
  const produktion = produktionsZeile(nachzukochen(bestand, heute), sinnvolleProduktion(vorgemerkt, ideen?.komponenten ?? []), vorgemerkt.length);
  const offen = liste.zeilen.filter((z) => z.status === 'offen');
  // Zutaten unter dem Mindestbestand, die noch nicht auf der Liste stehen – dieselbe Rechnung wie im Einkauf („Fast leer“)
  const nachzukaufen = mangelVorschlaege(bestand.map(alsVorratSorte), liste.zeilen).filter((m) => m.aktion === 'kaufen');

  function verstanden() {
    setWillkommen(false);
    try {
      localStorage.setItem(WILLKOMMEN_SPEICHER, '1');
    } catch {
      // nur Komfort
    }
  }

  const teile: Record<StartAbschnitt, () => ReactNode> = {
    essen: () => (
      <section key="essen" className="start-block" aria-label="Vorschläge für heute">
        {held ? (
          <HeldKarte v={held} onKochen={() => onKochen(held.g, held.planId)} />
        ) : (
          <KeinVorschlag laedt={ideen === null} onBereich={onBereich} onEinbuchen={onEinbuchen} />
        )}
        {weitere.length > 0 && (
          <>
            <div className="start-kopf">
              <h2>Oder lieber …</h2>
              <button type="button" className="mehr-link" onClick={() => onBereich('essen')}>Mehr Ideen <Icon name="pfeil" groesse={15} /></button>
            </div>
            <ul className="ideen-liste">
              {weitere.map((v) => (
                <li key={v.g.id}><IdeeZeile v={v} onKochen={() => onKochen(v.g, v.planId)} /></li>
              ))}
            </ul>
          </>
        )}
      </section>
    ),
    auftauen: () => <div key="auftauen">{auftauen}</div>,
    willkommen: () => <Willkommen key="willkommen" onVerstanden={verstanden} onHilfe={onHilfe} />,
    ueberblick: () => (
      <section key="ueberblick" className="start-block ueberblick" aria-label="Dein Haushalt">
        <h2 className="start-ueber">Dein Haushalt</h2>
        <ul className="liste mit-icon">
          <UeberblickZeile icon="vorrat" ton="ton-gruen" titel="Vorrat" onClick={() => onBereich('vorrat')}
            text={[`${lage.artikel} Artikel da`, vorratsLageText({ ...lage, knapp: 0, aufgebraucht: 0 })].filter(Boolean).join(' · ')}
            achtung={lage.abgelaufen + lage.bald > 0} />
          <UeberblickZeile icon="wagen" ton="ton-blau" titel="Einkaufsliste" onClick={() => onBereich('einkauf')}
            text={!h.planung ? 'Noch nicht eingerichtet' : einkaufZeile(offen.length, liste.kosten, nachzukaufen)} achtung={nachzukaufen.length > 0} />
          <UeberblickZeile icon="topf" ton="ton-gelb" titel="Produktion" untertitel="Vorkochen auf Vorrat" onClick={() => onBereich('produktion')}
            text={!h.planung ? 'Noch nicht eingerichtet' : produktion.text} achtung={produktion.achtung} />
          <UeberblickZeile icon="flamme" ton="ton-rot" titel="Heute gegessen" onClick={() => setTagOffen(true)}
            text={!h.protokoll ? 'Noch nicht eingerichtet' : heuteText(tag)} />
          {h.planung && (h.protokoll || bilanz.ausgegeben.anzahl > 0) && (
            <UeberblickZeile icon="preis" ton="ton-grau" titel={`Ausgaben im ${bilanz.monat}`} onClick={() => setGeldOffen(true)}
              text={bilanz.leer ? 'Noch nichts erfasst' : `${euroKompakt(bilanz.gesamt_cent)} bezahlt${bilanz.ausgegeben.ohne_preis ? ` · ${bilanz.ausgegeben.ohne_preis} ohne Preis` : ''}`} />
          )}
        </ul>
      </section>
    ),
  };

  return (
    <div className="start">
      {startAbschnitte({ auftauen: auftauFaellig > 0 && auftauen !== null, willkommen }).map((a) => teile[a]())}
      {geldOffen && <GeldBlatt b={bilanz} h={h} heute={heute} onMeldung={onMeldung} onGeaendert={onGeaendert} onSchliessen={() => setGeldOffen(false)} />}
      {tagOffen && (
        <TagBlatt t={tag} h={h} heute={heute} ziel={ziel}
          onZiel={(z) => {
            setZiel(z);
            try {
              if (z === null) localStorage.removeItem(ZIEL_SPEICHER);
              else localStorage.setItem(ZIEL_SPEICHER, String(z));
            } catch {
              // nur Komfort
            }
          }}
          onSchliessen={() => setTagOffen(false)} />
      )}
    </div>
  );
}

/** „Alles da“ oder „Fehlt: Basilikum“ – Verfügbarkeit in klaren Worten */
export function verfuegbarText(g: Gericht): { text: string; ok: boolean } {
  if (g.fehlt.length === 0) return { text: 'Alles da', ok: true };
  if (g.fehlt.length === 1) return { text: `Fehlt: ${g.fehlt[0].name}`, ok: false };
  return { text: `${g.fehlt.length} Zutaten fehlen`, ok: false };
}

/** Der große Vorschlag: Bild, Name, ein Satz, Zeit · Portionen · Vorrat – und „Jetzt kochen“. */
function HeldKarte({ v, onKochen }: { v: StartVorschlag; onKochen: () => void }) {
  const { g } = v;
  const da = verfuegbarText(g);
  const geplantHeute = v.planId !== null;
  return (
    <article className="held-karte">
      <div className="held-bild"><GerichtBild g={g} groesse="held" suchen /></div>
      <div className="held-text">
        <p className="held-ueber">{geplantHeute ? 'Für heute geplant' : g.fehlt.length === 0 ? 'Aus deinem Vorrat' : 'Fast alles im Vorrat'}</p>
        <h2 className="held-name">{g.name}</h2>
        {g.beschreibung && <p className="held-satz">{g.beschreibung}</p>}
        <p className="fakten">
          <span><Icon name="uhr" groesse={17} /> {g.zeit_min} Min</span>
          <span><Icon name="personen" groesse={17} /> {g.portionen} {g.portionen === 1 ? 'Portion' : 'Portionen'}</span>
          <span className={da.ok ? 'status-ok' : 'status-achtung'}><Icon name={da.ok ? 'haken' : 'wagen'} groesse={17} /> {da.text}</span>
        </p>
        {g.rettet.length > 0 && (
          <p className="held-grund"><Icon name="blatt" groesse={16} /> Verbraucht zuerst: {g.rettet.slice(0, 2).join(', ')}</p>
        )}
        <button type="button" className="knopf haupt held-kochen" onClick={onKochen}>
          <Icon name="pfanne" /> Jetzt kochen
        </button>
        
      </div>
    </article>
  );
}

/** Weitere Idee als ruhige Zeile – ein Tipp öffnet das Rezept. */
function IdeeZeile({ v, onKochen }: { v: StartVorschlag; onKochen: () => void }) {
  const da = verfuegbarText(v.g);
  return (
    <button type="button" className="idee-zeile" onClick={onKochen} aria-label={`${v.g.name} – Rezept öffnen`}>
      <span className="idee-bild"><GerichtBild g={v.g} groesse="klein" /></span>
      <span className="idee-text">
        <strong>{v.g.name}</strong>
        <small>{v.g.zeit_min} Min · <span className={da.ok ? 'status-ok' : 'status-achtung'}>{da.text}</span></small>
      </span>
      <span className="idee-aktion">Kochen <Icon name="pfeil" groesse={15} /></span>
    </button>
  );
}

/** Kein ganzes Gericht aus dem freien Vorrat: ehrlich sagen – und zwei sinnvolle nächste Schritte anbieten. */
function KeinVorschlag({ laedt, onBereich, onEinbuchen }: { laedt: boolean; onBereich: (b: Bereich) => void; onEinbuchen: () => void }) {
  if (laedt) {
    return (
      <div className="held-karte laedt" aria-live="polite">
        <div className="held-bild"><span className="teller teller-held teller-neutral" aria-hidden="true"><span className="teller-platte" /></span></div>
        <div className="held-text"><p className="held-ueber">Einen Moment</p><p className="held-name serif">Kombi schaut in deinen Vorrat …</p></div>
      </div>
    );
  }
  return (
    <div className="leer-karte">
      <span className="leer-icon" aria-hidden="true"><Icon name="essen" groesse={28} /></span>
      <h2>Gerade reicht der Vorrat für kein ganzes Gericht</h2>
      <p>Kombi schlägt nur vor, was du wirklich zu Hause hast. So geht es weiter:</p>
      <button type="button" className="knopf haupt" onClick={() => onBereich('essen')}>
        <Icon name="birne" /> Ideen mit kleinem Einkauf
      </button>
      <button type="button" className="knopf breit zweit" onClick={onEinbuchen}>
        <Icon name="plus" /> Eingekauftes in den Vorrat
      </button>
    </div>
  );
}

/** Ganz neu: noch nichts im Vorrat – erklären, was Kombi tut, und den ersten Schritt anbieten. */
function ErsterStart({ onEinbuchen, onBereich, onHilfe }: { onEinbuchen: () => void; onBereich: (b: Bereich) => void; onHilfe: () => void }) {
  return (
    <div className="start">
      <div className="leer-karte">
        <span className="leer-icon" aria-hidden="true"><Icon name="vorrat" groesse={28} /></span>
        <h2>Willkommen bei Kombi</h2>
        <p>Kombi merkt sich, was du zu Hause hast, und schlägt vor, was du daraus kochen kannst. Dafür braucht es zuerst deinen Vorrat.</p>
        <SoGehts />
        <button type="button" className="knopf haupt" onClick={onEinbuchen}><Icon name="plus" /> Vorrat eintragen</button>
        <button type="button" className="link breit" onClick={() => onBereich('vorrat')}>Zum Vorrat</button>
        <button type="button" className="link breit" onClick={onHilfe}>Begriffe erklärt</button>
      </div>
    </div>
  );
}

/** Kurze Erklärung für neue Nutzer auf diesem Gerät – einmal „Verstanden“, dann nicht mehr. */
function Willkommen({ onVerstanden, onHilfe }: { onVerstanden: () => void; onHilfe: () => void }) {
  return (
    <section className="willkommen" aria-label="So funktioniert Kombi">
      <h2>Neu hier? So funktioniert Kombi</h2>
      <SoGehts />
      <div className="knopf-reihe">
        <button type="button" className="knopf zweit" onClick={onHilfe}>Mehr erklären</button>
        <button type="button" className="knopf weich" onClick={onVerstanden}>Verstanden</button>
      </div>
    </section>
  );
}

function UeberblickZeile({ icon, ton, titel, untertitel, text, achtung = false, onClick }: {
  icon: IconName; ton: string; titel: string; untertitel?: string; text: string; achtung?: boolean; onClick: () => void;
}) {
  return (
    <li>
      <button type="button" className="zeile" onClick={onClick}>
        <span className={`icon-kachel ${ton}`}><Icon name={icon} groesse={18} /></span>
        <span className="zeile-haupt">
          <span className="zeile-titel">{titel}{untertitel && <span className="zeile-zusatz"> · {untertitel}</span>}</span>
          <span className={`zeile-meta${achtung ? ' status-kritisch' : ''}`}>{text}</span>
        </span>
        <Icon name="pfeil" groesse={16} className="zeile-pfeil" />
      </button>
    </li>
  );
}

/** „2 Sachen zu kaufen · ca. 4,50 € · Reis aufgebraucht“ */
function einkaufZeile(offen: number, kosten: Einkaufsliste['kosten'], knapp: { sorte: { name: string; anzahl: number } }[]): string {
  const teile = [
    offen ? `${offen} ${offen === 1 ? 'Sache' : 'Sachen'} zu kaufen` : 'Nichts offen',
    offen && kosten.bekannt_cent ? einkaufKosten(kosten).split(' · ')[0] : null,
    knapp.length ? `${knapp[0].sorte.name} ${knapp[0].sorte.anzahl <= 0 ? 'aufgebraucht' : 'wird knapp'}${knapp.length > 1 ? ` (+${knapp.length - 1})` : ''}` : null,
  ];
  return teile.filter(Boolean).join(' · ');
}

/** „1 Mahlzeit · 420 kcal · 0,64 €“ – unbekannt bleibt unbekannt */
function heuteText(t: Tagesuebersicht): string {
  if (t.mahlzeiten === 0 && t.kosten_status === 'leer') return 'Noch nichts gekocht';
  const teile = [
    t.mahlzeiten ? `${t.mahlzeiten} ${t.mahlzeiten === 1 ? 'Mahlzeit' : 'Mahlzeiten'}` : null,
    t.mahlzeiten ? kcalText(t) : null,
    kostenText(t),
  ].filter(Boolean);
  return teile.join(' · ');
}

/** „1.840 kcal“ · „ab 1.200 kcal“ · „kcal unbekannt“ – nie geschätzt */
function kcalText(t: Tagesuebersicht): string {
  if (t.kcal_status === 'leer') return '0 kcal';
  if (t.kcal === null) return 'kcal unbekannt';
  return `${t.kcal_status === 'teilweise' ? 'ab ' : ''}${kcalZahl(t.kcal)} kcal`;
}

function kostenText(t: Tagesuebersicht): string {
  if (t.kosten_status === 'leer') return '0,00 €';
  if (t.kosten_cent === null) return 'Preis unbekannt';
  return `${t.kosten_status === 'teilweise' ? 'ab ' : ''}${euro(t.kosten_cent)}`;
}

/** Heute im Detail: was gegessen wurde, woher die Zahlen kommen – und ein optionales Tagesziel. */
function TagBlatt({ t, h, heute, ziel, onZiel, onSchliessen }: {
  t: Tagesuebersicht; h: Haushaltsdaten; heute: string; ziel: number | null; onZiel: (z: number | null) => void; onSchliessen: () => void;
}) {
  const [eingabe, setEingabe] = useState(ziel ? String(ziel) : '');
  const [fehler, setFehler] = useState<string | null>(null);
  const mahlzeiten = h.mahlzeiten.filter((m) => !m.rueckgaengig && m.datum === heute);
  const sonstige = h.sonstige.filter((a) => !a.entfernt && a.datum === heute);

  function speichern(e: FormEvent) {
    e.preventDefault();
    const text = eingabe.trim();
    if (!text) {
      onZiel(null);
      setFehler(null);
      return;
    }
    const z = Math.round(Number(text.replace(/\./g, '').replace(',', '.')));
    if (!Number.isFinite(z) || z < 500 || z > 8000) return setFehler('Bitte ein Ziel zwischen 500 und 8.000 kcal eingeben.');
    setFehler(null);
    onZiel(z);
  }

  return (
    <Blatt titel="Heute" untertitel="Nur aus hinterlegten Nährwerten und echten Beträgen – nichts geschätzt." onSchliessen={onSchliessen}>
      {mahlzeiten.length + sonstige.length === 0 ? (
        <p className="leise klein">Heute ist noch nichts gekocht oder eingetragen. Gekocht wird über „Kochen starten“ – dann stehen Kalorien und Kosten hier.</p>
      ) : (
        <ul className="liste">
          {mahlzeiten.map((m, i) => (
            <li key={`m${i}`}>
              <div className="zeile">
                <span className="zeile-haupt">
                  <span className="zeile-titel">{m.titel}</span>
                  <span className="zeile-meta">
                    {m.portionen} {m.portionen === 1 ? 'Portion' : 'Portionen'} · {m.kcal === null ? 'kcal unbekannt' : `${m.kcal_unbekannt ? 'ab ' : ''}${kcalZahl(Math.round(m.kcal / Math.max(1, m.portionen)))} kcal pro Person`}
                  </span>
                </span>
                <span className="zeile-wert"><strong>{m.kosten_cent === null ? 'Preis unbekannt' : `${m.kosten_unbekannt ? 'ab ' : ''}${euro(m.kosten_cent)}`}</strong></span>
              </div>
            </li>
          ))}
          {sonstige.map((a) => (
            <li key={`s${a.id}`}>
              <div className="zeile">
                <span className="zeile-haupt"><span className="zeile-titel">{a.notiz || 'Sonstiges'}</span><span className="zeile-meta">Sonstige Ausgabe</span></span>
                <span className="zeile-wert"><strong>{euro(a.betrag_cent)}</strong></span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="abschnitt-fuss">
        Kalorien je Person = Kalorien der entnommenen Mengen ÷ Portionen. Eine Portion Komponente zählt mit ihren eigenen Werten – ihre Zutaten nicht noch einmal.
        {t.kcal_status === 'teilweise' && ' Für manche Sorten fehlen Nährwerte – deshalb „ab“.'}
      </p>
      <form className="ausgabe-form abstand-oben" onSubmit={speichern}>
        <input type="text" inputMode="numeric" placeholder="Tagesziel, z. B. 2200" value={eingabe} onChange={(e) => setEingabe(e.target.value)} aria-label="Persönliches Tagesziel in kcal" />
        <button type="submit" className="knopf pillen-knopf">Ziel</button>
      </form>
      {fehler && <p className="fehlertext">{fehler}</p>}
      <p className="abschnitt-fuss">Das Tagesziel ist optional und bleibt nur auf diesem Gerät. Leer lassen und „Ziel“ tippen entfernt es.</p>
    </Blatt>
  );
}

/** Geld im Detail: was zählt, was nicht – und sonstige Ausgaben eintragen oder entfernen. */
function GeldBlatt({ b, h, heute, onMeldung, onGeaendert, onSchliessen }: {
  b: Monatsbilanz; h: Haushaltsdaten; heute: string;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void; onGeaendert: () => void; onSchliessen: () => void;
}) {
  const [betrag, setBetrag] = useState('');
  const [notiz, setNotiz] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const diesen = h.sonstige.filter((a) => !a.entfernt && a.datum.slice(0, 7) === heute.slice(0, 7));

  async function hinzufuegen(e: FormEvent) {
    e.preventDefault();
    const cent = euroZuCent(betrag);
    if (cent === null || Number.isNaN(cent) || cent <= 0) return setFehler('Bitte einen Betrag wie 6,20 eingeben.');
    setFehler(null);
    setLaeuft(true);
    try {
      await ausgabeEintragen(cent, notiz || null);
      setBetrag('');
      setNotiz('');
      onMeldung(`${euroText(cent)} unter „Sonstiges“ eingetragen.`);
      onGeaendert();
    } catch (err) {
      setFehler(fehlerText(err));
    } finally {
      setLaeuft(false);
    }
  }

  async function entfernen(id: number, text: string) {
    try {
      await ausgabeEntfernen(id, true);
      onMeldung(`${text} entfernt.`, () => ausgabeEntfernen(id, false));
      onGeaendert();
    } catch (err) {
      onMeldung(fehlerText(err));
    }
  }

  const zeile = (titel: string, meta: string | null, wert: string) => (
    <li><div className="zeile"><span className="zeile-haupt"><span className="zeile-titel">{titel}</span>{meta && <span className="zeile-meta">{meta}</span>}</span><span className="zeile-wert"><strong>{wert}</strong></span></div></li>
  );

  return (
    <Blatt titel={`Geld im ${b.monat}`} untertitel="Nur echte Beträge – Kombi schätzt nichts." onSchliessen={onSchliessen}>
      <h3 className="unterkopf">Ausgegeben</h3>
      <ul className="liste">
        {zeile('Einkäufe', `${b.ausgegeben.anzahl} ${b.ausgegeben.anzahl === 1 ? 'Einkauf' : 'Einkäufe'}${b.ausgegeben.ohne_preis ? ` · ${b.ausgegeben.ohne_preis} ohne Preis` : ''}`, euro(b.ausgegeben.cent))}
        {zeile('Sonstiges', h.ausgaben ? `${b.sonstiges.anzahl} ${b.sonstiges.anzahl === 1 ? 'Eintrag' : 'Einträge'}` : 'Migration „ausgaben“ fehlt noch', h.ausgaben ? euro(b.sonstiges.cent) : '–')}
        {zeile('Zusammen', b.vormonat ? `Vormonat bis zum ${b.vormonat.bis_tag}.: ${euro(b.vormonat.cent)}` : null, euro(b.gesamt_cent))}
      </ul>

      <h3 className="unterkopf">Warenwert – schon in den Einkäufen enthalten</h3>
      <ul className="liste">
        {zeile('Gekocht', `${b.gekocht.anzahl} ${b.gekocht.anzahl === 1 ? 'Mahlzeit' : 'Mahlzeiten'}`, b.gekocht.anzahl ? `${b.gekocht.vollstaendig ? '' : 'ab '}${euro(b.gekocht.cent)}` : '–')}
        {b.gekocht.pro_mahlzeit_cent !== null && zeile('Ø pro Mahlzeit', null, euro(b.gekocht.pro_mahlzeit_cent))}
        {zeile('Produktion', `${b.produktion.anzahl}× hergestellt`, b.produktion.anzahl ? `${b.produktion.vollstaendig ? '' : 'ab '}${euro(b.produktion.cent)}` : '–')}
      </ul>
      <p className="abschnitt-fuss">Gekocht und Produktion zeigen, was die verbrauchten Zutaten wert waren. Das Geld dafür ist schon bei den Einkäufen gezählt – es wird nie doppelt addiert.</p>

      {h.ausgaben && (
        <>
          <h3 className="unterkopf">Sonstiges im {b.monat}</h3>
          {diesen.length > 0 && (
            <ul className="liste">
              {diesen.map((a) => (
                <li key={a.id}>
                  <div className="zeile">
                    <span className="zeile-haupt">
                      <span className="zeile-titel">{a.notiz || 'Sonstiges'}</span>
                      <span className="zeile-meta">{new Date(`${a.datum}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}</span>
                    </span>
                    <span className="zeile-wert"><strong>{euro(a.betrag_cent)}</strong></span>
                    <button type="button" className="icon-knopf klein" aria-label={`${a.notiz || 'Ausgabe'} entfernen`} onClick={() => void entfernen(a.id!, a.notiz || 'Ausgabe')}>
                      <Icon name="muell" groesse={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form className="ausgabe-form abstand-oben" onSubmit={hinzufuegen}>
            <input type="text" inputMode="decimal" placeholder="0,00 €" value={betrag} onChange={(e) => setBetrag(e.target.value)} aria-label="Betrag in Euro" />
            <input type="text" placeholder="Wofür? z. B. Kantine" maxLength={80} value={notiz} onChange={(e) => setNotiz(e.target.value)} aria-label="Wofür" />
            <button type="submit" className="knopf pillen-knopf" disabled={laeuft || !betrag.trim()} aria-label="Ausgabe hinzufügen"><Icon name="plus" groesse={18} /></button>
          </form>
          {fehler && <p className="fehlertext">{fehler}</p>}
          <p className="abschnitt-fuss">Für Ausgaben ohne Bezug zum Vorrat – z. B. Kantine, Bäcker, bestellt. Entfernen lässt sich rückgängig machen.</p>
        </>
      )}
    </Blatt>
  );
}

/** „≈ 12,40 €“ nur aus bekannten Preisen, sonst ehrlich „Preis teilweise bekannt“ */
export function einkaufKosten(k: Einkaufsliste['kosten']): string {
  if (k.status === 'leer' || k.status === 'unbekannt' || k.bekannt_cent === null) return 'Preis unbekannt';
  if (k.status === 'teilweise') return `ab ${euroText(k.bekannt_cent)} · ${k.unbekannt} ohne Preis`;
  return `ca. ${euroText(k.bekannt_cent)}`;
}
