// Notfall-Einkauf: nicht „kauf Tomaten“, sondern die EINE Zutat, die am meisten möglich macht.
//
// Bewertet wird von der Software, nicht von der KI:
//   • wie viele künftige Gerichte sie ermöglicht
//   • wie häufig sie typischerweise gebraucht wird
//   • Haltbarkeit und ob sie ohne Kühlung lagerbar ist
//   • wie gut sie zu dem passt, was schon da ist (Kombinierbarkeit)
//   • ob sie eine Lücke füllt (z. B. gar kein Sattmacher im Bestand)
//   • Preis – nur wenn er aus dem Bestand bekannt ist; unbekannt wird nie geschätzt
import type { Einkaufsvorschlag, Farbe, RohEinkauf, Snapshot, SnapshotZutat } from './typen.ts';
import { bekannterPreisBezug, bekannterPreisInfo } from './snapshot.ts';
import { euroText } from './kosten.ts';
import { kuerze, normalisiere } from './text.ts';

type MultiUse = {
  name: string;
  schluessel: string;
  rolle: Farbe;
  passt_zu: string[];
  /** typische Haltbarkeit ungeöffnet (Allgemeinwissen, keine Haushaltsdaten) */
  haltbar_tage: number;
  lagerung: 'vorrat' | 'kuehlschrank' | 'gefrierfach';
  /** wie oft man sie typischerweise braucht: 1 selten … 3 ständig */
  haeufigkeit: 1 | 2 | 3;
  /** mit welchen Rollen im Bestand sie sich direkt kombinieren lässt */
  kombiniert_mit: Farbe[];
};

/** Vielseitige Grundzutaten. Welche davon vorgeschlagen wird, hängt vom Bestand ab. */
export const MULTI_USE: MultiUse[] = [
  { name: 'Gehackte Tomaten (Dose)', schluessel: 'tomate', rolle: 'rot', passt_zu: ['Linsen-Ragù', 'Chili', 'Tomaten-Curry', 'Tomatensuppe', 'Bohnen-Wrap', 'Schnelle Pizza', 'Tomaten-Kartoffelpfanne', 'Shakshuka'], haltbar_tage: 730, lagerung: 'vorrat', haeufigkeit: 3, kombiniert_mit: ['braun', 'gelb', 'gruen'] },
  { name: 'Tomatenmark', schluessel: 'tomatenmark', rolle: 'rot', passt_zu: ['Tomatensoße', 'Chili', 'Curry', 'Linsen-Ragù', 'Pizza-Toast'], haltbar_tage: 365, lagerung: 'vorrat', haeufigkeit: 2, kombiniert_mit: ['braun', 'gelb'] },
  { name: 'Reis', schluessel: 'reis', rolle: 'gelb', passt_zu: ['Reispfanne', 'Curry mit Reis', 'Chili mit Reis', 'Burrito-Bowl', 'Gemüsereis', 'Gefüllte Wraps', 'Reissuppe'], haltbar_tage: 540, lagerung: 'vorrat', haeufigkeit: 3, kombiniert_mit: ['rot', 'braun', 'gruen'] },
  { name: 'Pasta', schluessel: 'pasta', rolle: 'gelb', passt_zu: ['Tomatenpasta', 'Linsen-Bolognese', 'Curry-Pasta', 'Nudelpfanne', 'Pasta-Auflauf', 'Nudelsalat', 'Minestrone'], haltbar_tage: 540, lagerung: 'vorrat', haeufigkeit: 3, kombiniert_mit: ['rot', 'braun', 'gruen'] },
  { name: 'Kartoffeln', schluessel: 'kartoffel', rolle: 'gelb', passt_zu: ['Bratkartoffeln', 'Kartoffel-Curry', 'Kartoffelsuppe', 'Ofenkartoffeln', 'Kartoffel-Wrap', 'Kartoffelpfanne'], haltbar_tage: 60, lagerung: 'vorrat', haeufigkeit: 2, kombiniert_mit: ['rot', 'braun', 'gruen'] },
  { name: 'Wraps', schluessel: 'wrap', rolle: 'gelb', passt_zu: ['Bohnen-Wrap', 'Curry-Wrap', 'Wrap-Pizza', 'Quesadilla', 'Linsen-Wrap'], haltbar_tage: 45, lagerung: 'vorrat', haeufigkeit: 2, kombiniert_mit: ['rot', 'braun', 'gruen'] },
  { name: 'Rote Linsen', schluessel: 'linsen', rolle: 'braun', passt_zu: ['Linsen-Dal', 'Linsen-Bolognese', 'Linsensuppe', 'Linsen-Curry', 'Linsen-Wrap', 'Linsen-Bratlinge'], haltbar_tage: 540, lagerung: 'vorrat', haeufigkeit: 2, kombiniert_mit: ['rot', 'gelb', 'gruen'] },
  { name: 'Kichererbsen (Dose)', schluessel: 'kichererbse', rolle: 'braun', passt_zu: ['Kichererbsen-Curry', 'Hummus-Wrap', 'Geröstete Kichererbsen', 'Orientalische Pfanne', 'Kichererbsen-Salat'], haltbar_tage: 730, lagerung: 'vorrat', haeufigkeit: 2, kombiniert_mit: ['rot', 'gelb', 'gruen'] },
  { name: 'Kidneybohnen (Dose)', schluessel: 'bohne', rolle: 'braun', passt_zu: ['Chili', 'Bohnen-Wrap', 'Burrito-Bowl', 'Bohnen-Eintopf', 'Bohnen-Tomaten-Toast'], haltbar_tage: 730, lagerung: 'vorrat', haeufigkeit: 2, kombiniert_mit: ['rot', 'gelb'] },
  { name: 'TK-Gemüsemix', schluessel: 'gemuese', rolle: 'gruen', passt_zu: ['Gemüsepfanne', 'Gemüse-Curry', 'Nudelpfanne', 'Gemüsesuppe', 'Reispfanne', 'Gemüse-Wrap'], haltbar_tage: 270, lagerung: 'gefrierfach', haeufigkeit: 3, kombiniert_mit: ['rot', 'braun', 'gelb'] },
  { name: 'Zwiebeln', schluessel: 'zwiebel', rolle: 'gruen', passt_zu: ['Tomatensoße', 'Chili', 'Curry', 'Bratkartoffeln', 'Zwiebelsuppe', 'Linsen-Ragù'], haltbar_tage: 45, lagerung: 'vorrat', haeufigkeit: 3, kombiniert_mit: ['rot', 'braun', 'gelb'] },
  { name: 'Haferflocken', schluessel: 'hafer', rolle: 'gelb', passt_zu: ['Gemüse-Bratlinge', 'Herzhafter Porridge', 'Bindung für Soßen'], haltbar_tage: 365, lagerung: 'vorrat', haeufigkeit: 1, kombiniert_mit: ['gruen', 'braun'] },
];

