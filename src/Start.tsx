import { useEffect, useState, type ReactNode } from 'react';
import type { Gericht, KomponentenVorschlag, Optionen } from '../supabase/functions/_shared/kombi/typen.ts';
import type { Einkaufsliste, PlanStand } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { restSnapshot } from '../supabase/functions/_shared/kombi/planung.ts';
import { erzeugeKomponenten, erzeugeVorschlaege } from '../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { euroText } from '../supabase/functions/_shared/kombi/kosten.ts';
import type { Sorte } from './api';
import { baueSnapshotAus } from './essenApi';
import { naehrwerteGericht, type Haushaltsdaten } from './haushalt';
import { GerichtMeta, Verfuegbarkeit } from './GerichtKarte';
import { WichtigZeile } from './Vorrat';
import { Icon } from './Icon';
import { euro } from './format';
import { heuteWichtig } from './dashboard';
import { dringendHeute, heuteGekocht, monatsbilanz, sinnvolleProduktion, startReihenfolge, type ProduktionsTipp, type StartAbschnitt } from './startseite';
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
  onOeffnen: (s: Sorte) => void;
  onBereich: (b: Bereich) => void;
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

function Abschnitt({ titel, link, children }: { titel: string; link?: { text: string; onClick: () => void }; children: ReactNode }) {
  return (
    <section className="abschnitt" aria-label={titel}>
      <div className="abschnitt-kopf">
        <h2>{titel}</h2>
        {link && <button type="button" className="link" onClick={link.onClick}>{link.text}</button>}
      </div>
      {children}
    </section>
  );
}

