// Lernen innerhalb einer Session – bewusst vorsichtig.
//
// • Jede Entscheidung wirkt auf die Eigenschaften des Gerichts (Typ, Hauptzutat, Gewürzrichtung …).
// • Geglättet: score = (positiv − negativ) / (positiv + negativ + 2).
//   Eine einzelne Ablehnung ergibt −0,33 und reicht allein nie für „gemieden“.
// • Ablehnungen in Folge öffnen die Suche stufenweise (Radius 0–3):
//     1 Ablehnung   → anderes Gericht, darf ähnlich bleiben (anderes Curry)
//     2 in Folge    → anderer Gerichtstyp            (Curry → Reispfanne)
//     3–4 in Folge  → zusätzlich andere Gewürzrichtung (→ Pasta)
//     5+ in Folge   → komplett andere Richtung (auch anderer Sattmacher und Hauptzutat)
import type { Aktion, FeedbackEintrag, GerichtKurz, Leitplanken, Modus, Tendenz } from './typen.ts';
import { normalisiere } from './text.ts';

const WIRKUNG: Record<Aktion, number> = {
  like: 1,
  similar: 1,
  save: 1.5,
  cook: 2,
  dislike: -1,
  skip: 0,
};

const DIMENSIONEN: Tendenz['dimension'][] = [
  'gerichtstyp', 'hauptzutat', 'gewuerzrichtung', 'sattmacher', 'geschmack', 'zubereitung',
];

/** Mindestens so viele gleichgerichtete Entscheidungen, bevor etwas als Muster gilt. */
export const MIN_ENTSCHEIDUNGEN = 2;
const SCHWELLE = 0.34;

function wertVon(g: GerichtKurz, d: Tendenz['dimension']): string {
  const w = g.eigenschaften[d];
  return d === 'hauptzutat' ? normalisiere(String(w)) : String(w);
}

export function lerneTendenzen(feedback: FeedbackEintrag[]): Tendenz[] {
  const tabelle = new Map<string, Tendenz>();
  for (const f of feedback) {
    const w = WIRKUNG[f.aktion];
    if (w === 0) continue;
    for (const d of DIMENSIONEN) {
      const wert = wertVon(f, d);
      if (!wert || wert === 'sonstiges' || wert === 'neutral') continue;
      const key = `${d}:${wert}`;
      const t = tabelle.get(key) ?? { dimension: d, wert, positiv: 0, negativ: 0, score: 0 };
      if (w > 0) t.positiv += w;
      else t.negativ += -w;
      tabelle.set(key, t);
    }
  }
  const ergebnis = [...tabelle.values()];
  for (const t of ergebnis) t.score = Math.round(((t.positiv - t.negativ) / (t.positiv + t.negativ + 2)) * 100) / 100;
  return ergebnis.sort((a, b) => a.score - b.score);
}

/** Ablehnungen am Ende der Session, ohne neutrale „Überspringen“ dazwischen zu zählen. */
export function ablehnungenInFolge(feedback: FeedbackEintrag[]): FeedbackEintrag[] {
  const folge: FeedbackEintrag[] = [];
  for (let i = feedback.length - 1; i >= 0; i--) {
    const a = feedback[i].aktion;
    if (a === 'skip') continue;
    if (a !== 'dislike') break;
    folge.unshift(feedback[i]);
  }
  return folge;
}

const TYP_NAMEN: Record<string, string> = {
  pasta: 'Pasta', curry: 'Currys', wrap: 'Wraps', pfanne: 'Pfannengerichte', suppe: 'Suppen',
  eintopf: 'Eintöpfe', bowl: 'Bowls', toast: 'Toasts', auflauf: 'Aufläufe', salat: 'Salate',
  pizza: 'Pizza', burger: 'Burger', aufwaermen: 'Fertiggerichte',
};
const typName = (w: string) => TYP_NAMEN[w] ?? w;

