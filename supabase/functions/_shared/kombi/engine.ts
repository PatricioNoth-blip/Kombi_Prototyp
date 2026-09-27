// Kombi Recommendation Engine
//
//   Snapshot + Session ─▶ Leitplanken ─▶ KI-Anbieter ─▶ Rohantwort
//                                                        │
//   Ergebnis ◀─ Auswahl mit Abwechslung ◀─ Bewertung ◀─ Filter ◀─ Prüfung gegen Snapshot
//
// Aufgabenteilung:
//   Software: Bestand, Mengen, Portionen, Kosten, Preise, Ablauf, Validierung, Rangfolge, harte Regeln
//   KI:       Ideen, Namen, Beschreibungen, Zubereitung, Varianten, Kombinationen
// Die Engine liest nur. Sie hat keinen Zugriff auf die Datenbank und kann den Bestand
// deshalb gar nicht verändern – Buchungen passieren ausschließlich in der App nach Bestätigung.
import type {
  Einkaufsvorschlag, Ergebnis, Gericht, GerichtKurz, KiAnbieter, KiAnfrage, KomponentenErgebnis, KomponentenVorschlag, RohGericht,
} from './typen.ts';
import { aehnlichkeit, DUPLIKAT_SCHWELLE } from './aehnlichkeit.ts';
import { bewerte, kurz, STANDARD_GEWICHTE, type Gewichte } from './bewertung.ts';
import { pruefeEinkauf, waehleMultiUse } from './einkauf.ts';
import { berechneLeitplanken, verletztAusschluss } from './praeferenz.ts';
import { kannMahlzeit } from './snapshot.ts';
import { uuid } from './id.ts';
import { pruefeBaustein, pruefeGericht } from './validierung.ts';
import { verletztVielfalt, vielfaltSperre, wiederholung } from './vielfalt.ts';
import { dringlichkeit } from './bewertung.ts';
import { pruefeKomponente, schonVorhanden } from './komponenten.ts';
import { reservierungVon, restSnapshot } from './planung.ts';

/** Etwas, das heute weg sollte: geöffnet, aufgetaut, bald ablaufend, kleiner Rest, Kühlschrank-Rest. */
export const istDringend = (z: KiAnfrage['snapshot']['zutaten'][number]) =>
  z.quelle !== 'grundausstattung' && (z.geoeffnet || z.aufgetaut || z.bald_verbrauchen || z.rest);

export type EngineOptionen = {
  id?: () => string;
  gewichte?: Gewichte;
};

export async function erzeugeVorschlaege(
  anbieter: KiAnbieter,
  anfrage: KiAnfrage,
  optionen: EngineOptionen = {},
): Promise<Ergebnis> {
  const neueId = optionen.id ?? uuid;
  const gewichte = optionen.gewichte ?? STANDARD_GEWICHTE;
  const leitplanken = berechneLeitplanken(anfrage.feedback, anfrage.modus, anfrage.gesehen);
  const notfall = !kannMahlzeit(anfrage.snapshot);
  const kontext = { snapshot: anfrage.snapshot, favoriten: anfrage.favoriten ?? [] };
  const reste = anfrage.modus.art === 'reste';

  // Resteverwertung ohne Reste: ehrlich sagen statt etwas zu erzwingen.
  if (reste && !anfrage.snapshot.zutaten.some(istDringend)) {
    return {
      anbieter: anbieter.name, gerichte: [], einkauf: null, baustein_idee: null, notfall: false, leitplanken, verworfen: [],
      hinweis: 'Gerade muss nichts dringend weg – nichts ist geöffnet, aufgetaut oder läuft bald ab.',
    };
  }

  const roh = await anbieter.vorschlagen({ ...anfrage, aufgabe: 'gerichte', leitplanken, notfall });

  const verworfen: Ergebnis['verworfen'] = [];
  const kandidaten: Gericht[] = [];
  const bisher: GerichtKurz[] = [...anfrage.gesehen];

  for (const r of Array.isArray(roh.vorschlaege) ? roh.vorschlaege : []) {
    const p = pruefeGericht(r, anfrage.snapshot, anfrage.optionen, neueId());
    if (!p.ok) {
      verworfen.push({ name: String(r?.name ?? '?'), grund: p.grund });
      continue;
    }
    const g = p.wert;
    const k = kurz(g);

    // Keine Wiederholungen – weder aus der Session noch innerhalb dieser Antwort.
    const dopplung = bisher.find((b) => aehnlichkeit(k, b) >= DUPLIKAT_SCHWELLE);
    if (dopplung) {
      verworfen.push({ name: g.name, grund: `zu ähnlich zu „${dopplung.name}“` });
      continue;
    }
    // Nach mehreren Ablehnungen in Folge: bestimmte Richtungen vorerst meiden.
    // (Die Abwechslungs-Sperre greift erst bei der Auswahl – dort gibt es einen Ausweg, falls sonst nichts geht.)
    const verstoss = verletztAusschluss(k, leitplanken);
    if (verstoss) {
      verworfen.push({ name: g.name, grund: verstoss });
      continue;
    }

    // Resteverwertung: nur Gerichte, die wirklich etwas retten.
    if (reste && g.rettet.length === 0) {
      verworfen.push({ name: g.name, grund: 'verwertet keine Reste' });
      continue;
    }

    g.bewertung = bewerte(g, anfrage.optionen, anfrage.gesehen, leitplanken, gewichte, kontext);
    if (reste) g.bewertung += 2 * dringlichkeit(g, anfrage.snapshot);
    if (leitplanken.anker) {
      // „Ähnlich“: erkennbare Gemeinsamkeit, aber ein anderes Gericht – Nähe um 0,5 ist ideal.
      const nahe = aehnlichkeit(k, leitplanken.anker);
      g.bewertung += 2 * (1 - Math.abs(nahe - 0.5) * 2);
    }
    kandidaten.push(g);
    bisher.push(k);
  }

  const gerichte = waehleAbwechslungsreich(kandidaten, anfrage, gewichte, !!leitplanken.anker);

  if (reste) {
    return {
      anbieter: anbieter.name, gerichte, einkauf: null, baustein_idee: null, notfall: false, leitplanken, verworfen,
      hinweis: gerichte.length ? null : 'Mit euren Resten ist gerade kein sinnvolles Gericht möglich – lieber nichts erzwingen.',
    };
  }

  // Einkauf nur, wenn wirklich nötig: kein sinnvolles Gericht oder der Bestand trägt keine Mahlzeit.
  let einkauf: Einkaufsvorschlag | null = null;
  if (notfall || gerichte.length === 0) {
    einkauf = pruefeEinkauf(roh.einkauf, anfrage.snapshot, neueId()) ?? waehleMultiUse(anfrage.snapshot, neueId());
  }

  return {
    anbieter: anbieter.name,
    gerichte,
    einkauf,
    baustein_idee: pruefeBaustein(roh.baustein_idee, anfrage.snapshot, neueId()),
    notfall: notfall || gerichte.length === 0,
    leitplanken,
    verworfen,
    hinweis: null,
  };
}

