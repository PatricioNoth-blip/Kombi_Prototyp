// Semantische Zutatenebene: GEKAUFTES PRODUKT → SEMANTISCHE ZUTAT → VERWENDUNGSMÖGLICHKEITEN.
//
// Die Sorte in der Datenbank ist das konkrete Produkt („REWE Strauchtomaten 500 g“, mit Preis,
// Menge, Lagerort). Was dieses Produkt als Lebensmittel IST („Tomate“: Gemüse, frisch, roh und
// gekocht verwendbar, passt in Soße, Salat, Pasta …), steht hier – getrennt und deterministisch.
//
// Regeln:
//   • Erkannt wird nur, was eindeutig im Katalog steht. Unbekanntes bleibt unbekannt (null) –
//     es wird nichts geraten.
//   • Spezielles vor Allgemeinem: „Tomatensoße“ ist keine rohe Tomate, „gehackte Tomaten (Dose)“
//     sind Dosentomaten.
//   • Die Zutatenebene liefert nur Bedeutung. Mengen, Preise und Nährwerte kommen weiterhin
//     ausschließlich aus den Daten der Sorte.
import type { Gerichtstyp } from './typen.ts';
import { normalisiere } from './text.ts';

export type ZutatKategorie =
  | 'gemuese' | 'obst' | 'kraeuter' | 'huelsenfruechte' | 'getreide' | 'backwaren' | 'milchprodukte' | 'eier'
  | 'pflanzenprotein' | 'fleisch' | 'fisch' | 'nuesse' | 'sossen' | 'gewuerze';

/** Wie sich das Lebensmittel verwenden lässt (Allgemeinwissen, keine Mengen). */
export type Zubereitung = 'roh' | 'gekocht' | 'gebraten' | 'gebacken';
export type ZutatEigenschaft = 'frisch' | 'haltbar' | 'kuehlen' | 'sattmacher' | 'protein' | 'wuerzt';

export type Zutat = {
  id: string;
  name: string;
  /** englischer Begriff – nur für Bildsuche und Bildbeschreibung */
  en: string;
  kategorie: ZutatKategorie;
  eigenschaften: ZutatEigenschaft[];
  zubereitung: Zubereitung[];
  /** typische Verwendung: Gerichtstypen plus „sosse“ */
  verwendung: (Gerichtstyp | 'sosse')[];
};

type Eintrag = Zutat & { muster: RegExp };

const z = (
  id: string, name: string, en: string, kategorie: ZutatKategorie, muster: string,
  eigenschaften: ZutatEigenschaft[], zubereitung: Zubereitung[], verwendung: (Gerichtstyp | 'sosse')[],
): Eintrag => ({ id, name, en, kategorie, eigenschaften, zubereitung, verwendung, muster: new RegExp(muster) });

const FRISCH: ZutatEigenschaft[] = ['frisch', 'kuehlen'];
const ROH_GEKOCHT: Zubereitung[] = ['roh', 'gekocht', 'gebraten', 'gebacken'];
const GEKOCHT: Zubereitung[] = ['gekocht', 'gebraten', 'gebacken'];

/**
 * Katalog – Reihenfolge zählt: Spezielles zuerst. Muster laufen auf normalisiere()-Text
 * (Kleinbuchstaben, Umlaute ausgeschrieben, nur a–z/0–9 und Leerzeichen).
 */
