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

export const LAGERORTE = [
  { id: 'gefrierfach', name: 'Gefrierfach', icon: '❄' },
  { id: 'kuehlschrank', name: 'Kühlschrank', icon: '🧊' },
  { id: 'vorrat', name: 'Vorrat', icon: '🥫' },
] as const;

export type LagerortId = (typeof LAGERORTE)[number]['id'];

/** „einfrieren“ fürs Gefrierfach, sonst „einbuchen“ */
export const buchungsVerb = (lagerort?: LagerortId) =>
  !lagerort || lagerort === 'gefrierfach'
    ? { infinitiv: 'einfrieren', partizip: 'eingefroren' }
    : { infinitiv: 'einbuchen', partizip: 'eingebucht' };

export function farbe(id: Farbe) {
  return FARBEN.find((f) => f.id === id)!;
}
