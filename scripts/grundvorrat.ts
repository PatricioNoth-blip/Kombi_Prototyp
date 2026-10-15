// Der Grundvorrat des Food-Baukastens als Sorten – für scripts/grundvorrat-anlegen.ts.
// Nur die Stammdaten (Farbe, Art, Einheit, Lagerort, Portionsgröße …), KEINE Mengen: Was wirklich da
// ist, bucht man in der App ein. Zwiebeln, Möhren und Knoblauch fehlen bewusst – sie sind immer da
// (Grundausstattung) und werden nicht als Vorrat geführt.
import type { Art, Einheit, Farbe, Herkunft, Lagerort } from '../supabase/functions/_shared/kombi/typen.ts';
import { bausteineFuerName } from '../supabase/functions/_shared/kombi/grundbausteine.ts';
import { normalisiere } from '../supabase/functions/_shared/kombi/text.ts';

export type NeueSorte = {
  name: string;
  farbe: Farbe;
  art: Art;
  herkunft: Herkunft;
  einheit: Einheit;
  /** Einheiten pro Portion (bei „portion“ immer 1) */
  portion_menge: number;
  /** Gramm je Einheit bzw. Portion */
  groesse_g: number;
  haltbar_tage: number;
  lagerort: Lagerort;
  zusammensetzung: string[] | null;
  notiz: string | null;
};

const vorrat = (name: string, farbe: Farbe, einheit: Einheit, menge: number, haltbar_tage: number, notiz: string | null = null): NeueSorte => ({
  name, farbe, art: 'zutat', herkunft: 'gekauft', einheit,
  portion_menge: einheit === 'g' ? menge : 1, groesse_g: menge, haltbar_tage, lagerort: 'vorrat', zusammensetzung: null, notiz,
});
const basis = (name: string, farbe: Farbe, groesse_g: number, zusammensetzung: string[], notiz: string | null = null): NeueSorte => ({
  name, farbe, art: 'komponente', herkunft: 'selbstgemacht', einheit: 'portion',
  portion_menge: 1, groesse_g, haltbar_tage: 90, lagerort: 'gefrierfach', zusammensetzung, notiz,
});

export const GRUNDVORRAT: NeueSorte[] = [
  // 1. Vorratsschrank – trockene Lebensmittel & Konserven (Gramm bzw. Packungen)
  vorrat('Nudeln', 'gelb', 'g', 125, 730),
  vorrat('Reis', 'gelb', 'g', 75, 730),
  vorrat('Lasagneplatten', 'gelb', 'g', 70, 730),
  vorrat('Haferflocken', 'gelb', 'g', 50, 365),
  vorrat('Mehl', 'gelb', 'g', 100, 365),
  vorrat('Kartoffeln', 'gelb', 'g', 250, 60, 'Dunkel, kühl und luftig lagern.'),
  vorrat('Rote Linsen, trocken', 'gelb', 'g', 70, 730),
  vorrat('Braune Linsen, trocken', 'gelb', 'g', 70, 730, 'Braune oder grüne Linsen.'),
  vorrat('Kichererbsen, trocken', 'gelb', 'g', 60, 730, 'Vor dem Kochen mindestens 12 Stunden einweichen.'),
  vorrat('Kidneybohnen, trocken', 'gelb', 'g', 60, 730, 'Einweichen und vollständig kochen – roh nicht essbar.'),
  vorrat('Sojagranulat', 'braun', 'g', 30, 365),
  vorrat('Passierte Tomaten', 'rot', 'stueck', 500, 365, 'Packung, ungeöffnet.'),
  vorrat('Gehackte Tomaten', 'rot', 'stueck', 400, 730, 'Dose, ungeöffnet.'),
  vorrat('Tomatenmark', 'rot', 'stueck', 200, 365, 'Ungeöffnet.'),
  vorrat('Mais', 'gruen', 'stueck', 285, 730, 'Dose, ungeöffnet.'),
  vorrat('Kokosmilch', 'rot', 'stueck', 400, 365, 'Dose, ungeöffnet.'),
  // 2. Gefrierschrank – Brot, Brötchen & fertige Gerichte
  { ...vorrat('Brot', 'gelb', 'stueck', 40, 90, 'In Scheiben eingefroren – 1 = eine Scheibe.'), lagerort: 'gefrierfach' },
  { ...vorrat('Brötchen', 'gelb', 'stueck', 70, 90, 'Portionsweise eingefroren.'), lagerort: 'gefrierfach' },
  {
    name: 'Margherita-Pizza', farbe: 'blau', art: 'komplettgericht', herkunft: 'selbstgemacht', einheit: 'stueck', portion_menge: 1,
    groesse_g: 350, haltbar_tage: 90, lagerort: 'gefrierfach', zusammensetzung: ['Tomatensoße', 'Mozzarella'], notiz: 'Fertig belegt, ungebacken eingefroren.',
  },
  // 3. Gefrierschrank – vorbereitete Basen
  basis('Tomaten-Gemüse-Basis', 'rot', 250, ['Passierte Tomaten', 'Gemüse'], 'Passierte Tomaten plus vorhandenes Gemüse.'),
  basis('Linsen-Bolognese-Basis', 'rot', 250, ['Linsen', 'Tomaten', 'Gemüse']),
  basis('Neutrale Gemüse-Basis', 'gruen', 200, ['Gemüse'], 'Vorbereitetes Gemüse für verschiedene Gerichte.'),
  // 4. Gefrierschrank – vorbereitete Hülsenfrüchte & Gemüse
  basis('Gekochte Kichererbsen', 'braun', 240, ['Kichererbsen']),
  basis('Gekochte Kidneybohnen', 'braun', 250, ['Kidneybohnen']),
  basis('Gekochte Linsen', 'braun', 250, ['Linsen']),
  { ...vorrat('TK-Gemüse', 'gruen', 'g', 150, 270), lagerort: 'gefrierfach' },
];

export type Vorhanden = { id: number; name: string; farbe: Farbe };
export type Plan = { anlegen: NeueSorte[]; schonDa: { sorte: NeueSorte; als: string }[] };

/** Baustein, für den eine Sorte steht – Fertiggerichte und TK-Gemüse nur bei gleichem Namen (sie sind Produkte, keine Rolle). */
const NUR_GLEICHER_NAME = new Set(['margherita_pizza', 'tk_gemuese']);

/**
 * Was ist anzulegen? Übersprungen wird, was es schon gibt: gleicher Name – oder eine Sorte, die derselbe
 * Grundbaustein ist („Linsen gekocht“ = „Gekochte Linsen“), damit nichts doppelt im Vorrat steht.
 */
export function planeGrundvorrat(vorhanden: Vorhanden[], liste: NeueSorte[] = GRUNDVORRAT): Plan {
  const plan: Plan = { anlegen: [], schonDa: [] };
  for (const s of liste) {
    const gleich = vorhanden.find((v) => normalisiere(v.name) === normalisiere(s.name));
    const ids = bausteineFuerName(s.name, s.farbe).map((b) => b.id).filter((id) => !NUR_GLEICHER_NAME.has(id));
    const verwandt = ids.length
      ? vorhanden.find((v) => bausteineFuerName(v.name, v.farbe).some((b) => ids.includes(b.id)))
      : undefined;
    const da = gleich ?? verwandt;
    if (da) plan.schonDa.push({ sorte: s, als: da.name });
    else plan.anlegen.push(s);
  }
  return plan;
}