const KATALOG: Eintrag[] = [
  // Soßen & Zubereitetes aus Tomaten – vor „Tomate“
  z('tomatensosse', 'Tomatensoße', 'tomato sauce', 'sossen', 'tomat\\w*\\s?(sosse|sauce|basis|sugo)|passata|passierte tomate|\\bsugo\\b|bolognese',
    ['haltbar'], ['gekocht'], ['sosse', 'pasta', 'pizza', 'auflauf', 'suppe', 'eintopf']),
  z('dosentomaten', 'Dosentomaten', 'canned tomatoes', 'sossen', 'gehackte tomate|stueckige tomate|tomaten (in der )?dose|dosentomate|geschaelte tomate',
    ['haltbar'], ['gekocht'], ['sosse', 'pasta', 'curry', 'eintopf', 'suppe', 'auflauf']),
  z('tomatenmark', 'Tomatenmark', 'tomato paste', 'sossen', 'tomatenmark', ['haltbar', 'wuerzt'], ['gekocht'], ['sosse', 'eintopf', 'curry']),
  z('pesto', 'Pesto', 'pesto', 'sossen', '\\bpesto', ['wuerzt'], ['roh'], ['pasta', 'toast', 'bowl']),
  z('kokosmilch', 'Kokosmilch', 'coconut milk', 'sossen', 'kokosmilch|kokosnussmilch', ['haltbar'], ['gekocht'], ['curry', 'suppe', 'sosse']),
  z('currypaste', 'Currypaste', 'curry paste', 'sossen', 'currypaste|curry paste', ['haltbar', 'wuerzt'], ['gekocht'], ['curry', 'suppe']),
  z('sojasosse', 'Sojasoße', 'soy sauce', 'sossen', 'soja\\w*\\s?(sosse|sauce)|\\bshoyu|tamari', ['haltbar', 'wuerzt'], ['roh', 'gekocht'], ['pfanne', 'bowl', 'reisgericht']),
  z('hummus', 'Hummus', 'hummus', 'sossen', '\\bhummus', ['kuehlen', 'protein'], ['roh'], ['wrap', 'bowl', 'snack', 'toast']),
  // Gemüse
  z('tomate', 'Tomate', 'tomato', 'gemuese', 'tomate|tomaten', FRISCH, ROH_GEKOCHT, ['sosse', 'salat', 'pasta', 'bowl', 'curry', 'pizza']),
  z('gurke', 'Gurke', 'cucumber', 'gemuese', 'gurke', FRISCH, ['roh'], ['salat', 'bowl', 'wrap', 'snack']),
  z('paprika', 'Paprika', 'bell pepper', 'gemuese', 'paprika(?!pulver)|spitzpaprika', FRISCH, ROH_GEKOCHT, ['pfanne', 'salat', 'wrap', 'curry', 'bowl']),
  z('zwiebel', 'Zwiebel', 'onion', 'gemuese', 'zwiebel|schalotte', ['frisch'], ROH_GEKOCHT, ['sosse', 'pfanne', 'suppe', 'curry', 'eintopf']),
  z('knoblauch', 'Knoblauch', 'garlic', 'gemuese', 'knoblauch', ['frisch', 'wuerzt'], ROH_GEKOCHT, ['sosse', 'pfanne', 'curry', 'pasta']),
  z('karotte', 'Karotte', 'carrot', 'gemuese', 'karott|moehre|mohrrueb', FRISCH, ROH_GEKOCHT, ['suppe', 'eintopf', 'salat', 'pfanne', 'curry']),
  z('suesskartoffel', 'Süßkartoffel', 'sweet potato', 'gemuese', 'suesskartoffel', ['frisch', 'sattmacher'], GEKOCHT, ['curry', 'bowl', 'suppe', 'auflauf']),
  z('kartoffel', 'Kartoffel', 'potato', 'gemuese', '(?<!suess)kartoffel', ['frisch', 'sattmacher'], GEKOCHT, ['pfanne', 'suppe', 'auflauf', 'eintopf', 'salat']),
  z('spinat', 'Spinat', 'spinach', 'gemuese', 'spinat', FRISCH, ROH_GEKOCHT, ['curry', 'pasta', 'auflauf', 'salat', 'suppe']),
  z('brokkoli', 'Brokkoli', 'broccoli', 'gemuese', 'brokkoli|broccoli', FRISCH, GEKOCHT, ['pfanne', 'auflauf', 'bowl', 'curry', 'pasta']),
  z('blumenkohl', 'Blumenkohl', 'cauliflower', 'gemuese', 'blumenkohl', FRISCH, GEKOCHT, ['curry', 'auflauf', 'suppe', 'pfanne']),
  z('zucchini', 'Zucchini', 'zucchini', 'gemuese', 'zucchin', FRISCH, ROH_GEKOCHT, ['pfanne', 'pasta', 'auflauf', 'bowl']),
  z('aubergine', 'Aubergine', 'eggplant', 'gemuese', 'aubergin', FRISCH, GEKOCHT, ['pfanne', 'auflauf', 'curry']),
  z('pilze', 'Pilze', 'mushrooms', 'gemuese', 'pilz|champignon|kraeuterseitling', FRISCH, GEKOCHT, ['pfanne', 'pasta', 'auflauf', 'reisgericht']),
  z('mais', 'Mais', 'corn', 'gemuese', '\\bmais\\b|maiskoerner', ['haltbar'], ROH_GEKOCHT, ['salat', 'wrap', 'bowl', 'pfanne']),
  z('erbsen', 'Erbsen', 'peas', 'gemuese', '(?<!kicher)erbse', ['haltbar'], GEKOCHT, ['reisgericht', 'pasta', 'curry', 'suppe']),
  z('lauch', 'Lauch', 'leek', 'gemuese', '\\blauch|porree|fruehlingszwiebel', FRISCH, GEKOCHT, ['suppe', 'pfanne', 'auflauf']),
  z('kuerbis', 'Kürbis', 'pumpkin', 'gemuese', 'kuerbis|hokkaido', ['frisch'], GEKOCHT, ['suppe', 'curry', 'auflauf']),
  z('salat', 'Blattsalat', 'lettuce', 'gemuese', 'eisberg|kopfsalat|romana|feldsalat|blattsalat|salatherz|\\bsalat\\b', FRISCH, ['roh'], ['salat', 'wrap', 'burger']),
  z('rucola', 'Rucola', 'arugula', 'gemuese', 'rucola|rauke', FRISCH, ['roh'], ['salat', 'pizza', 'pasta']),
  z('kohl', 'Kohl', 'cabbage', 'gemuese', 'kohl(?!rabi)|wirsing|rotkohl|weisskohl', ['frisch'], ROH_GEKOCHT, ['eintopf', 'salat', 'pfanne']),
  z('avocado', 'Avocado', 'avocado', 'gemuese', 'avocado', FRISCH, ['roh'], ['wrap', 'bowl', 'salat', 'toast']),
  z('ingwer', 'Ingwer', 'ginger', 'gemuese', 'ingwer', ['frisch', 'wuerzt'], ROH_GEKOCHT, ['curry', 'pfanne', 'suppe']),
  z('gemuesemix', 'Gemüsemischung', 'mixed vegetables', 'gemuese', 'gemuesemix|gemuesemischung|gemuese mix|pfannengemuese|ofengemuese', ['haltbar'], GEKOCHT, ['pfanne', 'curry', 'reisgericht', 'auflauf']),
  // Obst
  z('apfel', 'Apfel', 'apple', 'obst', '\\bapfel|aepfel', ['frisch'], ['roh', 'gebacken'], ['snack', 'salat']),
  z('banane', 'Banane', 'banana', 'obst', 'banane', ['frisch'], ['roh'], ['snack']),
  z('zitrone', 'Zitrone', 'lemon', 'obst', 'zitrone', ['frisch', 'wuerzt'], ['roh'], ['salat', 'bowl', 'sosse']),
  z('limette', 'Limette', 'lime', 'obst', 'limette', ['frisch', 'wuerzt'], ['roh'], ['curry', 'bowl', 'salat']),
  z('beeren', 'Beeren', 'berries', 'obst', 'beere', FRISCH, ['roh'], ['snack']),
  z('mango', 'Mango', 'mango', 'obst', 'mango', ['frisch'], ['roh'], ['bowl', 'salat', 'curry']),
  // Kräuter
  z('basilikum', 'Basilikum', 'basil', 'kraeuter', 'basilikum', FRISCH, ['roh'], ['pasta', 'pizza', 'salat']),
  z('petersilie', 'Petersilie', 'parsley', 'kraeuter', 'petersilie', FRISCH, ['roh'], ['salat', 'bowl', 'suppe']),
  z('koriander', 'Koriander', 'coriander', 'kraeuter', 'koriander', FRISCH, ['roh'], ['curry', 'bowl', 'wrap']),
  z('minze', 'Minze', 'mint', 'kraeuter', 'minze', FRISCH, ['roh'], ['salat', 'bowl']),
  z('schnittlauch', 'Schnittlauch', 'chives', 'kraeuter', 'schnittlauch', FRISCH, ['roh'], ['salat', 'toast', 'suppe']),
  // Hülsenfrüchte & pflanzliche Proteine
  z('linsen', 'Linsen', 'lentils', 'huelsenfruechte', 'linse', ['haltbar', 'protein'], GEKOCHT, ['curry', 'suppe', 'eintopf', 'salat', 'bowl']),
  z('kichererbsen', 'Kichererbsen', 'chickpeas', 'huelsenfruechte', 'kichererbse', ['haltbar', 'protein'], GEKOCHT, ['curry', 'salat', 'bowl', 'wrap']),
  z('bohnen', 'Bohnen', 'beans', 'huelsenfruechte', 'bohne|kidney', ['haltbar', 'protein'], GEKOCHT, ['eintopf', 'wrap', 'salat', 'bowl']),
  z('tofu', 'Tofu', 'tofu', 'pflanzenprotein', 'tofu', ['kuehlen', 'protein'], GEKOCHT, ['pfanne', 'curry', 'bowl', 'wrap']),
  z('seitan', 'Seitan', 'seitan', 'pflanzenprotein', 'seitan', ['kuehlen', 'protein'], GEKOCHT, ['pfanne', 'wrap', 'burger', 'bowl']),
  z('tempeh', 'Tempeh', 'tempeh', 'pflanzenprotein', 'tempeh', ['kuehlen', 'protein'], GEKOCHT, ['pfanne', 'bowl']),
  z('falafel', 'Falafel', 'falafel', 'pflanzenprotein', 'falafel', ['protein'], ['gebraten', 'gebacken'], ['wrap', 'bowl', 'salat', 'burger']),
  // Getreide & Sattmacher
  z('pasta', 'Pasta', 'pasta', 'getreide', 'pasta|nudel|spaghetti|penne|fusilli|tagliatelle|makkaroni|farfalle|rigatoni|linguine', ['haltbar', 'sattmacher'], ['gekocht'], ['pasta', 'auflauf', 'salat']),
  z('reis', 'Reis', 'rice', 'getreide', '(?<![pk])reis(?!e\\b|en\\b)|basmati|jasmin', ['haltbar', 'sattmacher'], ['gekocht'], ['reisgericht', 'curry', 'bowl', 'pfanne']),
  z('couscous', 'Couscous', 'couscous', 'getreide', 'couscous', ['haltbar', 'sattmacher'], ['gekocht'], ['bowl', 'salat']),
  z('bulgur', 'Bulgur', 'bulgur', 'getreide', 'bulgur', ['haltbar', 'sattmacher'], ['gekocht'], ['bowl', 'salat']),
  z('quinoa', 'Quinoa', 'quinoa', 'getreide', 'quinoa', ['haltbar', 'sattmacher'], ['gekocht'], ['bowl', 'salat']),
  z('haferflocken', 'Haferflocken', 'oats', 'getreide', 'haferflocken|\\bhafer\\b|porridge|muesli', ['haltbar', 'sattmacher'], ['roh', 'gekocht', 'gebacken'], ['snack']),
  z('mehl', 'Mehl', 'flour', 'getreide', '\\bmehl', ['haltbar'], ['gebacken'], []),
  // Backwaren
  z('wraps', 'Wraps', 'tortilla wraps', 'backwaren', '\\bwraps?\\b|tortilla', ['haltbar', 'sattmacher'], ['roh', 'gebraten'], ['wrap']),
  z('toast', 'Toastbrot', 'toast bread', 'backwaren', 'toastbrot|\\btoast\\b|sandwichbrot', ['haltbar', 'sattmacher'], ['gebacken'], ['toast']),
  z('broetchen', 'Brötchen', 'bread rolls', 'backwaren', 'broetchen|semmel|aufbackbroetchen|baguettebroetchen', ['sattmacher'], ['gebacken'], ['burger', 'toast', 'suppe']),
  z('brot', 'Brot', 'bread', 'backwaren', 'brot|baguette|ciabatta|pita', ['sattmacher'], ['roh', 'gebacken'], ['toast', 'suppe', 'salat']),
  // Milchprodukte & Ei
  z('joghurt', 'Joghurt', 'yogurt', 'milchprodukte', 'joghurt|jogurt|skyr', FRISCH, ['roh'], ['bowl', 'sosse', 'curry', 'snack']),
  z('quark', 'Quark', 'quark', 'milchprodukte', '\\bquark', FRISCH, ['roh'], ['sosse', 'snack']),
  z('frischkaese', 'Frischkäse', 'cream cheese', 'milchprodukte', 'frischkaese', FRISCH, ['roh'], ['toast', 'wrap', 'pasta', 'sosse']),
  z('mozzarella', 'Mozzarella', 'mozzarella', 'milchprodukte', 'mozzarell', FRISCH, ['roh', 'gebacken'], ['pizza', 'salat', 'auflauf']),
  z('feta', 'Feta', 'feta cheese', 'milchprodukte', '\\bfeta|hirtenkaese|schafskaese', FRISCH, ['roh', 'gebacken'], ['salat', 'bowl', 'auflauf']),
  z('kaese', 'Käse', 'cheese', 'milchprodukte', 'kaese|gouda|cheddar|emmentaler|parmesan|pecorino|bergkaese', ['kuehlen'], ['roh', 'gebacken'], ['auflauf', 'pasta', 'toast', 'pizza']),
  z('sahne', 'Sahne', 'cream', 'milchprodukte', 'sahne|creme fraiche|schmand', FRISCH, ['gekocht'], ['sosse', 'pasta', 'suppe', 'auflauf']),
  z('milch', 'Milch', 'milk', 'milchprodukte', '(?<!kokos)(?<!kokosnuss)milch', FRISCH, ['roh', 'gekocht'], ['sosse', 'snack']),
  z('butter', 'Butter', 'butter', 'milchprodukte', '(?<!erdnuss)butter', ['kuehlen'], ['roh', 'gebraten'], ['toast', 'sosse']),
  z('eier', 'Eier', 'eggs', 'eier', '\\beier?\\b', ['kuehlen', 'protein'], GEKOCHT, ['pfanne', 'toast', 'salat', 'auflauf']),
  // Fleisch & Fisch
  z('haehnchen', 'Hähnchen', 'chicken', 'fleisch', 'haehnchen|huhn|gefluegel|pute', ['kuehlen', 'protein'], GEKOCHT, ['pfanne', 'curry', 'wrap', 'bowl']),
  z('hackfleisch', 'Hackfleisch', 'minced meat', 'fleisch', 'hackfleisch|\\bhack\\b|faschiert', ['kuehlen', 'protein'], GEKOCHT, ['sosse', 'pasta', 'eintopf', 'burger']),
  z('speck', 'Speck', 'bacon', 'fleisch', '\\bspeck|bacon|pancetta', ['kuehlen'], ['gebraten'], ['pasta', 'pfanne']),
  z('wurst', 'Wurst', 'sausage', 'fleisch', 'wurst|wuerstchen|chorizo|salami', ['kuehlen'], ['roh', 'gebraten'], ['toast', 'pfanne']),
  z('lachs', 'Lachs', 'salmon', 'fisch', 'lachs', ['kuehlen', 'protein'], GEKOCHT, ['pasta', 'bowl', 'reisgericht']),
  z('thunfisch', 'Thunfisch', 'tuna', 'fisch', 'thunfisch', ['haltbar', 'protein'], ['roh'], ['salat', 'pasta', 'toast']),
  // Nüsse & Saaten
  z('nuesse', 'Nüsse', 'nuts', 'nuesse', 'nuss|nuesse|cashew|mandel|erdnuss|walnuss|haselnuss', ['haltbar'], ['roh', 'gebraten'], ['salat', 'bowl', 'snack', 'curry']),
  z('saaten', 'Saaten', 'seeds', 'nuesse', 'sesam|kerne|saaten|leinsamen|chiasamen', ['haltbar'], ['roh', 'gebraten'], ['salat', 'bowl']),
];

