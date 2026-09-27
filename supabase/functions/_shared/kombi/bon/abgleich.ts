// Bon-Artikel → Kombi-Sorte, mit nachvollziehbarem Sicherheitswert (0 … 1).
//
//   gelernt  – derselbe Bon-Text wurde früher dieser Sorte zugeordnet und übernommen → 0,97
//   name     – Ähnlichkeit von Bon-Text (mit aufgelösten Abkürzungen) und Sortenname
//   hinweis  – verständlicher Name (z. B. von der KI) – zählt höchstens als „unsicher“
//
// Gekauftes ist fast nie eine selbstgemachte Komponente: „Tomaten“ landet nicht still bei „Tomatensoße“.
// Die Zuordnung ist ein Vorschlag – unsichere und unbekannte Fälle bestätigt immer der Nutzer.
import type { Gewohnheit, Kandidat, SorteInfo, Zuordnung } from './typen.ts';
import { normalisiere } from '../text.ts';
import { produktSchluessel } from '../einkaufsliste.ts';

export const SICHER_AB = 0.85;
export const UNSICHER_AB = 0.55;
/** Liegen zwei Kandidaten so nah beieinander, wird gefragt („Tomaten frisch oder gehackt?“). */
const ABSTAND = 0.08;
const GELERNT = 0.97;
const HINWEIS_MAX = 0.84;

/** Typische Kürzel auf Kassenbons (normalisiert, ohne Umlaute). */
const KUERZEL: Record<string, string> = {
  natjog: 'naturjoghurt', natjogh: 'naturjoghurt', naturjog: 'naturjoghurt', jog: 'joghurt', joghu: 'joghurt', jogh: 'joghurt',
  tom: 'tomaten', toma: 'tomaten', tomat: 'tomaten', geh: 'gehackt', gehack: 'gehackt', pass: 'passata',
  kidn: 'kidney', kidneyb: 'kidneybohnen', bohn: 'bohnen', kichererb: 'kichererbsen', kichere: 'kichererbsen', kicher: 'kichererbsen',
  vollk: 'vollkorn', vk: 'vollkorn', vollkornbr: 'vollkornbrot', zwieb: 'zwiebeln', zwiebel: 'zwiebeln', knobl: 'knoblauch', knobi: 'knoblauch',
  kart: 'kartoffeln', kartoff: 'kartoffeln', kartof: 'kartoffeln', paprik: 'paprika', papr: 'paprika', zucch: 'zucchini', zucc: 'zucchini',
  aub: 'aubergine', champ: 'champignons', champi: 'champignons', brokk: 'brokkoli', brok: 'brokkoli', spin: 'spinat', karot: 'karotten',
  moehr: 'moehren', mozz: 'mozzarella', mozza: 'mozzarella', emment: 'emmentaler', reibek: 'reibekaese', parmes: 'parmesan', kaes: 'kaese',
  gouda: 'gouda', hmilch: 'milch', vollm: 'vollmilch', haferdr: 'haferdrink', haferd: 'haferdrink', sojadr: 'sojadrink', spag: 'spaghetti',
  spagh: 'spaghetti', spaghet: 'spaghetti', nud: 'nudeln', nudel: 'nudeln', weizenm: 'weizenmehl', mehl405: 'mehl', lins: 'linsen',
  rotlins: 'rote linsen', erbs: 'erbsen', gemuesem: 'gemuesemix', gem: 'gemuese', broet: 'broetchen',
  toastbr: 'toastbrot', butt: 'butter', sahn: 'sahne', schlagsa: 'schlagsahne', quar: 'quark', schoko: 'schokolade', schok: 'schokolade',
  apf: 'aepfel', banan: 'bananen', zitr: 'zitronen', ingw: 'ingwer', kokosm: 'kokosmilch', tomatenm: 'tomatenmark', tomm: 'tomatenmark',
  hackfl: 'hackfleisch', haehnch: 'haehnchen', haehn: 'haehnchen', tofun: 'tofu', reiswaff: 'reiswaffeln',
};