// ───────── Woche planen ─────────

/**
 * Mehrere Mahlzeiten, die den Vorrat sinnvoll verteilen: Jede gewählte Mahlzeit reserviert ihre
 * Mengen, die nächste wird gegen den RESTLICHEN Vorrat geprüft – keine Portion wird doppelt verplant.
 * Der Snapshot sollte bereits um bestehende Pläne reduziert sein (siehe restSnapshot).
 * Gespeichert wird nichts – die App legt Pläne erst nach Bestätigung an.
 */
export async function erzeugeWoche(anbieter: KiAnbieter, anfrage: KiAnfrage, optionen: EngineOptionen = {}): Promise<Ergebnis> {
  const neueId = optionen.id ?? uuid;
  const gewichte = optionen.gewichte ?? STANDARD_GEWICHTE;
  const ziel = Math.max(1, Math.min(7, anfrage.anzahl));
  const leitplanken = berechneLeitplanken(anfrage.feedback, { art: 'normal' }, anfrage.gesehen);
  const notfall = !kannMahlzeit(anfrage.snapshot);
  const roh = await anbieter.vorschlagen({ ...anfrage, aufgabe: 'woche', anzahl: ziel, leitplanken, notfall });
  const kandidaten: RohGericht[] = Array.isArray(roh.vorschlaege) ? roh.vorschlaege.slice(0, 20) : [];

  const verworfen: Ergebnis['verworfen'] = [];
  const gewaehlt: Gericht[] = [];
  const benutzt = new Set<number>();
  let snap = anfrage.snapshot;

  while (gewaehlt.length < ziel) {
    let beste: { i: number; g: Gericht; wert: number } | null = null;
    const bisher = [...anfrage.gesehen, ...gewaehlt.map(kurz)];
    const sperre = vielfaltSperre(bisher);
    kandidaten.forEach((r, i) => {
      if (benutzt.has(i)) return;
      // gegen den RESTLICHEN Vorrat prüfen
      const p = pruefeGericht(r, snap, anfrage.optionen, neueId());
      if (!p.ok) return;
      const k = kurz(p.wert);
      if (bisher.some((b) => aehnlichkeit(k, b) >= DUPLIKAT_SCHWELLE)) return;
      if (verletztAusschluss(k, leitplanken) || verletztVielfalt(k, sperre)) return;
      const wert = bewerte(p.wert, anfrage.optionen, bisher, leitplanken, gewichte, { snapshot: snap, favoriten: anfrage.favoriten ?? [] })
        - gewichte.abwechslung * wiederholung(k, gewaehlt.map(kurz));
      if (!beste || wert > beste.wert) beste = { i, g: p.wert, wert };
    });
    if (!beste) break;
    const b: { i: number; g: Gericht; wert: number } = beste;
    benutzt.add(b.i);
    b.g.bewertung = Math.round(b.wert * 1000) / 1000;
    gewaehlt.push(b.g);
    snap = restSnapshot(snap, reservierungVon(b.g));
  }
  kandidaten.forEach((r, i) => {
    if (!benutzt.has(i)) verworfen.push({ name: String(r?.name ?? '?'), grund: 'nicht ausgewählt oder passt nicht mehr zum restlichen Vorrat' });
  });

  return {
    anbieter: anbieter.name,
    gerichte: gewaehlt,
    einkauf: null,
    baustein_idee: null,
    notfall,
    leitplanken,
    verworfen,
    hinweis: gewaehlt.length < ziel
      ? `Mit dem aktuellen Vorrat passen ${gewaehlt.length} unterschiedliche Mahlzeiten – für mehr bräuchte es einen Einkauf.`
      : null,
  };
}

