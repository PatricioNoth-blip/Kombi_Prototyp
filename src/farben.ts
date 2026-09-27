// Das Kombi-Farbsystem: Jeder Block gehört zu genau einer Farbe.
// Die Farbwerte stehen in style.css (--rot, --braun, …).
export const FARBEN = [
  { id: 'rot', name: 'Rot', bedeutung: 'Basis & Soße' },
  { id: 'braun', name: 'Braun', bedeutung: 'Protein' },
  { id: 'gruen', name: 'Grün', bedeutung: 'Gemüse' },
  { id: 'gelb', name: 'Gelb', bedeutung: 'Sattmacher' },
  { id: 'weiss', name: 'Weiß', bedeutung: 'Gewürzwürfel' },
  { id: 'schwarz', name: 'Schwarz', bedeutung: 'Crunch & Frisch' },
  { id: 'blau', name: 'Blau', bedeutung: 'Komplettgericht' },
] as const;

export type Farbe = (typeof FARBEN)[number]['id'];

export function farbe(id: Farbe) {
  return FARBEN.find((f) => f.id === id)!;
}