/** Wörter ohne Aussage über das Produkt (Marken, Qualitätsstufen, Verpackung). */
const FUELLWOERTER = new Set([
  'bio', 'ja', 'gut', 'guenstig', 'k', 'classic', 'rewe', 'beste', 'wahl', 'milbona', 'freeway', 'crownfield', 'combino',
  'alnatura', 'edeka', 'gutbio', 'nur', 'natur', 'pur', 'tk', 'st', 'stk', 'stueck', 'x', 'kg', 'g', 'gr', 'l', 'ltr', 'ml', 'cl', 'eur',
  'packung', 'pckg', 'pack', 'btl', 'beutel', 'glas', 'dose', 'ds', 'fl', 'flasche', 'becher', 'bech', 'schale', 'netz', 'lose',
  'fair', 'regional', 'aktion', 'neu', 'je', 'ca', 'fett', 'fettstufe', 'hkl', 'kl', 'klasse', 'a', 'b', 'i', 'ii', 'de',
]);

/** Bon-Text → Schlüssel zum Wiedererkennen (mit Größenangabe, ohne Artikelnummer). */
export function bonSchluessel(text: string): string {
  return normalisiere(text.replace(/^\d{4,}\s+/, '')).slice(0, 120) || '?';
}

/** Bon-Text → aussagekräftige Wörter: Größen und Füllwörter weg, Kürzel aufgelöst. */
export function bonWoerter(text: string): string[] {
  const n = normalisiere(
    text
      .replace(/\d+(?:[.,]\d+)?\s*(kg|gr|g|ltr|l|ml|cl|st|stk|er|x)\b/gi, ' ')
      .replace(/\d+(?:[.,]\d+)?\s*%/g, ' '),
  );
  return n
    .split(' ')
    .filter((w) => w && !/^\d+$/.test(w))
    .flatMap((w) => (KUERZEL[w] ?? w).split(' '))
    .filter((w) => w.length >= 2 && !FUELLWOERTER.has(w));
}

/** Wortstamm wie bei der Einkaufsliste (tomaten → tomate, zwiebeln → zwiebel). */
const stamm = (w: string) => produktSchluessel(w) || w;

function wortAehnlichkeit(a: string, b: string): number {
  if (a === b) return 1;
  const [kurz, lang] = a.length <= b.length ? [a, b] : [b, a];
  if (kurz.length < 3) return 0;
  const verhaeltnis = kurz.length / lang.length;
  if (lang.startsWith(kurz)) return 0.5 + 0.45 * verhaeltnis;       // „jog“ ~ „joghurt“
  if (kurz.length >= 5 && lang.includes(kurz)) return 0.4 + 0.4 * verhaeltnis; // „joghurt“ in „naturjoghurt“
  return 0;
}

function trigramme(s: string): Set<string> {
  const t = ` ${s} `;
  const m = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) m.add(t.slice(i, i + 3));
  return m;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  const x = trigramme(a);
  const y = trigramme(b);
  let gemeinsam = 0;
  for (const g of x) if (y.has(g)) gemeinsam++;
  return (2 * gemeinsam) / (x.size + y.size);
}

/** Wie gut passt ein Text zu einem Sortennamen? 0 … 1 */
export function namensAehnlichkeit(text: string, sortenname: string): number {
  const a = bonWoerter(text).map(stamm);
  const b = normalisiere(produktSchluessel(sortenname)).split(' ').filter((w) => w.length >= 2).map(stamm);
  if (a.length === 0 || b.length === 0) return 0;

  const bestes = (w: string, liste: string[]) => Math.max(0, ...liste.map((x) => wortAehnlichkeit(w, x)));
  const abdeckungSorte = b.reduce((s, w) => s + bestes(w, a), 0) / b.length;
  const abdeckungBon = a.reduce((s, w) => s + bestes(w, b), 0) / a.length;
  const woerter = 0.6 * abdeckungSorte + 0.4 * abdeckungBon;
  // zusammengeschrieben vergleichen: „KIDNEY BOHNEN“ = „Kidneybohnen“, „NATUR JOGHURT“ = „Naturjoghurt“
  const roh = normalisiere(text.replace(/\d+(?:[.,]\d+)?\s*(kg|gr|g|ltr|l|ml|cl|st|stk|er|x|%)?/gi, ' '))
    .split(' ').filter((w) => w.length >= 2 && w !== 'bio' && w !== 'tk').map(stamm).join('');
  const zusammen = Math.max(dice(a.join(''), b.join('')), dice(roh, b.join('')));
  return Math.min(1, Math.max(woerter, zusammen >= 0.9 ? zusammen : zusammen * 0.8));
}

