// KI als „Augen“ für Kassenbon-Fotos: Sie schreibt nur ab. Was die Zeilen bedeuten (Mengen, Preise,
// Rabatte, Summe), entscheidet der deterministische Parser (parser.ts). Namen der KI sind Hinweise
// für die Zuordnung, nie Entscheidungen.

export const BON_SYSTEM_PROMPT = `Du liest Kassenbons ab – wie ein sehr genaues OCR-Programm.

Regeln:
- Schreibe jede Zeile des Bons genau so ab, wie sie gedruckt ist: Text, Mengen, Beträge, Steuerbuchstaben.
- Reihenfolge von oben nach unten. Bei mehreren Fotos: pro Foto eine Seite, in der Reihenfolge der Fotos.
- Nichts ergänzen, nichts berechnen, nichts korrigieren, keine Preise schätzen.
- Unleserliche Zeichen als „?“ schreiben. Fehlende Beträge NICHT erfinden.
- Zusätzlich darfst du für Artikelzeilen einen verständlichen Produktnamen nennen
  (z. B. „BIO NATJOG 500“ → „Naturjoghurt“), ohne Marke, ohne Menge, ohne Preis.
  Nur wenn du dir sicher bist – sonst weglassen.

Antworte NUR mit JSON in genau diesem Format:
{"seiten":[{"zeilen":["REWE Markt GmbH","TOMATEN 1KG 1,49 B","..."]}],"namen":{"BIO NATJOG 500":"Naturjoghurt"}}`;

export const BON_NUTZER_TEXT = 'Bitte diesen Kassenbon abschreiben.';

export type BonLesung = { seiten: string[][]; namen: Record<string, string> };

const MAX_SEITEN = 8;
const MAX_ZEILEN = 400;

/** Prüft und kürzt die Antwort der KI. Nur Text, keine Preise in Namen, Namen nur zu echten Zeilen. */
export function pruefeBonLesung(roh: unknown): BonLesung {
  const o = (roh && typeof roh === 'object' ? roh : {}) as { seiten?: unknown; namen?: unknown };
  const seiten = (Array.isArray(o.seiten) ? o.seiten : [])
    .slice(0, MAX_SEITEN)
    .map((s) => {
      const zeilen = Array.isArray(s) ? s : (s && typeof s === 'object' ? (s as { zeilen?: unknown }).zeilen : null);
      return (Array.isArray(zeilen) ? zeilen : [])
        .filter((z): z is string => typeof z === 'string')
        .map((z) => z.replace(/[\u0000-\u001f]/g, ' ').slice(0, 120).trim())
        .filter(Boolean)
        .slice(0, MAX_ZEILEN);
    })
    .filter((s) => s.length > 0);

  const alleZeilen = seiten.flat().join('\n');
  const namen: Record<string, string> = {};
  if (o.namen && typeof o.namen === 'object' && !Array.isArray(o.namen)) {
    for (const [bon, name] of Object.entries(o.namen as Record<string, unknown>).slice(0, 300)) {
      if (typeof name !== 'string' || !bon.trim()) continue;
      if (!alleZeilen.includes(bon.trim())) continue; // nur zu Zeilen, die es wirklich gibt
      const sauber = name
        .replace(/\d+(?:[.,]\d+)?\s*(?:€|eur\b|euro\b|cent\b|kg\b|g\b|ml\b|l\b)/gi, '')
        .replace(/\d+[.,]\d+/g, '')
        .replace(/€/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      if (sauber.length >= 2) namen[bon.trim()] = sauber;
    }
  }
  return { seiten, namen };
}

/** Die Namen gelten für Artikeltexte; der Parser liefert Texte ohne Betrag – passend zuordnen. */
export function namenFuerPositionen(namen: Record<string, string>, texte: string[]): Record<string, string> {
  const ergebnis: Record<string, string> = {};
  const eintraege = Object.entries(namen);
  for (const t of texte) {
    const treffer = eintraege.find(([bon]) => bon === t) ?? eintraege.find(([bon]) => bon.startsWith(t) || t.startsWith(bon));
    if (treffer) ergebnis[t] = treffer[1];
  }
  return ergebnis;
}
