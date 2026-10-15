// Grundbausteine: der Grundvorrat des Food-Baukastens, aus dem die Grundrezepte bestehen.
//
// Vier Kategorien wie im Kombi-Farbsystem:
//   Rot   – Basis & Soße: Tomatenkonserven, Kokosmilch, vorbereitete Basen
//   Braun – Protein: gekochte Hülsenfrüchte (portionsweise eingefroren), Sojagranulat
//   Grün  – Gemüse: TK-Gemüse, neutrale Gemüse-Basis, Mais
//   Gelb  – Sattmacher & Trockenvorrat: Nudeln, Reis, Kartoffeln, Mehl, trockene Hülsenfrüchte, Brot
// Dazu fertige Gerichte (selbst gemachte Pizza) und wenige Extras (Käse), die ein Rezept nur ergänzen.
// Zwiebeln, Möhren und Knoblauch gelten als immer vorhanden (Grundausstattung, siehe snapshot.ts).
//
// Erkannt wird deterministisch am Namen der Sorte bzw. am Text, den der Nutzer eingibt.
// Die Farbe der Sorte entscheidet nur, wo der Name allein nicht reicht: „Kichererbsen“ in Gelb sind
// trocken (Vorrat), in Braun gekocht (Protein). Fleisch und Fisch passen nie – alles ist vegetarisch.
import type { Farbe, Lagerort, SnapshotZutat } from './typen.ts';
import { normalisiere } from './text.ts';

export type Kategorie = 'rot' | 'braun' | 'gruen' | 'gelb' | 'komplett' | 'extra';

export type Grundbaustein = {
  id: string;
  /** Anzeige, z. B. „Gekochte Kichererbsen“ – auch der Name auf der Einkaufsliste, wenn er fehlt */
  name: string;
  kategorie: Kategorie;
  /** wird vorbereitet und eingefroren (Komponente) statt fertig gekauft */
  vorbereitet: boolean;
  lagerung: Lagerort;
  /** übliche Menge pro Person in g bzw. ml – wenn der Baustein in einem Rezept etwas anderes ersetzt */
  pro_person_g: number;
  /** Gramm je Stück/Packung – für Sorten, die in Stück geführt werden */
  stueck_g: number;
  /** wird in ml angegeben (Kokosmilch) */
  fluessig?: boolean;
  /** ersetzt zusätzlich diese Bausteine (Linsen-Bolognese-Basis = Linsen + Tomaten) */
  deckt?: string[];
  /** passt die Sorte bzw. der genannte Text? n = normalisierter Name */
  passt: (n: string, farbe: Farbe | null) => boolean;
};

const FLEISCH_FISCH = /haehnchen|huhn|gefluegel|\bpute|truthahn|\brind|beef|steak|schwein|\bpork|hackfleisch|\bhack\b|faschiert|speck|bacon|pancetta|schinken|salami|wurst|chorizo|lachs|thunfisch|\bfisch|garnele|shrimp|scampi/;
const TROCKEN = /\btrocken\w*|getrocknet\w*/;
const GEKOCHT = /gekocht|\bdose\b|\bglas\b|abgetropft|vorgegart|hack/;

/** Hülsenfrüchte: trocken (Vorrat) oder gekocht? Gelb ohne „gekocht“ gilt als trocken. */
function trocken(n: string, farbe: Farbe | null, typischTrocken = false): boolean {
  if (TROCKEN.test(n)) return true;
  if (GEKOCHT.test(n)) return false;
  return farbe === 'gelb' || typischTrocken;
}
const ROTE_LINSEN = /rote linse|teller ?linse|berg ?linse|beluga|braune linse|gruene linse/;
/** Fertige Gerichte mit Hülsenfrüchten sind keine Bausteine */
const GERICHT = /bolognese|bolo\b|ragu|suppe|\bdal\b|curry|eintopf|chili|hummus|falafel|burger|patty|bratling|basis|mehl|chips/;

