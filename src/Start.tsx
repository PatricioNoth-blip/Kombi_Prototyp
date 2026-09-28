import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Gericht, KomponentenVorschlag, Optionen } from '../supabase/functions/_shared/kombi/typen.ts';
import type { Einkaufsliste, PlanStand } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { restSnapshot } from '../supabase/functions/_shared/kombi/planung.ts';
import { erzeugeKomponenten, erzeugeVorschlaege } from '../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { euroText } from '../supabase/functions/_shared/kombi/kosten.ts';
import { fehlerText, type Sorte } from './api';
import { baueSnapshotAus } from './essenApi';
import { ausgabeEintragen, ausgabeEntfernen, naehrwerteGericht, type Haushaltsdaten } from './haushalt';
import { Bild } from './Bild';
import { bildKaputt, useBild } from './bildApi';
import { Blatt } from './Blatt';
import { Icon } from './Icon';
import { euro, euroKompakt, euroKurz, euroZuCent, kcalKurz } from './format';
import {
  monatsbilanz, sinnvolleProduktion, startAbschnitte, startHinweis, tagesuebersicht,
  type Monatsbilanz, type ProduktionsTipp, type StartAbschnitt, type Tagesuebersicht,
} from './startseite';
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
  onKochen: (g: Gericht, planId: string | null) => void;
  onBereich: (b: Bereich) => void;
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

/**
 * Die Startseite – kompakt, iPhone-first: Heute (kcal, Essenskosten), höchstens ein dezenter Hinweis,
 * „Was essen wir?“ als kleine Karte, der Monat in einer Zeile, Produktion und Einkauf als Kacheln.
 * Ablauf und Reste steuern im Hintergrund die Vorschläge – als Liste stehen sie im Vorrat.
 */
