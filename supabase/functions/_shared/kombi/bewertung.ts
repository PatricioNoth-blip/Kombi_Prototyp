// Rangfolge der Vorschläge. Nicht einfach „das Billigste“, sondern eine Abwägung.
// Die Gewichte sind bewusst an einer Stelle gebündelt und später konfigurierbar.
import type { Gericht, GerichtKurz, Leitplanken, Optionen } from './typen.ts';
import { maxAehnlichkeit } from './aehnlichkeit.ts';
import { praeferenzWert } from './praeferenz.ts';

export type Gewichte = {
  vorhanden: number; // 1. vorhandene Lebensmittel
  ablauf: number; // 2. bald ablaufende Lebensmittel verbrauchen
  kosten: number; // 3. sehr niedrige Kosten
  einfach: number; // 4. einfache/schnelle Zubereitung
  saettigung: number; // 5. gute Sättigung
  bausteine: number; // 6. vorhandene Kombi-Bausteine sinnvoll nutzen
  abwechslung: number; // 7. Abwechslung zu bereits Gezeigtem
  praeferenz: number; // was in dieser Session gut bzw. schlecht ankam
};

export const STANDARD_GEWICHTE: Gewichte = {
  vorhanden: 3,
  ablauf: 2,
  kosten: 1.5,
  einfach: 1,
  saettigung: 1,
  bausteine: 0.8,
  abwechslung: 0.8,
  praeferenz: 1.5,
};

/** Kostenstufen statt linear: 0,70 € ist nicht automatisch „doppelt so gut“ wie 1,40 €. */
function kostenWert(g: Gericht, guenstig: boolean): number {
  const c = g.kosten.pro_portion_cent;
  const wert = c <= 100 ? 1 : c <= 150 ? 0.8 : c <= 250 ? 0.4 : 0.1;
  const unsicher = g.kosten.vollstaendig ? wert : wert * 0.9;
  return guenstig ? unsicher : 0.5 + unsicher / 2;
}

export const kurz = (g: Gericht): GerichtKurz => ({
  name: g.name,
  eigenschaften: g.eigenschaften,
  zutaten: g.zutaten.map((z) => z.name),
});

export function bewerte(
  g: Gericht,
  optionen: Optionen,
  gesehen: GerichtKurz[],
  leitplanken: Leitplanken,
  gewichte: Gewichte = STANDARD_GEWICHTE,
): number {
  const echte = g.zutaten.filter((z) => z.quelle !== 'grundausstattung');
  const vorhanden = echte.length / Math.max(1, echte.length + g.fehlt.length);
  const ablauf = Math.min(1, g.zutaten.filter((z) => z.bald_verbrauchen).length / 2);
  const grenze = optionen.max_minuten ?? 25;
  const einfach = g.zeit_min <= grenze ? 1 : g.zeit_min <= grenze * 1.5 ? 0.4 : 0;
  const hatSattmacher =
    g.eigenschaften.sattmacher !== 'keiner' || g.zutaten.some((z) => z.farbe === 'gelb' || z.farbe === 'blau');
  const saettigung = hatSattmacher ? 1 : 0.4;
  const bausteine = Math.min(1, g.zutaten.filter((z) => z.quelle === 'bestand').length / 3);
  const abwechslung = 1 - maxAehnlichkeit(kurz(g), gesehen);

  const summe =
    gewichte.vorhanden * vorhanden +
    gewichte.ablauf * ablauf +
    gewichte.kosten * kostenWert(g, optionen.guenstig) +
    gewichte.einfach * einfach +
    gewichte.saettigung * saettigung +
    gewichte.bausteine * bausteine +
    gewichte.abwechslung * abwechslung +
    gewichte.praeferenz * praeferenzWert(kurz(g), leitplanken);
  return Math.round(summe * 1000) / 1000;
}
