// 30 reproduzierbare Testszenarien für den KI-Benchmark: normale Zutaten, Komponenten,
// Komplettgerichte, unbekannte Zusammensetzung, Ablauf/Reste, Notfall, Feedback, Komponenten-Ideen, Woche.
// Fester Stichtag – so sind die Ergebnisse vergleichbar.
import type { BestandZeile } from '../../supabase/functions/_shared/kombi/snapshot.ts';
import type { Aufgabe, FeedbackEintrag, GerichtKurz, Modus, Optionen } from '../../supabase/functions/_shared/kombi/typen.ts';

export const STICHTAG = '2026-09-28';

let naechsteId = 100;
const z = (name: string, farbe: BestandZeile['farbe'], anzahl: number, teil: Partial<BestandZeile> = {}): BestandZeile => ({
  id: naechsteId++, name, farbe, anzahl, bald_ablaufen: false, groesse_g: 100, kosten_cent: null, lagerort: 'kuehlschrank', art: 'zutat', ...teil,
});
const g = (menge: number, preis: number | null, teil: Partial<BestandZeile> = {}): Partial<BestandZeile> =>
  ({ einheit: 'g', portion_menge: 100, kosten_cent: preis, kosten_menge: 1000, ...teil });

// ───────── Bausteine ─────────
export const TOMATE = z('Strauchtomaten', 'gruen', 500, g(500, 399, { kcal: 18, naehrwert_menge: 100 }));
export const GURKE = z('Salatgurke', 'gruen', 1, { einheit: 'stueck', kosten_cent: 69, kcal: 45 });
export const JOGHURT = z('Griechischer Joghurt', 'schwarz', 400, g(400, 298, { kcal: 97, naehrwert_menge: 100 }));
export const ZWIEBEL = z('Zwiebeln', 'gruen', 600, g(600, 129, { lagerort: 'vorrat' }));
export const KNOBLAUCH = z('Knoblauch', 'weiss', 3, { einheit: 'stueck', lagerort: 'vorrat' });
export const PAPRIKA = z('Paprika rot', 'gruen', 2, { einheit: 'stueck', kosten_cent: 79 });
export const KARTOFFEL = z('Kartoffeln festkochend', 'gelb', 1500, g(1500, 199, { lagerort: 'vorrat', portion_menge: 250 }));
export const KAROTTE = z('Karotten', 'gruen', 500, g(500, 99));
export const SPINAT = z('Blattspinat', 'gruen', 200, g(200, 199, { naechster_ablauf: '2026-09-29', bald_ablaufen: true }));
export const BROKKOLI = z('Brokkoli', 'gruen', 1, { einheit: 'stueck', kosten_cent: 149 });
export const REIS = z('Basmati Reis', 'gelb', 1000, g(1000, 249, { lagerort: 'vorrat', portion_menge: 75, kcal: 350 }));
export const PASTA = z('Spaghetti', 'gelb', 500, g(500, 99, { lagerort: 'vorrat', portion_menge: 125, kcal: 359 }));
export const BROT = z('Vollkornbrot', 'gelb', 6, { einheit: 'stueck', lagerort: 'vorrat', kosten_cent: 219 });
export const WRAPS = z('Weizen Wraps', 'gelb', 6, { einheit: 'stueck', lagerort: 'vorrat', kosten_cent: 149 });
export const HAFER = z('Haferflocken', 'gelb', 500, g(500, 89, { lagerort: 'vorrat', portion_menge: 50 }));
export const LINSEN = z('Rote Linsen', 'braun', 500, g(500, 179, { lagerort: 'vorrat', portion_menge: 80 }));
export const KICHER = z('Kichererbsen (Dose)', 'braun', 2, { einheit: 'stueck', lagerort: 'vorrat', kosten_cent: 89 });
export const BOHNEN = z('Kidneybohnen', 'braun', 1, { einheit: 'stueck', lagerort: 'vorrat', kosten_cent: 79 });
export const KAESE = z('Gouda gerieben', 'schwarz', 200, g(200, 199, { kcal: 356, naehrwert_menge: 100 }));
export const TOFU = z('Tofu natur', 'braun', 400, g(400, 229));
export const SEITAN = z('Seitan', 'braun', 250, g(250, 299));
export const MAIS = z('Mais (Dose)', 'gruen', 1, { einheit: 'stueck', lagerort: 'vorrat', kosten_cent: 89 });

const komp = (name: string, farbe: BestandZeile['farbe'], anzahl: number, zusammensetzung: string[] | null, teil: Partial<BestandZeile> = {}) =>
  z(name, farbe, anzahl, { art: 'komponente', lagerort: 'gefrierfach', herkunft: 'selbstgemacht', zusammensetzung, kosten_cent: 24, ...teil });
