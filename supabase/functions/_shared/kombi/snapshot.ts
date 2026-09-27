// Baut den kontrollierten Daten-Snapshot, den die KI zu sehen bekommt.
// Nur was hier steht, gilt als vorhanden.
import type { Farbe, Lagerort, Snapshot, SnapshotZutat } from './typen.ts';
import { normalisiere } from './text.ts';

/** Eine Zeile der View `bestand` (wie sie die App aus Supabase lädt). */
export type BestandZeile = {
  id: number;
  name: string;
  farbe: Farbe;
  anzahl: number;
  bald_ablaufen: boolean;
  groesse_g: number;
  kosten_cent: number | null;
  lagerort?: Lagerort | null;
};

/** Gilt immer als vorhanden und wird in der App sichtbar angezeigt. */
export const GRUNDAUSSTATTUNG = ['Wasser', 'Salz', 'Pfeffer', 'Öl'] as const;

const MAX_KUEHLSCHRANK = 20;

/**
 * Zerlegt die freie Kühlschrank-Eingabe in einzelne Einträge.
 * „Ich habe noch eine halbe Paprika, etwas Frischkäse und Mais.“
 *   → ['eine halbe Paprika', 'etwas Frischkäse', 'Mais']
 */
export function kuehlschrankEintraege(text: string): string[] {
  const teile = text
    .replace(/^\s*(ich\s+)?(hab|habe|haben)\s+(noch\s+)?/i, '')
    .split(/[,;\n]+|\s+und\s+|\s+sowie\s+|\s+plus\s+/i)
    .map((t) => t.replace(/^\s*(noch\s+)/i, '').replace(/[.!?]+\s*$/, '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 1)
    .map((t) => (t.length > 60 ? t.slice(0, 60) : t));
  const gesehen = new Set<string>();
  return teile
    .filter((t) => {
      const n = normalisiere(t);
      if (gesehen.has(n)) return false;
      gesehen.add(n);
      return true;
    })
    .slice(0, MAX_KUEHLSCHRANK);
}

export function baueSnapshot(bestand: BestandZeile[], kuehlschrankText: string, datum: string): Snapshot {
  const zutaten: SnapshotZutat[] = [];

  for (const z of bestand) {
    if (z.anzahl <= 0) continue;
    zutaten.push({
      id: `b${z.id}`,
      quelle: 'bestand',
      name: z.name,
      farbe: z.farbe,
      lagerort: z.lagerort ?? 'gefrierfach',
      anzahl: z.anzahl,
      groesse_g: z.groesse_g,
      kosten_cent: z.kosten_cent,
      bald_verbrauchen: z.bald_ablaufen,
      block_typ_id: z.id,
    });
  }

  kuehlschrankEintraege(kuehlschrankText).forEach((name, i) => {
    zutaten.push({
      id: `k${i + 1}`,
      quelle: 'kuehlschrank',
      name,
      farbe: null,
      lagerort: 'kuehlschrank',
      anzahl: null,
      groesse_g: null,
      kosten_cent: null,
      // Spontan genannte Reste sind meist angebrochen – bevorzugt verbrauchen.
      bald_verbrauchen: true,
      block_typ_id: null,
    });
  });

  for (const name of GRUNDAUSSTATTUNG) {
    zutaten.push({
      id: `g-${normalisiere(name)}`,
      quelle: 'grundausstattung',
      name,
      farbe: null,
      lagerort: null,
      anzahl: null,
      groesse_g: null,
      kosten_cent: null,
      bald_verbrauchen: false,
      block_typ_id: null,
    });
  }

  const preise = bestand
    .filter((z) => z.kosten_cent !== null && z.kosten_cent !== undefined)
    .map((z) => ({ name: z.name, kosten_cent: z.kosten_cent as number }));

  return { datum, zutaten, preise };
}

/** Bekannter Preis für eine Zutat nach Namen (auch von gerade leeren Sorten) – sonst null. */
export function bekannterPreis(snapshot: Snapshot, name: string): number | null {
  const n = normalisiere(name);
  if (!n) return null;
  const treffer =
    snapshot.preise.find((p) => normalisiere(p.name) === n) ??
    snapshot.preise.find((p) => {
      const pn = normalisiere(p.name);
      return pn.length >= 4 && (n.includes(pn) || pn.includes(n));
    });
  return treffer ? treffer.kosten_cent : null;
}

/** Grobe Prüfung: Lässt sich aus dem Vorhandenen überhaupt eine Mahlzeit bauen? */
export function kannMahlzeit(snapshot: Snapshot): boolean {
  const da = (farbe: Farbe) => snapshot.zutaten.some((z) => z.quelle === 'bestand' && z.farbe === farbe);
  const kuehlschrank = snapshot.zutaten.some((z) => z.quelle === 'kuehlschrank');
  if (da('blau')) return true; // Komplettgericht aufwärmen geht immer
  const belag = da('braun') || da('rot') || da('gruen') || kuehlschrank;
  if (da('gelb') && belag) return true;
  if (da('braun') && da('rot')) return true; // z. B. Chili oder Eintopf ohne Beilage
  return false;
}
