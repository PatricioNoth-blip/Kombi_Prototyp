// Abwechslung innerhalb einer Session.
//
// Nicht nur „kein Duplikat“, sondern über mehrere Dimensionen: Gerichtstyp, Hauptzutat/Protein,
// Sattmacher, Geschmacksrichtung, Zubereitung, Temperatur, Textur. Die letzten Vorschläge zählen
// am stärksten.
// Harte Regel: Kamen unter den letzten 4 Vorschlägen schon 3 mit demselben Gerichtstyp oder
// Sattmacher (z. B. drei Wraps), wird dieser Wert vorerst gesperrt – außer der Nutzer hat
// ausdrücklich „Ähnliches“ verlangt.
import type { Eigenschaften, GerichtKurz } from './typen.ts';
import { normalisiere } from './text.ts';

export const FENSTER = 4;
const SPERRE_AB = 3;

type Dim = keyof Pick<
  Eigenschaften,
  'gerichtstyp' | 'hauptzutat' | 'sattmacher' | 'gewuerzrichtung' | 'zubereitung' | 'temperatur' | 'konsistenz'
>;

const GEWICHT: Record<Dim, number> = {
  gerichtstyp: 0.3,
  hauptzutat: 0.2,
  sattmacher: 0.15,
  gewuerzrichtung: 0.15,
  zubereitung: 0.08,
  temperatur: 0.04,
  konsistenz: 0.08,
};

/** Werte, die nichts über Abwechslung aussagen */
const NEUTRAL = new Set(['sonstiges', 'neutral', 'keiner', 'unbekannt']);

function wert(g: GerichtKurz, d: Dim): string {
  const w = String(g.eigenschaften[d] ?? '');
  return d === 'hauptzutat' ? normalisiere(w) : w;
}

/**
 * Wie sehr wiederholt ein Gericht die letzten Vorschläge? 0 = ganz anders, 1 = in allem gleich.
 * `zuletzt` in zeitlicher Reihenfolge (ältestes zuerst).
 */
export function wiederholung(g: GerichtKurz, zuletzt: GerichtKurz[]): number {
  const fenster = zuletzt.slice(-FENSTER).reverse(); // neuestes zuerst
  if (fenster.length === 0) return 0;
  let summe = 0;
  let norm = 0;
  fenster.forEach((r, i) => {
    const gewicht = 1 - i * 0.2; // 1, 0.8, 0.6, 0.4
    norm += gewicht;
    for (const d of Object.keys(GEWICHT) as Dim[]) {
      const w = wert(g, d);
      if (w && !NEUTRAL.has(w) && w === wert(r, d)) summe += gewicht * GEWICHT[d];
    }
  });
  return Math.round((summe / norm) * 1000) / 1000;
}

export type VielfaltSperre = { gerichtstyp: string[]; sattmacher: string[] };

/** Welche Werte kamen zuletzt zu oft? (≥ 3 der letzten 4) */
export function vielfaltSperre(zuletzt: GerichtKurz[], anker: GerichtKurz | null = null): VielfaltSperre {
  const fenster = zuletzt.slice(-FENSTER);
  const zuOft = (d: 'gerichtstyp' | 'sattmacher') => {
    const zaehler = new Map<string, number>();
    for (const g of fenster) {
      const w = wert(g, d);
      if (!w || NEUTRAL.has(w)) continue;
      zaehler.set(w, (zaehler.get(w) ?? 0) + 1);
    }
    return [...zaehler.entries()]
      .filter(([w, n]) => n >= SPERRE_AB && (!anker || wert(anker, d) !== w))
      .map(([w]) => w);
  };
  return { gerichtstyp: zuOft('gerichtstyp'), sattmacher: zuOft('sattmacher') };
}

export function verletztVielfalt(g: GerichtKurz, s: VielfaltSperre): string | null {
  if (s.gerichtstyp.includes(g.eigenschaften.gerichtstyp)) {
    return `Abwechslung: zuletzt schon mehrmals ${g.eigenschaften.gerichtstyp}`;
  }
  if (s.sattmacher.includes(g.eigenschaften.sattmacher)) {
    return `Abwechslung: zuletzt schon mehrmals mit ${g.eigenschaften.sattmacher}`;
  }
  return null;
}