export const TOMATEN_BASIS = komp('Tomaten-Basis', 'rot', 6, ['Tomaten', 'Zwiebeln', 'Knoblauch'], { kcal: 45 });
export const FALAFEL = komp('Falafel', 'braun', 8, null);
export const OFENGEMUESE = komp('Ofengemüse', 'gruen', 4, ['Paprika', 'Zucchini', 'Zwiebeln']);
export const CURRY_BASIS = komp('Curry-Basis', 'rot', 4, ['Kokosmilch', 'Zwiebeln', 'Currypaste']);
export const REIS_GEKOCHT = komp('Gekochter Reis', 'gelb', 4, ['Reis'], { lagerort: 'kuehlschrank', naechster_ablauf: '2026-09-30', bald_ablaufen: true });
export const LINSEN_BOLO = komp('Linsen-Bolognese', 'braun', 4, ['Linsen', 'Tomaten', 'Karotten']);
export const SOSSE_UNBEKANNT = komp('Soße vom Wochenende', 'rot', 2, null);

const fertig = (name: string, anzahl: number, teil: Partial<BestandZeile> = {}) =>
  z(name, 'blau', anzahl, { art: 'komplettgericht', lagerort: 'gefrierfach', kosten_cent: 150, ...teil });
export const PIZZA = fertig('TK-Pizza', 2, { herkunft: 'gekauft' });
export const LASAGNE = fertig('Lasagne-Portion', 3, { herkunft: 'selbstgemacht', kosten_cent: 85 });
export const CHILI = fertig('Chili sin Carne', 4, { zusammensetzung: ['Bohnen', 'Tomaten', 'Mais', 'Paprika'] });
export const BURRITO = fertig('Burrito', 2);

export type Szenario = {
  id: string;
  titel: string;
  bestand: BestandZeile[];
  kuehlschrank?: string;
  optionen?: Partial<Optionen>;
  modus?: Modus;
  aufgabe?: Aufgabe;
  anzahl?: number;
  feedback?: FeedbackEintrag[];
  gesehen?: GerichtKurz[];
  /** Namen, die bald weg sollten – zählt, ob die Vorschläge sie nutzen */
  dringend?: string[];
};

const fb = (aktion: FeedbackEintrag['aktion'], name: string, gerichtstyp: GerichtKurz['eigenschaften']['gerichtstyp']): FeedbackEintrag => ({
  name, zutaten: [], vorschlag_id: `v-${name}`, aktion,
  eigenschaften: { gerichtstyp, hauptzutat: 'x', geschmack: 'herzhaft', schaerfe: 0, konsistenz: 'stueckig', sattmacher: 'reis', gewuerzrichtung: 'indisch', zubereitung: 'topf', temperatur: 'warm' },
});

const ALLES = [TOMATE, GURKE, JOGHURT, ZWIEBEL, KNOBLAUCH, PAPRIKA, KARTOFFEL, KAROTTE, SPINAT, BROKKOLI, REIS, PASTA, BROT, WRAPS,
  LINSEN, KICHER, BOHNEN, KAESE, TOFU, TOMATEN_BASIS, FALAFEL, OFENGEMUESE, CURRY_BASIS, LINSEN_BOLO, PIZZA, LASAGNE, CHILI];

