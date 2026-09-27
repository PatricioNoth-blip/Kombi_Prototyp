// Wie ähnlich sind sich zwei Gerichte? Grundlage für „Ähnlich“, Duplikatschutz und Abwechslung.
import type { GerichtKurz } from './typen.ts';
import { normalisiere } from './text.ts';

const GEWICHTE = {
  gerichtstyp: 0.3,
  hauptzutat: 0.25,
  gewuerzrichtung: 0.15,
  sattmacher: 0.1,
  geschmack: 0.05,
  zubereitung: 0.05,
  zutaten: 0.1,
} as const;

/** Ab diesem Wert gilt ein Gericht als (Beinahe-)Duplikat. */
export const DUPLIKAT_SCHWELLE = 0.85;

function jaccard(a: string[], b: string[]): number {
  const x = new Set(a.map(normalisiere));
  const y = new Set(b.map(normalisiere));
  if (x.size === 0 && y.size === 0) return 0;
  let gemeinsam = 0;
  for (const e of x) if (y.has(e)) gemeinsam++;
  return gemeinsam / (x.size + y.size - gemeinsam);
}

/** 0 = nichts gemeinsam, 1 = dasselbe Gericht. */
export function aehnlichkeit(a: GerichtKurz, b: GerichtKurz): number {
  if (normalisiere(a.name) === normalisiere(b.name)) return 1;
  const ea = a.eigenschaften;
  const eb = b.eigenschaften;
  let s = 0;
  if (ea.gerichtstyp === eb.gerichtstyp) s += GEWICHTE.gerichtstyp;
  if (normalisiere(ea.hauptzutat) === normalisiere(eb.hauptzutat)) s += GEWICHTE.hauptzutat;
  if (ea.gewuerzrichtung === eb.gewuerzrichtung) s += GEWICHTE.gewuerzrichtung;
  if (ea.sattmacher === eb.sattmacher) s += GEWICHTE.sattmacher;
  if (ea.geschmack === eb.geschmack) s += GEWICHTE.geschmack;
  if (ea.zubereitung === eb.zubereitung) s += GEWICHTE.zubereitung;
  s += GEWICHTE.zutaten * jaccard(a.zutaten, b.zutaten);
  return Math.round(s * 1000) / 1000;
}

export function istDuplikat(a: GerichtKurz, andere: GerichtKurz[]): boolean {
  return andere.some((b) => aehnlichkeit(a, b) >= DUPLIKAT_SCHWELLE);
}

export function maxAehnlichkeit(a: GerichtKurz, andere: GerichtKurz[]): number {
  return andere.reduce((m, b) => Math.max(m, aehnlichkeit(a, b)), 0);
}