const MIN_MOEGLICHKEITEN = 3;

const ROLLE: Record<Farbe, string> = {
  rot: 'Soße', braun: 'Protein', gruen: 'Gemüse', gelb: 'Sattmacher', weiss: 'Gewürz', schwarz: 'Topping', blau: 'Komplettgericht',
};

function haltbarText(tage: number): string {
  if (tage >= 365) return 'typischerweise über ein Jahr haltbar';
  if (tage >= 180) return 'typischerweise monatelang haltbar';
  return `typischerweise etwa ${Math.round(tage / 7)} Wochen haltbar`;
}

export type MultiUseBewertung = { m: MultiUse; punkte: number; partner: SnapshotZutat[]; fuelltLuecke: boolean; preis: number | null };

/** Bewertet alle Kandidaten für den aktuellen Bestand (höchste Punkte zuerst). */
export function bewerteMultiUse(snapshot: Snapshot): MultiUseBewertung[] {
  const bestand = snapshot.zutaten.filter((z) => z.quelle === 'bestand' && z.art !== 'komplettgericht');
  const hatRolle = (farbe: Farbe) => bestand.some((z) => z.farbe === farbe);
  const hatSchon = (m: MultiUse) =>
    snapshot.zutaten.some((z) => z.quelle !== 'grundausstattung' && normalisiere(z.name).includes(m.schluessel));

  return MULTI_USE.filter((m) => !hatSchon(m))
    .map((m) => {
      const partner = bestand.filter((z) => z.farbe !== null && m.kombiniert_mit.includes(z.farbe));
      const fuelltLuecke = !hatRolle(m.rolle);
      const preis = bekannterPreisInfo(snapshot, m.name)?.kosten_cent ?? null;
      const punkte =
        2.0 * Math.min(1, m.passt_zu.length / 8) +
        1.0 * (m.haeufigkeit / 3) +
        1.0 * Math.min(1, m.haltbar_tage / 365) +
        0.8 * (m.lagerung === 'vorrat' ? 1 : m.lagerung === 'gefrierfach' ? 0.7 : 0.4) +
        1.5 * Math.min(1, partner.length / 3) +
        1.5 * (fuelltLuecke ? 1 : 0) +
        0.5 * (preis !== null && preis <= 150 ? 1 : 0);
      return { m, punkte: Math.round(punkte * 1000) / 1000, partner, fuelltLuecke, preis };
    })
    .sort((a, b) => b.punkte - a.punkte || a.m.name.localeCompare(b.m.name));
}