export const SZENARIEN: Szenario[] = [
  { id: 'frisch-bowl', titel: 'Nur frische Zutaten: Tomate, Gurke, Joghurt, Brot', bestand: [TOMATE, GURKE, JOGHURT, BROT] },
  { id: 'pasta-basis', titel: 'Pasta + Tomaten-Basis + Zwiebel + Knoblauch', bestand: [PASTA, TOMATEN_BASIS, ZWIEBEL, KNOBLAUCH] },
  { id: 'baukasten', titel: 'Komponenten-Baukasten', bestand: [TOMATEN_BASIS, FALAFEL, OFENGEMUESE, REIS_GEKOCHT, WRAPS] },
  { id: 'nur-komplett', titel: 'Nur Komplettgerichte', bestand: [PIZZA, LASAGNE, BURRITO] },
  { id: 'pizza-unbekannt', titel: 'TK-Pizza (Belag unbekannt) + Salatgurke', bestand: [PIZZA, GURKE, TOMATE] },
  { id: 'ablauf', titel: 'Spinat läuft morgen ab, Joghurt geöffnet', bestand: [SPINAT, { ...JOGHURT, geoeffnet: 400 }, PASTA, ZWIEBEL, KAESE], dringend: ['Blattspinat', 'Griechischer Joghurt'] },
  { id: 'kuehlschrank', titel: 'Kühlschrank-Reste als Text', bestand: [REIS, WRAPS, BOHNEN], kuehlschrank: 'eine halbe Paprika, etwas Frischkäse und Mais', dringend: ['eine halbe Paprika'] },
  { id: 'notfall', titel: 'Notfall: fast nichts da', bestand: [REIS] },
  { id: 'leer', titel: 'Leer (nur Grundausstattung)', bestand: [] },
  { id: 'protein-mix', titel: 'Tofu, Seitan, Kichererbsen + Reis', bestand: [TOFU, SEITAN, KICHER, REIS, PAPRIKA] },
  { id: 'eintopf', titel: 'Kartoffeln, Karotten, Zwiebeln', bestand: [KARTOFFEL, KAROTTE, ZWIEBEL, LINSEN] },
  { id: 'auflauf', titel: 'Brokkoli, Pasta, Käse', bestand: [BROKKOLI, PASTA, KAESE, ZWIEBEL] },
  { id: 'mexikanisch', titel: 'Wraps, Bohnen, Paprika, Mais', bestand: [WRAPS, BOHNEN, PAPRIKA, MAIS, TOMATE] },
  { id: 'curry', titel: 'Linsen, Curry-Basis, Reis', bestand: [LINSEN, CURRY_BASIS, REIS, SPINAT], dringend: ['Blattspinat'] },
  { id: 'fruehstueck', titel: 'Haferflocken, Joghurt', bestand: [HAFER, JOGHURT], optionen: { max_minuten: 10 } },
  { id: 'gross', titel: 'Großer gemischter Haushalt', bestand: ALLES },
  { id: 'feedback', titel: 'Drei Currys abgelehnt', bestand: ALLES, feedback: [fb('dislike', 'Curry A', 'curry'), fb('dislike', 'Curry B', 'curry'), fb('dislike', 'Curry C', 'curry')] },
  { id: 'abwechslung', titel: 'Schon drei Wraps gesehen', bestand: ALLES,
    gesehen: ['Wrap 1', 'Wrap 2', 'Wrap 3'].map((n) => ({ name: n, zutaten: [], eigenschaften: { ...fb('like', n, 'wrap').eigenschaften, sattmacher: 'wrap' } })) },
  { id: 'reste', titel: 'Reste zuerst: Geöffnetes und Aufgetautes', bestand: [{ ...TOMATEN_BASIS, geoeffnet: 2 }, { ...FALAFEL, aufgetaut: 2 }, PASTA, WRAPS], modus: { art: 'reste' }, dringend: ['Tomaten-Basis', 'Falafel'] },
  { id: 'reste-nichts', titel: 'Reste zuerst, aber nichts Dringendes', bestand: [PASTA, REIS, TOMATEN_BASIS], modus: { art: 'reste' } },
  { id: 'komp-frisch', titel: 'Komponenten-Ideen aus frischen Zutaten', bestand: [TOMATE, ZWIEBEL, KNOBLAUCH, KICHER, KAROTTE], aufgabe: 'komponenten', anzahl: 3 },
  { id: 'komp-gross', titel: 'Komponenten-Ideen, großer Haushalt', bestand: ALLES, aufgabe: 'komponenten', anzahl: 4 },
  { id: 'woche', titel: 'Woche: 3 Abende planen', bestand: ALLES, aufgabe: 'woche', anzahl: 3 },
  { id: 'schnell-guenstig', titel: '10 Minuten, günstig', bestand: ALLES, optionen: { max_minuten: 10, guenstig: true } },
  { id: 'vier-personen', titel: 'Vier Personen', bestand: [PASTA, LINSEN_BOLO, TOMATEN_BASIS, KAESE, BROKKOLI], optionen: { personen: 4 } },
  { id: 'sosse-unbekannt', titel: 'Soße mit unbekannter Zusammensetzung + Pasta', bestand: [SOSSE_UNBEKANNT, PASTA, KAESE] },
  { id: 'abgelaufen', titel: 'Abgelaufener Joghurt darf nicht eingeplant werden', bestand: [{ ...JOGHURT, abgelaufen: 400 }, HAFER, BROT] },
  { id: 'nur-booster', titel: 'Pasta + Gewürz-Booster', bestand: [PASTA, z('Booster Italien', 'weiss', 6, { art: 'komponente', lagerort: 'vorrat' })] },
  { id: 'toast', titel: 'Brot, Käse, Tomate', bestand: [BROT, KAESE, TOMATE, GURKE] },
  { id: 'chili-plus', titel: 'Chili (bekannte Zusammensetzung) mit Beilage', bestand: [CHILI, REIS, BROT] },
];