// ───────── Komponenten entdecken ─────────

/** Vorschläge für neue vorbereitbare Komponenten. Speichert nichts. */
export async function erzeugeKomponenten(anbieter: KiAnbieter, anfrage: KiAnfrage, optionen: EngineOptionen = {}): Promise<KomponentenErgebnis> {
  const neueId = optionen.id ?? uuid;
  const leitplanken = berechneLeitplanken([], { art: 'normal' }, []);
  const roh = await anbieter.vorschlagen({ ...anfrage, aufgabe: 'komponenten', leitplanken, notfall: false });
  const verworfen: KomponentenErgebnis['verworfen'] = [];
  const komponenten: KomponentenVorschlag[] = [];
  for (const r of Array.isArray(roh.komponenten) ? roh.komponenten.slice(0, 12) : []) {
    const k = pruefeKomponente(r, anfrage.snapshot, neueId());
    if (!k) {
      verworfen.push({ name: String(r?.name ?? '?'), grund: 'unvollständig oder nennt Zutaten, die nicht drin sind' });
      continue;
    }
    if (schonVorhanden(k.name, anfrage.snapshot)) {
      verworfen.push({ name: k.name, grund: 'gibt es schon im Vorrat' });
      continue;
    }
    if (komponenten.some((x) => aehnlichName(x.name, k.name))) {
      verworfen.push({ name: k.name, grund: 'doppelt' });
      continue;
    }
    komponenten.push(k);
  }
  komponenten.sort((a, b) => b.nutzbarkeit.punkte - a.nutzbarkeit.punkte || a.name.localeCompare(b.name));
  return {
    anbieter: anbieter.name,
    komponenten: komponenten.slice(0, Math.max(1, Math.min(6, anfrage.anzahl))),
    verworfen,
    hinweis: komponenten.length ? null : 'Gerade keine passende neue Komponente gefunden.',
  };
}

const aehnlichName = (a: string, b: string) => a.toLowerCase().replace(/[^a-zäöüß]/g, '') === b.toLowerCase().replace(/[^a-zäöüß]/g, '');

/** Eine Anfrage bearbeiten – je nach Aufgabe (für Edge Function und Demo-Modus). */
export async function bearbeite(anbieter: KiAnbieter, anfrage: KiAnfrage, optionen: EngineOptionen = {}):
  Promise<(Ergebnis & { aufgabe: 'gerichte' | 'woche' }) | (KomponentenErgebnis & { aufgabe: 'komponenten' })> {
  if (anfrage.aufgabe === 'komponenten') return { ...(await erzeugeKomponenten(anbieter, anfrage, optionen)), aufgabe: 'komponenten' };
  if (anfrage.aufgabe === 'woche') return { ...(await erzeugeWoche(anbieter, anfrage, optionen)), aufgabe: 'woche' };
  return { ...(await erzeugeVorschlaege(anbieter, anfrage, optionen)), aufgabe: 'gerichte' };
}

/**
 * Nimmt nacheinander das jeweils beste Gericht – mit Abzug, wenn es den schon gewählten ähnelt,
 * und ohne Gerichtstypen/Sattmacher, die zuletzt schon dreimal kamen.
 */
function waehleAbwechslungsreich(kandidaten: Gericht[], anfrage: KiAnfrage, gewichte: Gewichte, aehnlichModus: boolean): Gericht[] {
  const anzahl = Math.max(1, anfrage.anzahl);
  const rest = [...kandidaten].sort((a, b) => b.bewertung - a.bewertung);
  const gewaehlt: Gericht[] = [];
  while (gewaehlt.length < anzahl && rest.length) {
    const schon = gewaehlt.map(kurz);
    const sperre = aehnlichModus ? { gerichtstyp: [], sattmacher: [] } : vielfaltSperre([...anfrage.gesehen, ...schon]);
    let beste = -1;
    let besterWert = -Infinity;
    rest.forEach((g, i) => {
      if (verletztVielfalt(kurz(g), sperre)) return;
      const wert = g.bewertung - (aehnlichModus ? 0 : gewichte.abwechslung * wiederholung(kurz(g), schon));
      if (wert > besterWert) {
        besterWert = wert;
        beste = i;
      }
    });
    // Lieber ein Gericht als gar keins: Sperre notfalls ignorieren.
    if (beste < 0) {
      if (gewaehlt.length > 0) break;
      beste = 0;
    }
    gewaehlt.push(rest.splice(beste, 1)[0]);
  }
  return gewaehlt;
}