/** Die Startseite: was heute wichtig ist, was es zu essen gibt, was der Haushalt kostet. */
export function Start({ bestand, heute, h, liste, proPlan, auftauen, auftauFaellig, ideen, onKochen, onOeffnen, onBereich }: Props) {

  // ───────── Heute wichtig ─────────
  const wichtig = heuteWichtig(bestand, heute);
  const dringend = dringendHeute(bestand, heute, auftauFaellig);

  // ───────── Essen ─────────
  const geplant = h.plaene
    .filter((p) => p.art === 'mahlzeit' && p.daten.gericht && p.datum !== null && p.datum <= heute)
    .sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? ''))[0] ?? null;
  const gekocht = heuteGekocht(h.mahlzeiten, heute);
  // was heute schon gekocht wurde, wird nicht gleich wieder vorgeschlagen
  const idee = ideen?.gerichte.find((g) => !gekocht.titel.includes(g.name)) ?? null;
  const haupt: { g: Gericht; planId: string | null } | null = geplant
    ? { g: geplant.daten.gericht!, planId: geplant.id }
    : idee ? { g: idee, planId: null } : null;

  // ───────── Geld ─────────
  const bilanz = monatsbilanz(h, heute);

  // ───────── Produktion ─────────
  const vorgemerkt = h.plaene.filter((p) => p.art === 'komponente').map((p) => {
    const stand = proPlan.get(p.id) ?? [];
    return { plan_id: p.id, titel: p.titel, portionen: p.portionen, alles_da: stand.every((x) => x.fehlt === 0) };
  });
  const tipp: ProduktionsTipp | null = sinnvolleProduktion(vorgemerkt, ideen?.komponenten ?? []);

  // ───────── Einkauf ─────────
  const offen = liste.zeilen.filter((z) => z.status === 'offen');

  const folge = startReihenfolge({
    dringend,
    wichtig: wichtig.length + auftauFaellig,
    produktion: tipp !== null,
    einkauf: h.planung && offen.length > 0,
    // ohne Protokoll (Migration „kosten_naehrwerte“) gibt es Ausgaben nur aus der Einkaufsliste
    geld: h.planung && (h.protokoll || bilanz.ausgegeben.anzahl > 0),
  });

  const teile: Record<StartAbschnitt, () => ReactNode> = {
    wichtig: () => (
      <div key="wichtig">
        {wichtig.length > 0 && (
          <Abschnitt titel="Heute wichtig" link={wichtig.length > 5 ? { text: 'Alle anzeigen', onClick: () => onBereich('vorrat') } : undefined}>
            <ul className="liste">
              {wichtig.slice(0, 5).map((w) => <WichtigZeile key={w.sorte.id} w={w} onOeffnen={onOeffnen} />)}
            </ul>
          </Abschnitt>
        )}
        {auftauen}
      </div>
    ),
    essen: () => (
      <Abschnitt key="essen" titel="Was möchtest du essen?">
        {haupt ? (
          <Hauptvorschlag g={haupt.g} geplant={haupt.planId !== null} bestand={bestand} onKochen={() => onKochen(haupt.g, haupt.planId)}
            onAndere={() => onBereich('essen')} />
        ) : ideen === null ? (
          <div className="flaeche"><p className="leise">Kombi schaut in den Vorrat …</p></div>
        ) : (
          <div className="flaeche vorschlag">
            <p className="vorschlag-text">Aus dem freien Vorrat lässt sich gerade kein ganzes Gericht kochen.</p>
            <button type="button" className="knopf breit" onClick={() => onBereich('essen')}>Ideen mit Einkauf ansehen</button>
          </div>
        )}
        {gekocht.titel.length > 0 && (
          <p className="abschnitt-fuss">
            Heute gekocht: {gekocht.titel.join(', ')}
            {gekocht.kcal !== null && ` · ${gekocht.kcal.toLocaleString('de-DE')} kcal`}
          </p>
        )}
      </Abschnitt>
    ),
    geld: () => (
      <Abschnitt key="geld" titel={`Geld im ${bilanz.monat}`}>
        <div className="flaeche geld">
          <div className="geld-haupt">
            <small>Für Einkäufe ausgegeben</small>
            <span className="geld-zahl">{euro(bilanz.ausgegeben.cent)}</span>
            {bilanz.ausgegeben.ohne_preis > 0 && (
              <small>ohne {bilanz.ausgegeben.ohne_preis} {bilanz.ausgegeben.ohne_preis === 1 ? 'Einkauf' : 'Einkäufe'} ohne Preisangabe</small>
            )}
          </div>
          {h.protokoll && bilanz.gekocht.anzahl + bilanz.produktion.anzahl > 0 && (
            <div className="geld-zeilen">
              {bilanz.gekocht.anzahl > 0 && (
                <div className="geld-zeile">
                  <span>Gekocht · {bilanz.gekocht.anzahl} {bilanz.gekocht.anzahl === 1 ? 'Mahlzeit' : 'Mahlzeiten'}</span>
                  <strong>{wert(bilanz.gekocht)}</strong>
                </div>
              )}
              {bilanz.gekocht.pro_mahlzeit_cent !== null && (
                <div className="geld-zeile"><span>Ø pro Mahlzeit</span><strong>{euro(bilanz.gekocht.pro_mahlzeit_cent)}</strong></div>
              )}
              {bilanz.produktion.anzahl > 0 && (
                <div className="geld-zeile">
                  <span>Produktion · {bilanz.produktion.anzahl}×</span>
                  <strong>{wert(bilanz.produktion)}</strong>
                </div>
              )}
            </div>
          )}
        </div>
        <p className="abschnitt-fuss">
          {bilanz.ausgegeben.anzahl === 0
            ? 'Noch keine Einkäufe mit Preis in diesem Monat. Beim Einbuchen den bezahlten Betrag angeben – dann steht er hier.'
            : 'Nur Bezahltes zählt als Ausgabe. Gekocht und Produktion zeigen den Wert der verbrauchten Zutaten.'}
        </p>
      </Abschnitt>
    ),
    produktion: () => tipp && (
      <Abschnitt key="produktion" titel="Produktion">
        <ul className="liste mit-icon">
          <li>
            <button type="button" className="zeile" onClick={() => onBereich('produktion')}>
              <span className="icon-kachel"><Icon name="topf" groesse={18} /></span>
              <span className="zeile-haupt">
                <span className="zeile-titel">{tipp.art === 'vorgemerkt' ? tipp.titel : tipp.komponente.name}</span>
                <span className="zeile-meta">
                  {tipp.art === 'vorgemerkt'
                    ? `Vorgemerkt · alles da · ${tipp.portionen} Portionen`
                    : `${tipp.grund} · ${tipp.komponente.portionen} Portionen · ${tipp.komponente.zeit_min} Min`}
                </span>
              </span>
              <Icon name="pfeil" groesse={16} className="zeile-pfeil" />
            </button>
          </li>
        </ul>
      </Abschnitt>
    ),
    einkauf: () => (
      <Abschnitt key="einkauf" titel="Einkauf">
        <ul className="liste mit-icon">
          <li>
            <button type="button" className="zeile" onClick={() => onBereich('einkauf')}>
              <span className="icon-kachel"><Icon name="wagen" groesse={18} /></span>
              <span className="zeile-haupt">
                <span className="zeile-titel">{offen.length} {offen.length === 1 ? 'Ding fehlt' : 'Dinge fehlen'}</span>
                <span className="zeile-meta">{offen.slice(0, 3).map((z) => z.name).join(', ')}{offen.length > 3 ? ' …' : ''} · {einkaufKosten(liste.kosten)}</span>
              </span>
              <Icon name="pfeil" groesse={16} className="zeile-pfeil" />
            </button>
          </li>
        </ul>
      </Abschnitt>
    ),
  };

  if (bestand.length === 0) {
    return (
      <div className="leer-zustand">
        <Icon name="haus" groesse={40} />
        <p>Willkommen bei Kombi. Leg unter <strong>Vorrat</strong> die erste Sorte an – dann gibt es hier Vorschläge, Hinweise und Kosten.</p>
        <button type="button" className="knopf" onClick={() => onBereich('vorrat')}>Zum Vorrat</button>
      </div>
    );
  }

  return <>{folge.map((a) => teile[a]())}</>;
}

