// Kreativität ja, Halluzination nein.
//
// Die KI darf Namen, Beschreibungen und Zubereitung frei formulieren – aber keine Zutaten,
// Eigenschaften oder Preise erfinden. Diese Datei prüft ihre Texte gegen das, was wirklich
// bekannt ist:
//   • Name/Beschreibung/Begründung dürfen nur Zutaten nennen, die im Gericht stecken:
//     verwendete Einträge, deren BEKANNTE Zusammensetzung, als fehlend markierte Zutaten,
//     Grundausstattung. „Pizza“ mit unbekannter Zusammensetzung ist keine „Salami-Pizza“.
//   • Zubereitungsschritte dürfen alles aus dem Haushalt nennen; was es dort nicht gibt,
//     wird ehrlich als „fehlt“ markiert.
//   • Preisangaben, Diät-Behauptungen (vegan, glutenfrei …) und „hausgemacht“ ohne Grundlage
//     werden entfernt.
// Erkannt wird über ein Lexikon typischer Zutaten. Was nicht im Lexikon steht (Gewürzwörter
// wie „würzig“, Gerichtstypen wie „Curry“ oder „Bowl“), gilt als Stil und bleibt frei.

/** Kleinbuchstaben, Umlaute ausgeschrieben, Akzente entfernt, nur a–z/0–9 und Leerzeichen. */
export function flach(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type Eintrag = { name: string; muster: RegExp; deckung: RegExp };

const e = (name: string, muster: string, deckung = muster): Eintrag => ({
  name,
  muster: new RegExp(muster),
  deckung: new RegExp(deckung),
});

const KAESE = 'kaese|mozzarell|parmesan|parmigiano|gouda|cheddar|feta|halloumi|pecorino|emmentaler|gorgonzola|burrata|ricotta|reibekaese';

/** Zutaten, die eine KI gern „dazudichtet“. Muster laufen auf flach()-Text. */
export const LEXIKON: Eintrag[] = [
  // Milchprodukte & Ei
  e('Käse', '(?<!frisch)kaese', KAESE),
  e('Mozzarella', 'mozzarell'),
  e('Parmesan', 'parmesan|parmigiano'),
  e('Feta', '\\bfeta|hirtenkaese|schafskaese'),
  e('Halloumi', 'halloumi|grillkaese'),
  e('Frischkäse', 'frischkaese'),
  e('Sahne', '(?<!saure )sahne\\b|sahnesosse|schlagsahne|kochsahne'),
  e('Crème fraîche', 'creme fraiche|cremefraiche|schmand|saure sahne'),
  e('Joghurt', 'joghurt|jogurt|skyr|tzatziki'),
  e('Quark', '\\bquark|magerquark'),
  e('Milch', '(?<!kokos)(?<!hafer)(?<!soja)milch'),
  e('Butter', '(?<!erdnuss)butter'),
  e('Ei', '\\b(ei|eier|eiern|spiegelei|spiegeleier|ruehrei|omelett|omelette|eigelb|eiweiss)\\b'),
  // Fleisch & Fisch
  e('Hähnchen', 'haehnchen|huhn|huehner|chicken|gefluegel|\\bpute|truthahn'),
  e('Rind', '\\brind|\\bbeef|steak'),
  e('Schwein', 'schwein|\\bpork'),
  e('Hackfleisch', 'hackfleisch|\\bhack\\b|faschiert'),
  e('Speck', '\\bspeck|bacon|pancetta'),
  e('Schinken', 'schinken'),
  e('Salami', 'salami'),
  e('Wurst', 'wurst|chorizo|wuerstchen'),
  e('Thunfisch', 'thunfisch'),
  e('Lachs', 'lachs'),
  e('Garnelen', 'garnele|shrimp|scampi'),
  e('Fisch', '\\bfisch', 'fisch'),
  // pflanzliche Proteine
  e('Tofu', 'tofu'),
  e('Tempeh', 'tempeh'),
  e('Linsen', 'linse'),
  e('Kichererbsen', 'kichererbse'),
  e('Bohnen', 'bohne|kidney'),
  e('Erbsen', '(?<!kicher)erbse'),
  e('Hummus', 'hummus'),
  // Gemüse & Obst
  e('Paprika', 'paprika(?!pulver)'),
  e('Zucchini', 'zucchin'),
  e('Aubergine', 'aubergin'),
  e('Pilze', 'pilz|champignon'),
  e('Spinat', 'spinat'),
  e('Brokkoli', 'brokkoli|broccoli'),
  e('Blumenkohl', 'blumenkohl'),
  e('Karotte', 'karott|moehre|mohrrueb'),
  e('Zwiebel', 'zwiebel|schalotte'),
  e('Knoblauch', 'knoblauch'),
  e('Tomate', 'tomat'),
  e('Gurke', 'gurke'),
  e('Mais', '\\bmais'),
  e('Avocado', 'avocado|guacamole'),
  e('Oliven', 'olive(?!noel|n oel)'),
  e('Kapern', 'kapern'),
  e('Rucola', 'rucola|rauke'),
  e('Lauch', '\\blauch'),
  e('Sellerie', 'sellerie'),
  e('Kürbis', 'kuerbis'),
  e('Süßkartoffel', 'suesskartoffel'),
  e('Kartoffel', '(?<!suess)kartoffel|pommes|kroketten|roesti'),
  e('Ingwer', 'ingwer'),
  e('Zitrone', 'zitron'),
  e('Limette', 'limett'),
  e('Kokos', 'kokos'),
  e('Ananas', 'ananas'),
  e('Apfel', '\\bapfel|aepfel'),
  e('Mango', 'mango'),
  // Kräuter & Gewürze, die nicht zur Grundausstattung gehören
  e('Basilikum', 'basilikum'),
  e('Petersilie', 'petersilie'),
  e('Koriander', 'koriander'),
  e('Schnittlauch', 'schnittlauch'),
  e('Minze', 'minze'),
  e('Kreuzkümmel', 'kreuzkuemmel|cumin'),
  e('Kurkuma', 'kurkuma'),
  e('Zimt', '\\bzimt'),
  e('Oregano', 'oregano'),
  e('Thymian', 'thymian'),
  e('Rosmarin', 'rosmarin'),
  // Nüsse & Saaten
  e('Erdnüsse', 'erdnuss'),
  e('Cashews', 'cashew'),
  e('Mandeln', 'mandel'),
  e('Walnüsse', 'walnuss'),
  e('Sesam', 'sesam|tahin'),
  // Sattmacher
  e('Reis', '(?<![pk])reis(?!e\\b|en\\b)'),
  e('Pasta', 'pasta|nudel|spaghetti|penne|fusilli|tagliatelle|makkaroni|farfalle|rigatoni|linguine'),
  e('Lasagne', 'lasagne'),
  e('Gnocchi', 'gnocchi'),
  e('Brot', '\\bbrot|fladenbrot|toastbrot|baguette|ciabatta|\\bbrotchips', 'brot|broetchen|semmel|baguette|ciabatta|toast'),
  e('Tortilla', 'tortilla|\\bwraps?\\b|wrap', 'tortilla|wrap'),
  e('Couscous', 'couscous|bulgur|quinoa'),
  e('Haferflocken', 'hafer'),
  e('Mehl', '\\bmehl'),
  // Soßen & Würzsoßen
  e('Pesto', 'pesto'),
  e('Sojasoße', '\\bsoja|sojasosse|teriyaki'),
  e('Senf', '\\bsenf'),
  e('Mayonnaise', '\\bmayo|mayonnaise|aioli'),
  e('Ketchup', 'ketchup'),
  e('Honig', 'honig'),
  e('Harissa', 'harissa'),
  e('Currypaste', 'currypaste|curry paste'),
];

/** Welche Lexikon-Zutaten nennt der Text? */
export function erwaehnteZutaten(text: string): Eintrag[] {
  const t = ` ${flach(text)} `;
  return LEXIKON.filter((x) => x.muster.test(t));
}

/** Text, der alles abdeckt, was als „drin“ gelten darf (Namen, bekannte Zusammensetzungen …). */
export function deckungstext(teile: (string | null | undefined)[]): string {
  return ` ${teile.filter(Boolean).map((x) => flach(x as string)).join(' | ')} `;
}

/** Namen der genannten Zutaten, die nicht abgedeckt sind. */
export function ungedeckt(text: string, deckung: string): string[] {
  return erwaehnteZutaten(text)
    .filter((x) => !x.deckung.test(deckung))
    .map((x) => x.name);
}

// ───────── Behauptungen, die die KI nicht machen darf ─────────

const PREIS = /\d+(?:[.,]\d+)?\s*(?:€|euro\b|eur\b|cent\b|ct\b)|€|\beuro\b|\bcent\b/i;
const DIAET = /\b(vegan\w*|vegetarisch\w*|glutenfrei\w*|laktosefrei\w*|bio)\b/i;
const HAUSGEMACHT = /\b(hausgemacht\w*|selbstgemacht\w*|selbst gemacht\w*|selbstgekocht\w*)\b/i;

export type Regeln = {
  /** Darf „hausgemacht“ gesagt werden? (nur wenn eine verwendete Sorte als selbstgemacht bekannt ist) */
  hausgemacht_erlaubt: boolean;
};

function verboteneBehauptung(satz: string, r: Regeln): string | null {
  if (PREIS.test(satz)) return 'Preisangabe';
  if (DIAET.test(satz)) return 'Diät-Behauptung';
  if (!r.hausgemacht_erlaubt && HAUSGEMACHT.test(satz)) return '„hausgemacht“ ohne Grundlage';
  return null;
}

export function saetze(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type Bereinigt = { text: string; entfernt: string[] };

/**
 * Entfernt Sätze mit erfundenen Zutaten oder verbotenen Behauptungen.
 * Liefert den Rest und die Gründe (für Tests und „verworfen“-Hinweise).
 */
export function bereinigeText(text: string, deckung: string, r: Regeln): Bereinigt {
  const entfernt: string[] = [];
  const bleibt = saetze(text).filter((s) => {
    const verbot = verboteneBehauptung(s, r);
    if (verbot) {
      entfernt.push(verbot);
      return false;
    }
    const fremd = ungedeckt(s, deckung);
    if (fremd.length) {
      entfernt.push(`nennt ${fremd.join(', ')}`);
      return false;
    }
    return true;
  });
  return { text: bleibt.join(' '), entfernt };
}

/**
 * Prüft einen Gerichtsnamen. Diät-/Hausgemacht-Wörter und Preise werden gestrichen;
 * nennt der Name Zutaten, die nicht drin sind, ist er unbrauchbar (→ Gericht verwerfen).
 */
export function pruefeName(name: string, deckung: string, r: Regeln): { name: string } | { fehler: string } {
  let n = name.replace(DIAET, ' ');
  if (!r.hausgemacht_erlaubt) n = n.replace(HAUSGEMACHT, ' ');
  n = n
    .replace(/\s*\(?\d+(?:[.,]\d+)?\s*(?:€|euro|eur|cent|ct)\)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–,:]+|[\s\-–,:]+$/g, '')
    .trim();
  if (n.length < 3) return { fehler: 'Name ohne Inhalt' };
  n = n.charAt(0).toUpperCase() + n.slice(1);
  const fremd = ungedeckt(n, deckung);
  if (fremd.length) return { fehler: `Name nennt ${fremd.join(', ')} – ist aber nicht drin` };
  return { name: n };
}

// ───────── Namensqualität ─────────

/**
 * 1 = kurzer, natürlicher Name; weniger für mechanische Namen wie
 * „Linsen-Tomaten-Gemüse-Wrap“, „Linsen gekocht mit TK-Gemüsemix“ oder sehr lange Namen.
 */
export function namensQualitaet(name: string, bestandsnamen: string[]): number {
  let q = 1;
  const segmente = name.split(/\s+/).map((w) => w.split('-').length);
  if (Math.max(...segmente) >= 4) q -= 0.5;
  else if (Math.max(...segmente) === 3) q -= 0.25;
  const n = flach(name);
  const woertlich = bestandsnamen.filter((b) => {
    const f = flach(b);
    return f.includes(' ') && n.includes(f); // mehrteilige Sortennamen wörtlich übernommen
  }).length;
  q -= 0.25 * woertlich;
  if (/^tk\b/.test(n) || /\btk\b/.test(n)) q -= 0.2;
  if (name.length > 42) q -= 0.25;
  if ((name.match(/\b(mit|und)\b/g) ?? []).length >= 3) q -= 0.25;
  return Math.max(0, Math.round(q * 100) / 100);
}