function gruendeFuer(b: MultiUseBewertung, snapshot: Snapshot): string[] {
  const gruende: string[] = [];
  if (b.fuelltLuecke) gruende.push(`Füllt eine Lücke: Im Bestand fehlt gerade ${ROLLE[b.m.rolle]}.`);
  if (b.partner.length) {
    const namen = b.partner.slice(0, 3).map((z) => z.name).join(', ');
    gruende.push(`Passt zu ${b.partner.length === 1 ? 'etwas' : `${b.partner.length} Sachen`}, die schon da ${b.partner.length === 1 ? 'ist' : 'sind'}: ${namen}.`);
  }
  gruende.push(`Ermöglicht ${b.m.passt_zu.length} verschiedene Gerichte.`);
  const haltbar = haltbarText(b.m.haltbar_tage);
  gruende.push(`${haltbar.charAt(0).toUpperCase()}${haltbar.slice(1)}${b.m.lagerung === 'vorrat' ? ', ohne Kühlung lagerbar' : ''}.`);
  const bezug = bekannterPreisBezug(snapshot, b.m.name);
  gruende.push(b.preis !== null ? `Zuletzt ${euroText(b.preis)}${bezug ? ` ${bezug}` : ''}.` : 'Preis unbekannt.');
  return gruende;
}

function heuteMit(b: MultiUseBewertung): string | null {
  if (b.partner.length === 0) return null;
  // aus jeder Rolle höchstens eine Zutat, bald Ablaufendes zuerst
  const sortiert = [...b.partner].sort((x, y) => Number(y.bald_verbrauchen || y.geoeffnet) - Number(x.bald_verbrauchen || x.geoeffnet));
  const rollen = new Set<string>();
  const teile = sortiert.filter((z) => {
    if (!z.farbe || rollen.has(z.farbe)) return false;
    rollen.add(z.farbe);
    return true;
  }).slice(0, 2);
  return [b.m.name, ...teile.map((z) => z.name)].join(' + ');
}

function vorschlagAus(b: MultiUseBewertung, snapshot: Snapshot, id: string): Einkaufsvorschlag {
  return {
    art: 'einkauf',
    id,
    name: b.m.name,
    preis_cent: b.preis,
    preis_bezug: b.preis !== null ? bekannterPreisBezug(snapshot, b.m.name) : null,
    ermoeglicht: b.m.passt_zu,
    heute: heuteMit(b),
    gruende: gruendeFuer(b, snapshot),
    begruendung: 'Eine Zutat, die heute ein Essen möglich macht und danach noch viele weitere.',
  };
}

/** Wählt die Multi-Use-Zutat mit dem größten Nutzen für den aktuellen Bestand. */
export function waehleMultiUse(snapshot: Snapshot, id: string): Einkaufsvorschlag {
  const beste = bewerteMultiUse(snapshot)[0];
  if (beste) return vorschlagAus(beste, snapshot, id);
  // Alles schon da – dann die vielseitigste überhaupt, ohne weitere Bewertung.
  const m = MULTI_USE[0];
  return vorschlagAus({ m, punkte: 0, partner: [], fuelltLuecke: false, preis: bekannterPreisInfo(snapshot, m.name)?.kosten_cent ?? null }, snapshot, id);
}

/** Prüft einen Einkaufsvorschlag der KI. Preise nur aus dem Bestand – nie geschätzt. */
export function pruefeEinkauf(roh: RohEinkauf | null | undefined, snapshot: Snapshot, id: string): Einkaufsvorschlag | null {
  if (!roh || typeof roh.name !== 'string' || !roh.name.trim()) return null;
  const ermoeglicht = (Array.isArray(roh.ermoeglicht) ? roh.ermoeglicht : [])
    .map((e) => kuerze(e, 60))
    .filter(Boolean)
    .slice(0, 12);
  if (ermoeglicht.length < MIN_MOEGLICHKEITEN) return null; // kein Multi-Use → lieber eigener Vorschlag
  const name = kuerze(roh.name, 60);
  // Kennt die Software die Zutat, liefert sie die belastbaren Gründe selbst.
  const bekannt = bewerteMultiUse(snapshot).find((b) => normalisiere(name).includes(b.m.schluessel));
  const preis = bekannterPreisInfo(snapshot, name)?.kosten_cent ?? null;
  return {
    art: 'einkauf',
    id,
    name,
    preis_cent: preis,
    preis_bezug: preis !== null ? bekannterPreisBezug(snapshot, name) : null,
    ermoeglicht,
    heute: bekannt ? heuteMit(bekannt) : null,
    gruende: bekannt ? gruendeFuer(bekannt, snapshot) : [preis !== null ? `Zuletzt ${euroText(preis)}.` : 'Preis unbekannt.'],
    begruendung: (kuerze(roh.begruendung, 240) || `Damit sind ${ermoeglicht.length} weitere Gerichte möglich.`)
      .replace(/[^.!?]*(\d+(?:[.,]\d+)?\s*(?:€|euro|cent)|€)[^.!?]*[.!?]?/gi, '')
      .trim() || `Damit sind ${ermoeglicht.length} weitere Gerichte möglich.`,
  };
}