function musterTexte(tendenzen: Tendenz[], gemieden: Tendenz[]): string[] {
  const texte: string[] = [];
  const typGemieden = gemieden.filter((t) => t.dimension === 'gerichtstyp').map((t) => typName(t.wert));
  const typAngenommen = tendenzen
    .filter((t) => t.dimension === 'gerichtstyp' && t.positiv > 0 && t.negativ === 0)
    .map((t) => typName(t.wert));
  if (typGemieden.length && typAngenommen.length) {
    texte.push(
      `${typAngenommen.join('/')} scheinen gerade häufiger angenommen zu werden als ${typGemieden.join('/')}.`,
    );
  } else if (typGemieden.length) {
    texte.push(`${typGemieden.join('/')} wurden mehrmals abgelehnt – ich probiere eher andere Richtungen.`);
  }
  for (const t of gemieden) {
    if (t.dimension === 'gerichtstyp') continue;
    if (t.dimension === 'hauptzutat') texte.push(`Gerichte mit ${t.wert} kamen zuletzt seltener an.`);
    if (t.dimension === 'gewuerzrichtung') texte.push(`Die Richtung „${t.wert}“ kam zuletzt seltener an.`);
  }
  return texte;
}

export function berechneLeitplanken(feedback: FeedbackEintrag[], modus: Modus): Leitplanken {
  const tendenzen = lerneTendenzen(feedback);
  const gemieden = tendenzen.filter(
    (t) => t.negativ >= MIN_ENTSCHEIDUNGEN && t.score <= -SCHWELLE,
  );
  const beliebt = tendenzen.filter(
    (t) => t.positiv >= MIN_ENTSCHEIDUNGEN && t.score >= SCHWELLE,
  );

  const folge = ablehnungenInFolge(feedback);
  const n = folge.length;
  const radius: Leitplanken['radius'] = n <= 1 ? 0 : n === 2 ? 1 : n <= 4 ? 2 : 3;

  const sammle = (d: Tendenz['dimension']) => [...new Set(folge.map((f) => wertVon(f, d)))];
  const ausschluss: Leitplanken['ausschluss'] = {
    gerichtstyp: radius >= 1 ? sammle('gerichtstyp') : [],
    gewuerzrichtung: radius >= 2 ? sammle('gewuerzrichtung').filter((w) => w !== 'neutral') : [],
    sattmacher: radius >= 3 ? sammle('sattmacher').filter((w) => w !== 'keiner') : [],
    hauptzutat: radius >= 3 ? sammle('hauptzutat') : [],
  };

  const muster = musterTexte(tendenzen, gemieden);
  if (n >= 5) muster.push(`${n} Vorschläge in Folge passten nicht – ich öffne die Suche deutlich.`);

  return {
    radius,
    ablehnungen_in_folge: n,
    ausschluss,
    gemieden,
    beliebt,
    muster,
    anker: modus.art === 'aehnlich' ? modus.zu : null,
  };
}

/** Verletzt ein Gericht die harten Ausschlüsse der aktuellen Leitplanken? */
export function verletztAusschluss(g: GerichtKurz, l: Leitplanken): string | null {
  const e = g.eigenschaften;
  if (l.ausschluss.gerichtstyp.includes(e.gerichtstyp)) return `Gerichtstyp ${e.gerichtstyp} wurde gerade mehrfach abgelehnt`;
  if (l.ausschluss.gewuerzrichtung.includes(e.gewuerzrichtung)) return `Richtung ${e.gewuerzrichtung} wurde gerade mehrfach abgelehnt`;
  if (l.ausschluss.sattmacher.includes(e.sattmacher)) return `Sattmacher ${e.sattmacher} wurde gerade mehrfach abgelehnt`;
  if (l.ausschluss.hauptzutat.includes(normalisiere(e.hauptzutat))) return `Hauptzutat ${e.hauptzutat} wurde gerade mehrfach abgelehnt`;
  return null;
}

/** Weiche Präferenz: + für Beliebtes, − für Gemiedenes (für die Rangfolge). */
export function praeferenzWert(g: GerichtKurz, l: Leitplanken): number {
  let w = 0;
  for (const t of l.beliebt) if (wertVon(g, t.dimension) === t.wert) w += t.score;
  for (const t of l.gemieden) if (wertVon(g, t.dimension) === t.wert) w += t.score;
  return w;
}