const b = (
  id: string, name: string, kategorie: Kategorie, lagerung: Lagerort, pro_person_g: number, stueck_g: number,
  passt: Grundbaustein['passt'], extra: { vorbereitet?: boolean; deckt?: string[]; fluessig?: boolean } = {},
): Grundbaustein => ({
  id, name, kategorie, vorbereitet: extra.vorbereitet ?? false, lagerung, pro_person_g, stueck_g, passt, deckt: extra.deckt, fluessig: extra.fluessig,
});

const re = (muster: RegExp, ausser?: RegExp) => (n: string) => muster.test(n) && !(ausser?.test(n));

/** Reihenfolge innerhalb einer Kategorie = Reihenfolge in Listen. */
export const GRUNDBAUSTEINE: Grundbaustein[] = [
  // ───────── Rot: Basis & Soße ─────────
  b('passierte_tomaten', 'Passierte Tomaten', 'rot', 'vorrat', 200, 500, re(/passierte tomate|passata/)),
  b('gehackte_tomaten', 'Gehackte Tomaten', 'rot', 'vorrat', 200, 400,
    re(/gehackte tomate|stueckige tomate|geschaelte tomate|tomaten (in der )?dose|dosentomate/)),
  b('tomatenmark', 'Tomatenmark', 'rot', 'vorrat', 20, 200, re(/tomatenmark/)),
  b('kokosmilch', 'Kokosmilch', 'rot', 'vorrat', 200, 400, re(/kokosmilch|kokosnussmilch/, /drink/), { fluessig: true }),
  b('tomaten_gemuese_basis', 'Tomaten-Gemüse-Basis', 'rot', 'gefrierfach', 150, 250,
    re(/tomat\w* ?(gemuese ?)?(sosse|sauce|basis|sugo)|\bsugo\b/, /bolognese|ragu|linse/), { vorbereitet: true }),
  b('linsen_bolognese_basis', 'Linsen-Bolognese-Basis', 'rot', 'gefrierfach', 250, 250,
    re(/linse\w* ?(bolognese|bolo|ragu)|(bolognese|ragu) (mit|aus) linse/),
    { vorbereitet: true, deckt: ['rote_linsen', 'gekochte_linsen', 'passierte_tomaten', 'gehackte_tomaten', 'tomaten_gemuese_basis'] }),

  // ───────── Braun: Protein ─────────
  b('gekochte_kichererbsen', 'Gekochte Kichererbsen', 'braun', 'gefrierfach', 120, 240,
    (n, f) => /kichererbse/.test(n) && !trocken(n, f) && !GERICHT.test(n), { vorbereitet: true }),
  b('gekochte_kidneybohnen', 'Gekochte Kidneybohnen', 'braun', 'gefrierfach', 125, 250,
    (n, f) => /kidney|rote bohne|bohne/.test(n) && !trocken(n, f) && !GERICHT.test(n)
      && !/gruene bohne|brech ?bohne|busch ?bohne|stangen ?bohne|prinzess ?bohne|edamame|kaffee|vanille|tonka|kakao|weisse bohne/.test(n),
    { vorbereitet: true }),
  b('gekochte_linsen', 'Gekochte Linsen', 'braun', 'gefrierfach', 125, 250,
    (n, f) => /linse/.test(n) && !trocken(n, f, ROTE_LINSEN.test(n)) && !/bolognese|bolo\b|ragu|suppe|\bdal\b|curry|eintopf/.test(n),
    { vorbereitet: true }),
  b('sojagranulat', 'Sojagranulat', 'braun', 'vorrat', 30, 200, re(/soja ?(granulat|schnetzel|hack|geschnetzeltes)|tvp/)),

  // ───────── Grün: Gemüse ─────────
  b('tk_gemuese', 'TK-Gemüse', 'gruen', 'gefrierfach', 150, 450,
    (n, f) => /gemuese|erbse(?!n? ?trocken)|brokkoli|broccoli|blumenkohl|spinat|bohnen ?gemuese|gruene bohne|rosenkohl|zucchini|paprika ?mix|wok ?mix/.test(n)
      && !/basis|suppe|bruehe|fond|kichererbse|chips|pulver|saft/.test(n) && (f === 'gruen' || /\btk\b|tiefkuehl|gefroren|mix|mischung|pfanne/.test(n))),
  b('neutrale_gemuese_basis', 'Neutrale Gemüse-Basis', 'gruen', 'gefrierfach', 150, 300,
    re(/gemuese ?basis|ofen ?gemuese|vorbereitetes gemuese/, /tomat/), { vorbereitet: true }),
  b('mais', 'Mais', 'gruen', 'vorrat', 70, 140, re(/\bmais\b|maiskoerner|zuckermais/, /mehl|staerke|waffel|chips|griess/)),

  // ───────── Gelb: Sattmacher & Trockenvorrat ─────────
  b('nudeln', 'Nudeln', 'gelb', 'vorrat', 100, 500,
    re(/pasta|nudel|spaghetti|penne|fusilli|farfalle|rigatoni|tagliatelle|makkaroni|maccheroni|linguine|orecchiette|tortiglioni|conchiglie|spirelli|hoernchen/,
      /lasagne|reis ?nudel|glas ?nudel|suppen ?nudel|nudelsalat|schupfnudel|nudel ?(pfanne|auflauf|suppe)/)),
  b('reis', 'Reis', 'gelb', 'vorrat', 75, 500,
    (n) => /(^|[^pk])reis(?!e\b|en\b)|basmati|jasmin|parboiled|langkorn/.test(n) && !/nudel|waffel|mehl|milchreis|essig|cracker|kuchen|drink|reismilch|box|topf|pfanne/.test(n)),
  b('lasagneplatten', 'Lasagneplatten', 'gelb', 'vorrat', 70, 500, re(/lasagne ?(platte|blaett|blatt|nudel)|lasagneplatten/)),
  b('kartoffeln', 'Kartoffeln', 'gelb', 'vorrat', 225, 100,
    re(/kartoffel|erdaepfel|drillinge/, /suesskartoffel|pueree|chips|knoedel|kloss|kloesse|pommes|gnocchi|staerke|mehl|salat|puffer|roesti|kroketten|wedges|suppe|eintopf|topf|pfanne/)),
  b('haferflocken', 'Haferflocken', 'gelb', 'vorrat', 20, 500, re(/haferflocken|\bhafer\b|porridge/)),
  b('mehl', 'Mehl', 'gelb', 'vorrat', 60, 1000, re(/mehl\b|\bmehl/, /kichererbsen|mais|kartoffel|reis|panier|johannisbrot|kokos|mandel|gluten/)),
  b('rote_linsen', 'Rote Linsen', 'gelb', 'vorrat', 70, 500,
    (n, f) => /linse/.test(n) && /rote/.test(n) && trocken(n, f, true) && !/bolognese|suppe|\bdal\b|curry/.test(n)),
  b('braune_linsen', 'Braune oder grüne Linsen', 'gelb', 'vorrat', 70, 500,
    (n, f) => /linse/.test(n) && !/rote/.test(n) && trocken(n, f, ROTE_LINSEN.test(n)) && !/bolognese|suppe|\bdal\b|curry/.test(n)),
  b('kichererbsen_trocken', 'Kichererbsen, trocken', 'gelb', 'vorrat', 60, 500, (n, f) => /kichererbse/.test(n) && trocken(n, f) && !GERICHT.test(n)),
  b('kidneybohnen_trocken', 'Kidneybohnen, trocken', 'gelb', 'vorrat', 60, 500,
    (n, f) => /kidney|rote bohne/.test(n) && trocken(n, f) && !GERICHT.test(n)),
  b('brot', 'Brot', 'gelb', 'gefrierfach', 80, 40,
    re(/brot|toast|baguette|ciabatta/, /broetchen|fladenbrot|pita|knaecke|paniermehl|semmelbroesel|brotchips|aufstrich|gewuerz|knoblauch/)),
  b('broetchen', 'Brötchen', 'gelb', 'gefrierfach', 70, 70, re(/broetchen|semmel|schrippe|weckle|laugen/)),

  // ───────── Fertige Gerichte aus dem Gefrierschrank ─────────
  b('margherita_pizza', 'Margherita-Pizza', 'komplett', 'gefrierfach', 1, 1, re(/pizza/, /teig|sosse|sauce|mehl|kaese|gewuerz/), { vorbereitet: true }),

  // ───────── Extras: nicht im Grundvorrat, ergänzen ein Rezept ─────────
  b('kaese', 'Käse', 'extra', 'kuehlschrank', 30, 200,
    re(/kaese|parmesan|parmigiano|grana padano|pecorino|gouda|emmentaler|cheddar|mozzarell/, /frischkaese|kuchen/)),
];