/** Warenwert: genau, „ab …“ wenn Preise fehlen – oder ehrlich „unbekannt“ */
const wert = (x: { cent: number; vollstaendig: boolean }) =>
  x.vollstaendig ? euro(x.cent) : x.cent > 0 ? `ab ${euro(x.cent)}` : 'unbekannt';

/** „≈ 12,40 €“ nur aus bekannten Preisen, sonst ehrlich „Preis teilweise bekannt“ */
export function einkaufKosten(k: Einkaufsliste['kosten']): string {
  if (k.status === 'leer' || k.status === 'unbekannt' || k.bekannt_cent === null) return 'Preis unbekannt';
  if (k.status === 'teilweise') return 'Preis teilweise bekannt';
  return `≈ ${euroText(k.bekannt_cent)}`;
}

function Hauptvorschlag({ g, geplant, bestand, onKochen, onAndere }: {
  g: Gericht; geplant: boolean; bestand: Sorte[]; onKochen: () => void; onAndere: () => void;
}) {
  const n = naehrwerteGericht(g, bestand);
  const farbe = g.zutaten.find((z) => z.quelle !== 'grundausstattung' && z.farbe)?.farbe ?? 'neutral';
  const komponenten = g.zutaten.filter((z) => z.art === 'komponente' || z.art === 'komplettgericht');
  return (
    <div className={`flaeche vorschlag f-${farbe}`}>
      <div className="vorschlag-kopf">
        <span className="gericht-bild" aria-hidden="true">{g.emoji}</span>
        <div className="vorschlag-titel">
          {geplant && <span className="zeile-meta">Heute geplant</span>}
          <h3>{g.name}</h3>
          <GerichtMeta g={g} n={n} />
        </div>
      </div>
      {g.beschreibung && <p className="vorschlag-text">{g.beschreibung}</p>}
      {komponenten.length > 0 && (
        <p className="gericht-zutaten"><span className="leise">Aus deinen Komponenten: </span><strong>{komponenten.map((z) => z.name).join(', ')}</strong></p>
      )}
      <Verfuegbarkeit g={g} />
      <button type="button" className="knopf haupt" onClick={onKochen}>
        <Icon name="pfanne" /> Kochen
      </button>
      <button type="button" className="link breit" onClick={onAndere}>Andere Vorschläge</button>
    </div>
  );
}
