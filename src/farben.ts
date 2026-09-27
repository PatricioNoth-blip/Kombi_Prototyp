// Das Kombi-Farbsystem und die Baukasten-Begriffe für die Anzeige.
// Die Farbwerte stehen in style.css (--rot, --braun, …).
import type { IconName } from './Icon';

export const FARBEN = [
  { id: 'rot', name: 'Rot', bedeutung: 'Basis & Soße' },
  { id: 'braun', name: 'Braun', bedeutung: 'Protein' },
  { id: 'gruen', name: 'Grün', bedeutung: 'Gemüse' },
  { id: 'gelb', name: 'Gelb', bedeutung: 'Sattmacher' },
  { id: 'weiss', name: 'Weiß', bedeutung: 'Gewürz & Booster' },
  { id: 'schwarz', name: 'Schwarz', bedeutung: 'Crunch & Frisch' },
  { id: 'blau', name: 'Blau', bedeutung: 'Komplettgericht' },
] as const;

export type Farbe = (typeof FARBEN)[number]['id'];

export const LAGERORTE = [
  { id: 'gefrierfach', name: 'Gefrierfach', icon: 'schneeflocke' },
  { id: 'kuehlschrank', name: 'Kühlschrank', icon: 'kuehlschrank' },
  { id: 'vorrat', name: 'Vorrat', icon: 'glas' },
] as const satisfies readonly { id: string; name: string; icon: IconName }[];

export type LagerortId = (typeof LAGERORTE)[number]['id'];

export const ARTEN_INFO = [
  { id: 'komplettgericht', name: 'Komplettgericht', mehrzahl: 'Komplettgerichte', erklaerung: 'wird als Ganzes gegessen, z. B. Pizza, Lasagne-Portion' },
  { id: 'komponente', name: 'Komponente', mehrzahl: 'Komponenten', erklaerung: 'vorbereiteter Baustein, z. B. Tomatensoße, gekochte Linsen' },
  { id: 'zutat', name: 'Zutat', mehrzahl: 'Zutaten & Vorräte', erklaerung: 'einzelnes Lebensmittel, z. B. Pasta, Reis, Dosentomaten' },
] as const;

export const EINHEITEN_INFO = [
  { id: 'portion', name: 'Portionen', kurz: 'Port.' },
  { id: 'stueck', name: 'Stück', kurz: 'Stück' },
  { id: 'g', name: 'Gramm', kurz: 'g' },
  { id: 'ml', name: 'ml', kurz: 'ml' },
] as const;

/** „einfrieren“ fürs Gefrierfach, sonst „einbuchen“ */
export const buchungsVerb = (lagerort?: LagerortId) =>
  !lagerort || lagerort === 'gefrierfach'
    ? { infinitiv: 'einfrieren', partizip: 'eingefroren' }
    : { infinitiv: 'einbuchen', partizip: 'eingebucht' };

export function farbe(id: Farbe) {
  return FARBEN.find((f) => f.id === id)!;
}

export function lagerort(id: LagerortId | undefined) {
  return LAGERORTE.find((l) => l.id === (id ?? 'gefrierfach'))!;
}