const OHNE_MARKE = new RegExp(
  '\\b(rewe|edeka|aldi|lidl|penny|netto|kaufland|real|globus|dm|rossmann|alnatura|ja|gut guenstig|beste wahl|k classic|milsani|' +
    'bio|oeko|demeter|regional|premium|feine welt|natur|original|klassik|classic|familienpackung|vorteilspack|xxl|' +
    'strauch|rispen|cherry|cocktail|kirsch|mini|extra|fein|grob|griechisch\\w*|griech|art|nach|packung|pckg|beutel|glas|becher|netz|schale|bund|stk|stueck)\\b',
  'g',
);
const MENGEN = /\b\d+(?:[ ,.]\d+)?\s*(?:x\s*)?(?:kg|g|gr|mg|l|ml|cl|stk|st|stueck|prozent|%)?\b/g;

/** „REWE Bio Strauchtomaten 500 g“ → „tomaten“: Marke, Größe und Beiwörter weg, Kern bleibt. */
export function produktKern(produktName: string): string {
  return normalisiere(produktName).replace(MENGEN, ' ').replace(OHNE_MARKE, ' ').replace(/\s+/g, ' ').trim();
}

const OHNE_MUSTER = ({ muster: _m, ...rest }: Eintrag): Zutat => rest;

/**
 * Welche semantische Zutat ist dieses Produkt? null = nicht eindeutig bekannt (wird nie geraten).
 * Zusammengesetzte Namen („Kichererbsen-Curry“) werden als ihr erster, spezifischster Treffer erkannt –
 * die Verwendung steht dann in der Sorte selbst (Art, Rolle), nicht hier.
 */