/** Gekauftes ist selten etwas Selbstgemachtes. */
function artFaktor(s: SorteInfo): number {
  if (s.art === 'zutat' || s.herkunft === 'gekauft') return 1;
  if (s.herkunft === 'selbstgemacht') return 0.5;
  return s.art === 'komponente' ? 0.6 : 0.85; // Komplettgericht ohne Angabe: TK-Pizza kann gekauft sein
}

const runde = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Kandidaten für einen Bon-Artikel, beste zuerst.
 * gewohnheit: frühere Entscheidung zu genau diesem Bon-Text (falls vorhanden)
 * hinweisName: verständlicher Name als zusätzlicher Anhaltspunkt (nie „sicher“)
 */
export function ordneZu(
  text: string,
  sorten: SorteInfo[],
  gewohnheit: Gewohnheit | null = null,
  hinweisName: string | null = null,
): Zuordnung {
  const kandidaten = new Map<number, Kandidat>();
  const merke = (k: Kandidat) => {
    const alt = kandidaten.get(k.sorte_id);
    if (!alt || k.sicherheit > alt.sicherheit) kandidaten.set(k.sorte_id, k);
  };

  for (const s of sorten) {
    const faktor = artFaktor(s);
    const name = namensAehnlichkeit(text, s.name) * faktor;
    if (name > 0.2) merke({ sorte_id: s.id, name: s.name, sicherheit: runde(name), grund: 'name' });
    if (hinweisName) {
      const h = Math.min(HINWEIS_MAX, namensAehnlichkeit(hinweisName, s.name) * faktor);
      if (h > 0.2) merke({ sorte_id: s.id, name: s.name, sicherheit: runde(h), grund: 'hinweis' });
    }
  }

  if (gewohnheit?.letzte_sorte != null) {
    const s = sorten.find((x) => x.id === gewohnheit.letzte_sorte);
    if (s) merke({ sorte_id: s.id, name: s.name, sicherheit: GELERNT, grund: 'gelernt' });
  }

  // Eine frühere Entscheidung des Nutzers für genau diesen Bon-Text steht immer vorne.
  const liste = [...kandidaten.values()]
    .sort((a, b) => Number(b.grund === 'gelernt') - Number(a.grund === 'gelernt') || b.sicherheit - a.sicherheit || a.name.localeCompare(b.name, 'de'))
    .slice(0, 4);
  const [erster, zweiter] = liste;
  let status: Zuordnung['status'] = 'unbekannt';
  if (erster && erster.sicherheit >= SICHER_AB && (erster.grund === 'gelernt' || !zweiter || erster.sicherheit - zweiter.sicherheit >= ABSTAND)) {
    status = 'sicher';
  } else if (erster && erster.sicherheit >= UNSICHER_AB) {
    status = 'unsicher';
  }
  return { kandidaten: liste.filter((k) => k.sicherheit >= 0.35), status };
}

const MIT_UMLAUT: Record<string, string> = {
  kaese: 'käse', reibekaese: 'reibekäse', moehren: 'möhren', aepfel: 'äpfel', broetchen: 'brötchen', gemuese: 'gemüse',
  gemuesemix: 'gemüsemix', haehnchen: 'hähnchen',
};

/** Aus dem Bon-Text einen lesbaren Produktnamen machen: „HAFERDRINK BARISTA 1L“ → „Haferdrink Barista“. */
export function lesbarerName(text: string): string {
  const woerter = text
    .replace(/^\d{4,}\s+/, '')
    .replace(/\d+(?:[.,]\d+)?\s*(kg|gr|g|ltr|l|ml|cl|st|stk|er)\b/gi, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ')
    .split(/[\s,;/]+/)
    .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .filter((w) => w && (!FUELLWOERTER.has(normalisiere(w)) || ['natur', 'pur', 'tk'].includes(normalisiere(w))))
    .map((w) => {
      const kurz = KUERZEL[normalisiere(w)];
      if (/^tk$/i.test(w)) return 'TK';
      const wort = kurz ? MIT_UMLAUT[kurz] ?? kurz : w.toLowerCase();
      return wort.charAt(0).toUpperCase() + wort.slice(1);
    });
  return (woerter.join(' ') || text).slice(0, 60);
}
