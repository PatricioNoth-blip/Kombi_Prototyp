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
import type { Einkaufsvorschlag, Ergebnis, Gericht, GerichtKurz, KiAnbieter, KiAnfrage } from './typen.ts';
import { aehnlichkeit, DUPLIKAT_SCHWELLE } from './aehnlichkeit.ts';
import { bewerte, kurz, STANDARD_GEWICHTE, type Gewichte } from './bewertung.ts';
import { pruefeEinkauf, waehleMultiUse } from './einkauf.ts';
import { berechneLeitplanken, verletztAusschluss } from './praeferenz.ts';
import { kannMahlzeit } from './snapshot.ts';
import { uuid } from './id.ts';
import { pruefeBaustein, pruefeGericht } from './validierung.ts';
import { verletztVielfalt, vielfaltSperre, wiederholung } from './vielfalt.ts';

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

  const roh = await anbieter.vorschlagen({ ...anfrage, leitplanken, notfall });

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

    g.bewertung = bewerte(g, anfrage.optionen, anfrage.gesehen, leitplanken, gewichte, kontext);
    if (leitplanken.anker) {
      // „Ähnlich“: erkennbare Gemeinsamkeit, aber ein anderes Gericht – Nähe um 0,5 ist ideal.
      const nahe = aehnlichkeit(k, leitplanken.anker);
      g.bewertung += 2 * (1 - Math.abs(nahe - 0.5) * 2);
    }
    kandidaten.push(g);
    bisher.push(k);
  }

  const gerichte = waehleAbwechslungsreich(kandidaten, anfrage, gewichte, !!leitplanken.anker);

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
  };
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