export function erkenneZutat(produktName: string): Zutat | null {
  const kern = produktKern(produktName);
  if (!kern) return null;
  const e = KATALOG.find((x) => x.muster.test(kern));
  return e ? OHNE_MUSTER(e) : null;
}

/** Eine Zutat über ihre id (z. B. aus der Spalte block_typ.zutat, die den Automatismus überschreibt). */
export function zutatMitId(id: string | null | undefined): Zutat | null {
  if (!id) return null;
  const e = KATALOG.find((x) => x.id === id);
  return e ? OHNE_MUSTER(e) : null;
}

/** Hinterlegte Zuordnung vor automatischer Erkennung. */
export function zutatFuer(produktName: string, hinterlegt?: string | null): Zutat | null {
  return zutatMitId(hinterlegt) ?? erkenneZutat(produktName);
}

export const ALLE_ZUTATEN: readonly Zutat[] = KATALOG.map(OHNE_MUSTER);

export const KATEGORIE_NAME: Record<ZutatKategorie, string> = {
  gemuese: 'Gemüse', obst: 'Obst', kraeuter: 'Kräuter', huelsenfruechte: 'Hülsenfrüchte', getreide: 'Getreide & Beilagen',
  backwaren: 'Backwaren', milchprodukte: 'Milchprodukte', eier: 'Eier', pflanzenprotein: 'Pflanzliches Protein',
  fleisch: 'Fleisch', fisch: 'Fisch', nuesse: 'Nüsse & Saaten', sossen: 'Soßen & Pasten', gewuerze: 'Gewürze',
};