export function Start({ bestand, heute, h, liste, proPlan, auftauen, auftauFaellig, ideen, onKochen, onBereich, onMeldung, onGeaendert }: Props) {
  const [geldOffen, setGeldOffen] = useState(false);
  const [tagOffen, setTagOffen] = useState(false);
  const [ziel, setZiel] = useState<number | null>(ladeZiel);

  const bilanz = monatsbilanz(h, heute);
  const tag = tagesuebersicht(h.mahlzeiten, h.sonstige, heute, ziel);
  const hinweis = startHinweis(bestand, heute);
  const gekochtHeute = h.mahlzeiten.filter((m) => !m.rueckgaengig && m.datum === heute).map((m) => m.titel);

  // Vorschläge: Geplantes für heute zuerst, dann Ideen aus dem freien Vorrat (ohne heute schon Gekochtes)
  const geplant = h.plaene
    .filter((p) => p.art === 'mahlzeit' && p.daten.gericht && p.datum !== null && p.datum <= heute)
    .sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? ''))
    .map((p) => ({ g: p.daten.gericht!, planId: p.id as string | null }));
  const vorschlaege = [
    ...geplant,
    ...(ideen?.gerichte ?? []).filter((g) => !gekochtHeute.includes(g.name)).map((g) => ({ g, planId: null })),
  ].slice(0, 4);

  const vorgemerkt = h.plaene.filter((p) => p.art === 'komponente').map((p) => {
    const stand = proPlan.get(p.id) ?? [];
    return { plan_id: p.id, titel: p.titel, portionen: p.portionen, alles_da: stand.every((x) => x.fehlt === 0) };
  });
  const tipp: ProduktionsTipp | null = sinnvolleProduktion(vorgemerkt, ideen?.komponenten ?? []);
  const offen = liste.zeilen.filter((z) => z.status === 'offen');

  const folge = startAbschnitte({
    hinweis: hinweis !== null,
    auftauen: auftauFaellig > 0 && auftauen !== null,
    // ohne Protokoll (Migration „kosten_naehrwerte“) gibt es Ausgaben nur aus der Einkaufsliste
    monat: h.planung && (h.protokoll || bilanz.ausgegeben.anzahl > 0),
  });

  if (bestand.length === 0) {
    return (
      <div className="leer-zustand">
        <Icon name="haus" groesse={40} />
        <p>Willkommen bei Kombi. Leg unter <strong>Vorrat</strong> die erste Sorte an – dann gibt es hier Vorschläge, Kalorien und Kosten.</p>
        <button type="button" className="knopf" onClick={() => onBereich('vorrat')}>Zum Vorrat</button>
      </div>
    );
  }

  const produktionText = !h.planung ? 'Noch nicht eingerichtet'
    : vorgemerkt.length ? `${vorgemerkt.length} geplant`
      : tipp ? `Sinnvoll: ${tipp.art === 'vorgemerkt' ? tipp.titel : tipp.komponente.name}` : 'Gerade nichts nötig';
  const einkaufText = !h.planung ? 'Noch nicht eingerichtet' : offen.length ? `${offen.length} offen` : 'Alles da';

  const teile: Record<StartAbschnitt, () => ReactNode> = {
    heute: () => <HeuteKarte key="heute" t={tag} protokoll={h.protokoll} onOeffnen={() => setTagOffen(true)} />,
    hinweis: () => (
      <button key="hinweis" type="button" className="start-hinweis" onClick={() => onBereich('vorrat')}>
        <span className="hinweis-punkt" aria-hidden="true" /> {hinweis} <Icon name="pfeil" groesse={15} />
      </button>
    ),
    auftauen: () => <div key="auftauen">{auftauen}</div>,
    essen: () => (
      <section key="essen" className="start-block" aria-label="Was essen wir?">
        <div className="start-kopf">
          <h2>Was essen wir?</h2>
          <button type="button" className="mehr-link" onClick={() => onBereich('essen')}>Andere <Icon name="pfeil" groesse={15} /></button>
        </div>
        {vorschlaege.length > 0 ? (
          <Karussell>
            {vorschlaege.map((v) => (
              <RezeptKompakt key={v.g.id} g={v.g} geplant={v.planId !== null} bestand={bestand} onKochen={() => onKochen(v.g, v.planId)} />
            ))}
          </Karussell>
        ) : (
          <div className="rezept-kompakt leer">
            <p className="leise klein">{ideen === null ? 'Kombi schaut in den Vorrat …' : 'Aus dem freien Vorrat lässt sich gerade kein ganzes Gericht kochen.'}</p>
            {ideen !== null && <button type="button" className="knopf klein" onClick={() => onBereich('essen')}>Ideen mit Einkauf</button>}
          </div>
        )}
      </section>
    ),
    monat: () => <MonatKarte key="monat" b={bilanz} h={h} onOeffnen={() => setGeldOffen(true)} />,
    kacheln: () => (
      <div key="kacheln" className="kachel-paar">
        <button type="button" className="mini-kachel" onClick={() => onBereich('produktion')} aria-label={`Produktion: ${produktionText}`}>
          <span className="mini-icon ton-gelb"><Icon name="topf" groesse={20} /></span>
          <span className="mini-text"><strong>Produktion</strong><small>{produktionText}</small></span>
        </button>
        <button type="button" className="mini-kachel" onClick={() => onBereich('einkauf')} aria-label={`Einkauf: ${einkaufText}`}>
          <span className="mini-icon ton-gruen"><Icon name="wagen" groesse={20} /></span>
          <span className="mini-text"><strong>Einkauf</strong><small>{einkaufText}{offen.length > 0 && liste.kosten.bekannt_cent ? ` · ${einkaufKosten(liste.kosten).split(' · ')[0]}` : ''}</small></span>
        </button>
      </div>
    ),
  };

  return (
    <div className="start">
      {folge.map((a) => teile[a]())}
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

/** „1.840 kcal“ · „ab 1.200 kcal“ · „kcal unbekannt“ – nie geschätzt */
function kcalText(t: Tagesuebersicht): string {
  if (t.kcal_status === 'leer') return '0 kcal';
  if (t.kcal === null) return 'kcal unbekannt';
  return `${t.kcal_status === 'teilweise' ? 'ab ' : ''}${kcalZahl(t.kcal)} kcal`;
}

function kostenText(t: Tagesuebersicht): string {
  if (t.kosten_status === 'leer') return '0,00 €';
  if (t.kosten_cent === null) return 'unbekannt';
  return `${t.kosten_status === 'teilweise' ? 'ab ' : ''}${euro(t.kosten_cent)}`;
}

/** HEUTE · 🍽️ 1.840 kcal · 2 Mahlzeiten · € 4,82 – kompakt, ein Tipp öffnet die Details. */
function HeuteKarte({ t, protokoll, onOeffnen }: { t: Tagesuebersicht; protokoll: boolean; onOeffnen: () => void }) {
  const arten: [keyof Tagesuebersicht['mahlzeit_arten'], string][] = [['fruehstueck', 'Frühstück'], ['mittag', 'Mittag'], ['abend', 'Abendessen']];
  return (
    <button type="button" className="heute-karte" onClick={onOeffnen} aria-label={`Heute: ${kcalText(t)}, ${t.mahlzeiten} Mahlzeiten, Essen ${kostenText(t)} – Details`}>
      <span className="ueber">Heute</span>
      {!protokoll ? (
        <span className="heute-leer">Kalorien und Essenskosten erscheinen nach der Migration „kosten_naehrwerte“.</span>
      ) : (
        <>
          <span className="heute-zahlen">
            <span className="heute-zahl">
              <span className="heute-emoji" aria-hidden="true">🍽️</span>
              <strong>{t.ziel !== null && t.kcal !== null && t.kcal_status === 'berechnet' ? `${kcalZahl(t.kcal)} / ${kcalZahl(t.ziel)} kcal` : kcalText(t)}</strong>
              <small>{t.mahlzeiten === 0 ? 'noch keine Mahlzeit' : `${t.mahlzeiten} ${t.mahlzeiten === 1 ? 'Mahlzeit' : 'Mahlzeiten'} · pro Person`}</small>
            </span>
            <span className="heute-zahl rechts">
              <strong>{kostenText(t)}</strong>
              <small>Essen heute</small>
            </span>
          </span>
          {t.anteil !== null && (
            <span className="ziel-balken" aria-hidden="true"><span style={{ width: `${Math.min(100, t.anteil * 100)}%` }} className={t.anteil > 1 ? 'drueber' : ''} /></span>
          )}
          <span className="mahlzeit-arten" aria-hidden="true">
            {arten.map(([id, name]) => <span key={id} className={t.mahlzeit_arten[id] ? 'an' : ''}>{name}</span>)}
          </span>
        </>
      )}
    </button>
  );
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
                <span className="zeile-wert"><strong>{m.kosten_cent === null ? '–' : `${m.kosten_unbekannt ? 'ab ' : ''}${euro(m.kosten_cent)}`}</strong></span>
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

/** Wischbare Vorschläge mit Punkten darunter */
function Karussell({ children }: { children: ReactNode[] }) {
  const [aktiv, setAktiv] = useState(0);
  return (
    <>
      <div className="karussell" onScroll={(e) => {
        const el = e.currentTarget;
        const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth - 28));
        if (i !== aktiv) setAktiv(i);
      }}>
        {children}
      </div>
      {children.length > 1 && (
        <div className="punkte" aria-hidden="true">{children.map((_, i) => <span key={i} className={i === aktiv ? 'an' : ''} />)}</div>
      )}
    </>
  );
}

