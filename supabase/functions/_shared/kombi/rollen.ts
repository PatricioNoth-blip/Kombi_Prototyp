// Die Funktion eines Bausteins im Kombi-System.
//
// Die Rolle ergibt sich aus der Kombi-Farbe (rot = Basis & Soße, braun = Protein …). Sie sagt,
// WOFÜR ein Baustein in einem Gericht da ist – das braucht die KI, um mit dem Baukasten zu
// arbeiten statt Wörter aus einer Zutatenliste zu einem Rezept zu würfeln.
import type { Farbe, Gerichtstyp, SnapshotZutat } from './typen.ts';
import { normalisiere } from './text.ts';

export type Rolle = { name: string; funktion: string };

export const ROLLEN: Record<Farbe, Rolle> = {
  rot: { name: 'Basis & Soße', funktion: 'gibt Soße und Grundgeschmack' },
  braun: { name: 'Protein', funktion: 'Hauptkomponente, macht satt' },
  gruen: { name: 'Gemüse', funktion: 'Gemüse-Anteil' },
  gelb: { name: 'Sattmacher', funktion: 'Beilage: Pasta, Reis, Brot, Wrap …' },
  weiss: { name: 'Gewürz & Booster', funktion: 'gibt eine Geschmacksrichtung' },
  schwarz: { name: 'Crunch & Frisch', funktion: 'Topping für Biss und Frische' },
  blau: { name: 'Komplettgericht', funktion: 'wird als Ganzes gegessen' },
};

/** Mit welchen Rollen sich eine Rolle typischerweise zu einem Gericht ergänzt. */
export const PARTNER_ROLLEN: Record<Farbe, Farbe[]> = {
  rot: ['braun', 'gelb', 'gruen', 'weiss'],
  braun: ['rot', 'gelb', 'gruen', 'weiss', 'schwarz'],
  gruen: ['rot', 'braun', 'gelb'],
  gelb: ['rot', 'braun', 'gruen'],
  weiss: ['rot', 'braun', 'gruen'],
  schwarz: ['gelb', 'gruen', 'braun'],
  blau: ['gruen', 'gelb', 'schwarz'],
};

/** Typische Gerichtstypen je Rolle – Allgemeinwissen, nur wenn nichts hinterlegt ist. */
export const TYPISCHE_GERICHTE: Record<Farbe, Gerichtstyp[]> = {
  rot: ['pasta', 'pizza', 'wrap', 'suppe', 'auflauf', 'eintopf', 'reisgericht'],
  braun: ['wrap', 'bowl', 'pfanne', 'curry', 'burger', 'salat'],
  gruen: ['pfanne', 'suppe', 'curry', 'auflauf', 'bowl', 'pasta'],
  gelb: ['pasta', 'bowl', 'pfanne', 'reisgericht', 'toast', 'wrap'],
  weiss: [],
  schwarz: ['salat', 'bowl', 'toast', 'snack'],
  blau: [],
};

export const GERICHT_NAME: Record<Gerichtstyp, string> = {
  pasta: 'Pasta', curry: 'Curry', wrap: 'Wrap', pfanne: 'Pfanne', suppe: 'Suppe', eintopf: 'Eintopf',
  bowl: 'Bowl', toast: 'Toast', reisgericht: 'Reisgericht', auflauf: 'Auflauf', salat: 'Salat',
  pizza: 'Pizza', burger: 'Burger', snack: 'Snack', aufwaermen: 'Aufwärmen', sonstiges: 'Sonstiges',
};

export const GERICHT_EMOJI: Record<Gerichtstyp, string> = {
  pasta: '🍝', curry: '🍛', wrap: '🌯', pfanne: '🥘', suppe: '🍲', eintopf: '🍲', bowl: '🥣', toast: '🥪',
  reisgericht: '🍚', auflauf: '🫕', salat: '🥗', pizza: '🍕', burger: '🍔', snack: '🥨', aufwaermen: '🍽️',
  sonstiges: '🍽️',
};

type MitRolle = { farbe: Farbe | null; gerichtstypen?: Gerichtstyp[] | null };

/** Wofür eignet sich ein Baustein? Hinterlegt (vom Nutzer) oder typisch für seine Rolle. */
export function gerichtstypenVon(z: MitRolle): { typen: Gerichtstyp[]; quelle: 'hinterlegt' | 'typisch' | 'keine' } {
  if (z.gerichtstypen?.length) return { typen: z.gerichtstypen, quelle: 'hinterlegt' };
  const typisch = z.farbe ? TYPISCHE_GERICHTE[z.farbe] : [];
  return typisch.length ? { typen: typisch, quelle: 'typisch' } : { typen: [], quelle: 'keine' };
}

const dringlich = (z: SnapshotZutat) => (z.geoeffnet || z.aufgetaut ? 3 : z.bald_verbrauchen ? 2 : z.rest ? 1 : 0);

/**
 * Was im Vorrat passt zu diesem Baustein? Ergänzende Rollen, bevorzugt mit gemeinsamen
 * Gerichtstypen und gleicher Richtung; Dringendes zuerst.
 */
export function partnerVon(
  z: MitRolle & { name: string; richtung?: string | null },
  bestand: SnapshotZutat[],
  max = 6,
): SnapshotZutat[] {
  if (!z.farbe) return [];
  const rollen = PARTNER_ROLLEN[z.farbe];
  const eigene = new Set(gerichtstypenVon(z).typen);
  const n = normalisiere(z.name);
  return bestand
    .filter((b) => b.quelle === 'bestand' && b.farbe && rollen.includes(b.farbe) && normalisiere(b.name) !== n)
    .map((b) => {
      const gemeinsam = gerichtstypenVon(b).typen.filter((t) => eigene.has(t)).length;
      const richtung = z.richtung && b.richtung && z.richtung === b.richtung ? 1 : 0;
      return { b, punkte: gemeinsam + richtung + dringlich(b) * 0.5 };
    })
    .sort((x, y) => y.punkte - x.punkte || x.b.name.localeCompare(y.b.name))
    .slice(0, max)
    .map((x) => x.b);
}

/** Rollen, die im Vorrat als Komponente noch gar nicht vorkommen (Lücken im Baukasten). */
export function fehlendeRollen(bestand: SnapshotZutat[]): Farbe[] {
  const da = new Set(bestand.filter((b) => b.quelle === 'bestand' && b.art === 'komponente').map((b) => b.farbe));
  return (['rot', 'braun', 'gruen', 'gelb'] as Farbe[]).filter((f) => !da.has(f));
}