const NACH_ID = new Map(GRUNDBAUSTEINE.map((x) => [x.id, x]));

export function grundbaustein(id: string): Grundbaustein {
  const x = NACH_ID.get(id);
  if (!x) throw new Error(`Unbekannter Grundbaustein: ${id}`);
  return x;
}

export const KATEGORIE_INFO: Record<Kategorie, { name: string; farbe: Farbe | null }> = {
  rot: { name: 'Basis & Soße', farbe: 'rot' },
  braun: { name: 'Protein', farbe: 'braun' },
  gruen: { name: 'Gemüse', farbe: 'gruen' },
  gelb: { name: 'Sattmacher & Trockenvorrat', farbe: 'gelb' },
  komplett: { name: 'Fertige Gerichte', farbe: 'blau' },
  extra: { name: 'Extras', farbe: null },
};

/** Welche Grundbausteine ist dieser Name? (Mehrere sind möglich, Reihenfolge wie im Katalog.) */
export function bausteineFuerName(name: string, farbe: Farbe | null = null): Grundbaustein[] {
  const n = normalisiere(name);
  if (!n || FLEISCH_FISCH.test(n)) return [];
  return GRUNDBAUSTEINE.filter((x) => x.passt(n, farbe));
}

/**
 * Grundbausteine einer Zutat aus dem Snapshot. Gewürz-Booster und die Grundausstattung
 * (Salz, Öl, Zwiebeln …) sind keine Bausteine; Komplettgerichte nur als fertige Gerichte.
 */
export function bausteineVon(z: SnapshotZutat): Grundbaustein[] {
  if (z.quelle === 'grundausstattung' || z.farbe === 'weiss') return [];
  const komplett = z.art === 'komplettgericht' || z.farbe === 'blau';
  return bausteineFuerName(z.name, z.farbe).filter((x) => (x.kategorie === 'komplett') === komplett);
}

/** Welcher der gesuchten Bausteine ist diese Zutat? (in der Reihenfolge der Suche) */
export function erfuellt(z: SnapshotZutat, gesucht: readonly string[]): Grundbaustein | null {
  const eigene = bausteineVon(z);
  for (const id of gesucht) {
    const x = eigene.find((e) => e.id === id);
    if (x) return x;
  }
  return null;
}

export type BausteinStand = { baustein: Grundbaustein; sorten: SnapshotZutat[] };

/** Welche Grundbausteine hat der Haushalt gerade? (für Übersichten) */
export function bausteinStand(zutaten: SnapshotZutat[]): BausteinStand[] {
  return GRUNDBAUSTEINE.map((baustein) => ({
    baustein,
    sorten: zutaten.filter((z) => bausteineVon(z).some((x) => x.id === baustein.id)),
  }));
}