/** Kleine Rezeptkarte: Bild, Name, Zeit · Kosten · kcal, verfügbar, KOCHEN. */
function RezeptKompakt({ g, geplant, bestand, onKochen }: { g: Gericht; geplant: boolean; bestand: Sorte[]; onKochen: () => void }) {
  const farbe = g.zutaten.find((z) => z.quelle !== 'grundausstattung' && z.farbe)?.farbe ?? null;
  // Die erste Karte ist sichtbar – ihr Bild darf einmalig gesucht werden; der Cache verhindert Wiederholungen
  const foto = useBild(g.bild, true);
  const n = naehrwerteGericht(g, bestand);
  return (
    <article className="rezept-kompakt">
      <div className="rk-bild"><Bild name={g.name} emoji={g.emoji} farbe={farbe} art="kachel" bild={foto} onKaputt={() => bildKaputt(g.bild?.schluessel)} /></div>
      <div className="rk-text">
        {geplant && <p className="rk-ueber">Heute geplant</p>}
        <h3>{g.name}</h3>
        <p className="rk-meta">
          <span><Icon name="uhr" groesse={14} /> {g.zeit_min} Min</span>
          <span>{euroKurz(g.kosten)}</span>
          <span><Icon name="flamme" groesse={14} className="flamme" /> {kcalKurz(n)}</span>
        </p>
        <div className="rk-unten">
          <span className={`rk-da ${g.fehlt.length === 0 ? 'status-ok' : 'status-achtung'}`}>
            {g.fehlt.length === 0 ? '✓ Alles da' : `Fehlt: ${g.fehlt.map((f) => f.name).join(', ')}`}
          </span>
          <button type="button" className="knopf pillen-knopf rk-kochen" onClick={onKochen}>Kochen</button>
        </div>
      </div>
    </article>
  );
}

/** SEPTEMBER · Einkäufe · Sonstiges · Ø / Mahlzeit – Produktion nur als Warenwert, nie addiert. */
function MonatKarte({ b, h, onOeffnen }: { b: Monatsbilanz; h: Haushaltsdaten; onOeffnen: () => void }) {
  const schnitt = b.gekocht.pro_mahlzeit_cent !== null ? euroKompakt(b.gekocht.pro_mahlzeit_cent) : '–';
  return (
    <button type="button" className="monat-karte" onClick={onOeffnen} aria-label={`${b.monat}: ${euro(b.gesamt_cent)} ausgegeben – Details`}>
      <span className="monat-kopf">
        <span className="ueber">{b.monat}</span>
        {b.vormonat && (
          <span className={`trend-chip ${b.vormonat.aenderung_prozent <= 0 ? 'runter' : 'hoch'}`}>
            {b.vormonat.aenderung_prozent <= 0 ? '↓' : '↑'} {Math.abs(b.vormonat.aenderung_prozent)} %
          </span>
        )}
        <Icon name="pfeil" groesse={15} className="zeile-pfeil" />
      </span>
      <span className="monat-zahlen">
        <span><strong>{euroKompakt(b.ausgegeben.cent)}</strong><small>Einkäufe</small></span>
        <span><strong>{h.ausgaben ? euroKompakt(b.sonstiges.cent) : '–'}</strong><small>Sonstiges</small></span>
        <span><strong>{schnitt}</strong><small>Ø / Mahlzeit</small></span>
      </span>
      {b.produktion.anzahl > 0 && (
        <small className="monat-fuss">Produktion: {b.produktion.vollstaendig ? '' : 'ab '}{euro(b.produktion.cent)} Warenwert – steckt schon in den Einkäufen</small>
      )}
      {b.leer && <small className="monat-fuss">Noch nichts erfasst – beim Einbuchen den bezahlten Betrag angeben.</small>}
    </button>
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
  if (k.status === 'teilweise') return `ab ${euroText(k.bekannt_cent)} · Preis teilweise bekannt`;
  return `ca. ${euroText(k.bekannt_cent)}`;
}
