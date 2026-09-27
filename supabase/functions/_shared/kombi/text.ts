// Kleine Text-Helfer für Vergleiche (Namen, Eigenschaften).

/** 'Linsen-Tomaten Pasta!' → 'linsen tomaten pasta'; Umlaute werden ausgeschrieben. */
export function normalisiere(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Wählt den passenden erlaubten Wert oder den Ersatzwert. */
export function ausListe<T extends string>(wert: unknown, erlaubt: readonly T[], ersatz: T): T {
  if (typeof wert !== 'string') return ersatz;
  const n = normalisiere(wert).replace(/ /g, '');
  return erlaubt.find((e) => e === n) ?? erlaubt.find((e) => n.includes(e)) ?? ersatz;
}

export function kuerze(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Kurzer Name für zusammengesetzte Gerichtsnamen: 'Linsen gekocht' → 'Linsen', 'TK-Gemüsemix' → 'Gemüse'. */
export function kurzname(name: string): string {
  const woerter = name
    .replace(/^TK[- ]/i, '')
    .split(/[\s-]+/)
    .filter((w) => w && !/^(gekocht|portion|basis|kokos|box|mix)$/i.test(w));
  const erstes = woerter[0] ?? name;
  return erstes
    .replace(/(soße|sosse|sauce)$/i, '')
    .replace(/mix$/i, '')
    .replace(/^(.)/, (b) => b.toUpperCase()) || name;
}

/** Kühlschrank-Rest für Gerichtsnamen: „eine angebrochene Packung Mais“ → „Mais“. */
export function restName(text: string): string {
  const ohne = text
    .replace(/^((eine?[nmrs]?|ein\s+paar|etwas|noch|halbe?[nrs]?|viertel|reste?|angebrochene?[nrs]?|offene?[nrs]?|packung|dose|glas|becher|bisschen|wenig)\s+)+/i, '')
    .trim();
  return ohne || text;
}