/** Symbol je Kategorie – für das lokale Bild, wenn der Name selbst keins hergibt. */
export const KATEGORIE_EMOJI: Record<ZutatKategorie, string> = {
  gemuese: '🥦', obst: '🍎', kraeuter: '🌿', huelsenfruechte: '🫘', getreide: '🌾', backwaren: '🥖', milchprodukte: '🧀',
  eier: '🥚', pflanzenprotein: '🧆', fleisch: '🍗', fisch: '🐟', nuesse: '🥜', sossen: '🥫', gewuerze: '🧂',
};

// ───────── Englische Begriffe (Bildsuche, Bildprüfung) ─────────

/**
 * Englische Lebensmittelwörter → semantische Zutat. Damit lässt sich prüfen, ob eine englische
 * Bildanfrage der KI oder die Beschreibung eines gefundenen Fotos etwas zeigt, das gar nicht im
 * Gericht steckt (z. B. „steak“ bei einer Tomaten-Gurken-Bowl).
 */
const EN_WOERTER: [RegExp, string][] = [
  [/\btomato sauce|marinara|passata|bolognese\b/, 'tomatensosse'],
  [/\bcanned tomato/, 'dosentomaten'],
  [/\btomato paste\b/, 'tomatenmark'],
  [/\bpesto\b/, 'pesto'],
  [/\bcoconut milk\b/, 'kokosmilch'],
  [/\bsoy sauce\b/, 'sojasosse'],
  [/\bhummus\b/, 'hummus'],
  [/\btomato(es)?\b/, 'tomate'],
  [/\bcucumbers?\b/, 'gurke'],
  [/\b(bell )?peppers?\b|\bcapsicum\b/, 'paprika'],
  [/\bonions?\b|\bshallots?\b/, 'zwiebel'],
  [/\bgarlic\b/, 'knoblauch'],
  [/\bcarrots?\b/, 'karotte'],
  [/\bsweet potato(es)?\b/, 'suesskartoffel'],
  [/\b(?<!sweet )potato(es)?\b|\bfries\b/, 'kartoffel'],
  [/\bspinach\b/, 'spinat'],
  [/\bbroccoli\b/, 'brokkoli'],
  [/\bcauliflower\b/, 'blumenkohl'],
  [/\bzucchini\b|\bcourgettes?\b/, 'zucchini'],
  [/\beggplants?\b|\baubergines?\b/, 'aubergine'],
  [/\bmushrooms?\b/, 'pilze'],
  [/\bcorn\b|\bsweetcorn\b/, 'mais'],
  [/\bpeas\b/, 'erbsen'],
  [/\bleeks?\b|\bscallions?\b/, 'lauch'],
  [/\bpumpkin\b|\bsquash\b/, 'kuerbis'],
  [/\blettuce\b/, 'salat'],
  [/\barugula\b|\brocket\b/, 'rucola'],
  [/\bcabbage\b|\bkale\b/, 'kohl'],
  [/\bavocados?\b|\bguacamole\b/, 'avocado'],
  [/\bginger\b/, 'ingwer'],
  [/\bapples?\b/, 'apfel'],
  [/\bbananas?\b/, 'banane'],
  [/\blemons?\b/, 'zitrone'],
  [/\blimes?\b/, 'limette'],
  [/\bberr(y|ies)\b/, 'beeren'],
  [/\bmangos?\b|\bmangoes\b/, 'mango'],
  [/\bbasil\b/, 'basilikum'],
  [/\bparsley\b/, 'petersilie'],
  [/\bcoriander\b|\bcilantro\b/, 'koriander'],
  [/\bmint\b/, 'minze'],
  [/\bchives\b/, 'schnittlauch'],
  [/\blentils?\b|\bdal\b|\bdhal\b/, 'linsen'],
  [/\bchickpeas?\b|\bgarbanzo/, 'kichererbsen'],
  [/\bbeans?\b/, 'bohnen'],
  [/\btofu\b/, 'tofu'],
  [/\bseitan\b/, 'seitan'],
  [/\btempeh\b/, 'tempeh'],
  [/\bfalafel\b/, 'falafel'],
  [/\brice\b|\brisotto\b/, 'reis'],
  [/\bpasta\b|\bspaghetti\b|\bnoodles?\b|\bpenne\b|\bfusilli\b|\btagliatelle\b|\blasagn[ae]\b/, 'pasta'],
  [/\bcouscous\b/, 'couscous'],
  [/\bbulgur\b/, 'bulgur'],
  [/\bquinoa\b/, 'quinoa'],
  [/\boats\b|\boatmeal\b|\bporridge\b/, 'haferflocken'],
  [/\btortillas?\b|\bwraps?\b|\bburritos?\b/, 'wraps'],
  [/\btoast\b|\bsandwich(es)?\b/, 'toast'],
  [/\bbread rolls?\b|\bbuns?\b/, 'broetchen'],
  [/\bbread\b|\bbaguette\b|\bpita\b|\bflatbread\b/, 'brot'],
  [/\byogh?urt\b|\btzatziki\b|\braita\b/, 'joghurt'],
  [/\bcream cheese\b/, 'frischkaese'],
  [/\bmozzarella\b/, 'mozzarella'],
  [/\bfeta\b/, 'feta'],
  [/\b(?<!cream )cheese\b|\bparmesan\b|\bcheddar\b|\bgouda\b/, 'kaese'],
  [/\bcream\b/, 'sahne'],
  [/\bmilk\b/, 'milch'],
  [/\bbutter\b/, 'butter'],
  [/\beggs?\b|\bomelett?e\b/, 'eier'],
  [/\bchicken\b|\bturkey\b|\bpoultry\b/, 'haehnchen'],
  [/\bminced meat\b|\bground (beef|meat)\b|\bmeatballs?\b|\bmeat\b|\bbeef\b|\bsteak\b|\bpork\b|\blamb\b|\bham\b/, 'hackfleisch'],
  [/\bbacon\b|\bpancetta\b/, 'speck'],
  [/\bsausages?\b|\bsalami\b|\bchorizo\b|\bpepperoni\b|\bhot dogs?\b/, 'wurst'],
  [/\bsalmon\b/, 'lachs'],
  [/\btuna\b/, 'thunfisch'],
  [/\bfish\b/, 'thunfisch'],
  // nicht im Katalog → gilt nie als „im Gericht“, ein solches Bild passt also nie
  [/\bshrimps?\b|\bprawns?\b|\bseafood\b|\bsushi\b|\bmussels?\b|\bsquid\b/, 'meeresfruechte'],
  [/\bnuts?\b|\bcashews?\b|\balmonds?\b|\bpeanuts?\b|\bwalnuts?\b/, 'nuesse'],
  [/\bsesame\b|\bseeds\b/, 'saaten'],
];

