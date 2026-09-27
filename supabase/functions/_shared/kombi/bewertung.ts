// Rangfolge der Vorschläge. Nicht einfach „das Billigste“, sondern eine Abwägung.
// Die Gewichte sind bewusst an einer Stelle gebündelt und später konfigurierbar.
//
// Dringlichkeit („was sollte weg?“) folgt der Reihenfolge
//   geöffnet > bald ablaufend > kleine Reste > Komplettgerichte > Komponenten > Vorräte
// – aber als EIN Faktor unter mehreren: Ein Gericht mit angebrochener Zutat, für das man drei
// Sachen einkaufen müsste, schlägt kein vollständiges Gericht aus dem Vorrat.
import type { Gericht, GerichtKurz, GerichtZutat, Leitplanken, Optionen, Snapshot } from './typen.ts';
import { aehnlichkeit } from './aehnlichkeit.ts';
import { praeferenzWert } from './praeferenz.ts';
import { wiederholung } from './vielfalt.ts';
import { namensQualitaet } from './wahrheit.ts';

export type Gewichte = {
  vorhanden: number; // vorhandene Lebensmittel statt Einkauf
  dringlichkeit: number; // Geöffnetes, bald Ablaufendes und Reste zuerst
  kosten: number; // niedrige Kosten (nur aus bekannten Preisen)
  einfach: number; // einfache/schnelle Zubereitung
  saettigung: number; // gute Sättigung
  abwechslung: number; // anders als die letzten Vorschläge
  praeferenz: number; // was in dieser Session gut bzw. schlecht ankam, Lieblingsrezepte
  name: number; // natürlicher, kurzer Name statt Zutatenliste
};

export const STANDARD_GEWICHTE: Gewichte = {
  vorhanden: 3,
  dringlichkeit: 2.2,
  kosten: 1.5,
  einfach: 1,
  saettigung: 1,
  abwechslung: 1.4,
  praeferenz: 1.5,
  name: 0.6,
};

/** Wie dringend sollte diese Zutat verbraucht werden? 0 … 1 */
export function dringlichkeitVon(z: GerichtZutat, snapshot?: Snapshot): number {
  if (z.quelle === 'grundausstattung') return 0;
  if (z.quelle === 'kuehlschrank') return 0.7; // spontan genannte Reste
  if (z.geoeffnet) return 1;
  if (z.bald_verbrauchen) return 0.85;
  if (snapshot?.zutaten.find((s) => s.id === z.id)?.rest) return 0.7;
  if (z.art === 'komplettgericht') return 0.45;
  if (z.art === 'komponente') return 0.3;
  return 0.12;
}

/** Wichtigste Zutat zählt voll, weitere nur ein wenig (sonst gewinnt „alles in einen Topf“). */
export function dringlichkeit(g: Gericht, snapshot?: Snapshot): number {
  const werte = g.zutaten.map((z) => dringlichkeitVon(z, snapshot)).sort((a, b) => b - a);
  if (werte.length === 0) return 0;
  const rest = werte.slice(1).reduce((s, w) => s + w, 0);
  return Math.min(1, werte[0] + 0.15 * rest);
}

/** Kostenstufen statt linear: 0,70 € ist nicht automatisch „doppelt so gut“ wie 1,40 €. */
function kostenWert(g: Gericht, guenstig: boolean): number {
  const c = g.kosten.pro_portion_cent;
  // Unbekannter Preis: weder belohnen noch bestrafen.
  if (g.kosten.status === 'unbekannt' || c === null) return 0.5;
  const wert = c <= 100 ? 1 : c <= 150 ? 0.8 : c <= 250 ? 0.4 : 0.1;
  const sicher = g.kosten.status === 'berechnet' ? wert : wert * 0.85;
  return guenstig ? sicher : 0.5 + sicher / 2;
}

export const kurz = (g: Gericht): GerichtKurz => ({
  name: g.name,
  eigenschaften: g.eigenschaften,
  zutaten: g.zutaten.map((z) => z.name),
});

export type Kontext = {
  snapshot?: Snapshot;
  favoriten?: GerichtKurz[];
};

export function bewerte(
  g: Gericht,
  optionen: Optionen,
  gesehen: GerichtKurz[],
  leitplanken: Leitplanken,
  gewichte: Gewichte = STANDARD_GEWICHTE,
  kontext: Kontext = {},
): number {
  const k = kurz(g);
  const echte = g.zutaten.filter((z) => z.quelle !== 'grundausstattung');
  const vorhanden = echte.length / Math.max(1, echte.length + g.fehlt.length);
  const grenze = optionen.max_minuten ?? 25;
  const einfach = g.zeit_min <= grenze ? 1 : g.zeit_min <= grenze * 1.5 ? 0.4 : 0;
  const hatSattmacher =
    g.eigenschaften.sattmacher !== 'keiner' ||
    g.zutaten.some((z) => z.farbe === 'gelb' || z.art === 'komplettgericht');
  const saettigung = hatSattmacher ? 1 : 0.4;
  const abwechslung = 1 - wiederholung(k, gesehen);

  // „Gerade etwas anderes“: Ähnliches zum Übersprungenen kurz zurückstellen (ohne zu lernen).
  const kurzfristig = leitplanken.kurzfristig_meiden.reduce((m, s) => Math.max(m, aehnlichkeit(k, s)), 0);
  // Lieblingsrezepte: leichtes Plus für Verwandtes (Duplikate filtert die Engine ohnehin).
  const favorit = (kontext.favoriten ?? []).reduce((m, f) => Math.max(m, aehnlichkeit(k, f)), 0);

  const bestandsnamen = kontext.snapshot?.zutaten.map((z) => z.name) ?? g.zutaten.map((z) => z.name);

  const summe =
    gewichte.vorhanden * vorhanden +
    gewichte.dringlichkeit * dringlichkeit(g, kontext.snapshot) +
    gewichte.kosten * kostenWert(g, optionen.guenstig) +
    gewichte.einfach * einfach +
    gewichte.saettigung * saettigung +
    gewichte.abwechslung * abwechslung +
    gewichte.praeferenz * (praeferenzWert(k, leitplanken) + (favorit >= 0.4 ? 0.3 * favorit : 0)) -
    (kurzfristig >= 0.5 ? 1.5 * kurzfristig : 0) +
    gewichte.name * namensQualitaet(g.name, bestandsnamen);
  return Math.round(summe * 1000) / 1000;
}
