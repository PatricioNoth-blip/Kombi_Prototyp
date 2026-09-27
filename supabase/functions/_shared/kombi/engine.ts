// Kombi Recommendation Engine
//
//   Snapshot + Session ─▶ Leitplanken ─▶ KI-Anbieter ─▶ Rohantwort
//                                                        │
//        Ergebnis ◀─ Rangfolge ◀─ Duplikat-/Leitplanken-Filter ◀─ Prüfung gegen Snapshot
//
// Die Engine liest nur. Sie hat keinen Zugriff auf die Datenbank und kann den Bestand
// deshalb gar nicht verändern – Buchungen passieren ausschließlich in der App nach Bestätigung.
import type { Einkaufsvorschlag, Ergebnis, Gericht, GerichtKurz, KiAnbieter, KiAnfrage } from './typen.ts';
import { aehnlichkeit, DUPLIKAT_SCHWELLE } from './aehnlichkeit.ts';
import { bewerte, kurz, STANDARD_GEWICHTE, type Gewichte } from './bewertung.ts';
import { pruefeEinkauf, waehleMultiUse } from './einkauf.ts';
import { berechneLeitplanken, verletztAusschluss } from './praeferenz.ts';
import { kannMahlzeit } from './snapshot.ts';
import { pruefeBaustein, pruefeGericht } from './validierung.ts';

export type EngineOptionen = {
  id?: () => string;
  gewichte?: Gewichte;
};

let zaehler = 0;
const standardId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `v${Date.now()}-${++zaehler}`;

export async function erzeugeVorschlaege(
  anbieter: KiAnbieter,
  anfrage: KiAnfrage,
  optionen: EngineOptionen = {},
): Promise<Ergebnis> {
  const neueId = optionen.id ?? standardId;
  const gewichte = optionen.gewichte ?? STANDARD_GEWICHTE;
  const leitplanken = berechneLeitplanken(anfrage.feedback, anfrage.modus);
  const notfall = !kannMahlzeit(anfrage.snapshot);

  const roh = await anbieter.vorschlagen({ ...anfrage, leitplanken, notfall });

  const verworfen: Ergebnis['verworfen'] = [];
  const akzeptiert: Gericht[] = [];
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
    const verstoss = verletztAusschluss(k, leitplanken);
    if (verstoss) {
      verworfen.push({ name: g.name, grund: verstoss });
      continue;
    }

    g.bewertung = bewerte(g, anfrage.optionen, anfrage.gesehen, leitplanken, gewichte);
    if (leitplanken.anker) {
      // „Ähnlich“: erkennbare Gemeinsamkeit, aber ein anderes Gericht – Nähe um 0,5 ist ideal.
      const nahe = aehnlichkeit(k, leitplanken.anker);
      g.bewertung += 2 * (1 - Math.abs(nahe - 0.5) * 2);
    }
    akzeptiert.push(g);
    bisher.push(k);
  }

  akzeptiert.sort((a, b) => b.bewertung - a.bewertung);
  const gerichte = akzeptiert.slice(0, Math.max(1, anfrage.anzahl));

  // Einkauf nur, wenn wirklich nötig: kein sinnvolles Gericht oder der Bestand trägt keine Mahlzeit.
  let einkauf: Einkaufsvorschlag | null = null;
  if (notfall || gerichte.length === 0) {
    einkauf = pruefeEinkauf(roh.einkauf, anfrage.snapshot, neueId()) ?? waehleMultiUse(anfrage.snapshot, neueId());
  }

  return {
    anbieter: anbieter.name,
    gerichte,
    einkauf,
    baustein_idee: pruefeBaustein(roh.baustein_idee, neueId()),
    notfall: notfall || gerichte.length === 0,
    leitplanken,
    verworfen,
  };
}