/** Welche semantischen Zutaten nennt ein englischer Text? (Kleinbuchstaben, nur Wörter) */
export function englischeZutaten(text: string): string[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  return [...new Set(EN_WOERTER.filter(([re]) => re.test(t)).map(([, id]) => id))];
}

/**
 * Welche Zutaten-ids „deckt“ ein Gericht ab? Aus den Namen der verwendeten Sorten, ihrer
 * bekannten Zusammensetzung und dem, was ehrlich als fehlend markiert ist.
 * Hinweis „Hamburger“ ≠ Hackfleisch: Gerichtstyp-Wörter (burger, wrap, sandwich) zählen über
 * den Gerichtstyp, nicht als Zutat – siehe bilder.ts.
 */
export function gedeckteZutaten(namen: (string | null | undefined)[]): Set<string> {
  const ids = new Set<string>();
  for (const n of namen) {
    if (!n) continue;
    // jeder Teil einzeln, damit „Tomaten, Zwiebeln, Knoblauch“ drei Zutaten ergibt
    for (const teil of n.split(/[,;/+&]|\bund\b|\bmit\b/i)) {
      const kern = produktKern(teil);
      for (const e of KATALOG) if (e.muster.test(kern)) ids.add(e.id);
    }
  }
  // Zubereitetes enthält seine Grundzutat: Tomatensoße/Dosentomaten/Tomatenmark decken „Tomate“ ab
  if (ids.has('tomatensosse') || ids.has('dosentomaten') || ids.has('tomatenmark')) ids.add('tomate');
  if (ids.has('mozzarella') || ids.has('feta') || ids.has('frischkaese')) ids.add('kaese');
  if (ids.has('gemuesemix')) ids.add('gemuesemix');
  return ids;
}
