// Vom gelesenen Bon zum prüfbaren Import-Vorschlag – ohne irgendetwas zu buchen.
//
//   erstelleEntwurf()  Bon + Sorten + Gewohnheiten → Positionen mit Zuordnung und Standardentscheidung
//   fragenFuer()       nur die Rückfragen, die für einen korrekten Bestand nötig oder unsicher sind
//   waehleSorte(), alsNeu(), setzeAnzahl() …   Antworten des Nutzers (liefern einen NEUEN Entwurf)
//   vorschau()         „Bestandsänderungen prüfen“: vorher / Änderung / nachher, Kosten, Nicht übernommen
//   buchungsDaten()    genau das, was bon_buchen() in der Datenbank bekommt – erst nach „Bestand aktualisieren“
//
// Kosten: bezahlter Preis (Betrag − eindeutig zugeordneter Rabatt) × Anteil der gebuchten Menge.
// Dieselbe Formel rechnet bon_buchen() in der Datenbank. Pfand ist nie Lebensmittelkosten.
import type { Einheit, Lagerort } from '../typen.ts';
import type {
  BonDaten, BonPosition, FrageArt, Gewohnheit, Grund, ImportEntwurf, ImportQuelle, MengeQuelle, NeueSorte,
  PositionEntwurf, Rueckfrage, SorteInfo, Ziel,
} from './typen.ts';
import { bonSchluessel, lesbarerName, ordneZu } from './abgleich.ts';
import { kategorieFuer } from '../einkaufsliste.ts';
import { euroText, rundeCent } from '../kosten.ts';
import { mengeText } from '../mengen.ts';
import { normalisiere } from '../text.ts';

export type Kontext = {
  sorten: SorteInfo[];
  gewohnheiten: Gewohnheit[];
  /** verständliche Namen je Bon-Text (z. B. von der KI) – nur Hinweise */
  namen?: Record<string, string>;
};

/** Wird oft direkt gegessen/getrunken – hier lohnt die Frage „Soll das in den Bestand?“. */
const DIREKTVERZEHR = /joghurt|pudding|schoko|riegel|chips|keks|cookie|gummib|suessigkeit|praline|\beis\b|croissant|kuchen|donut|snack|cola|limo|smoothie|bier|wein|sekt|energy|kaugummi|brezel|laugen|sandwich|trinkjoghurt|milchreis|quarkspeise|muffin|nascherei/;
const KUEHLSCHRANK = /joghurt|milch|kaese|quark|butter|sahne|schmand|creme fraiche|frischkaese|mozzarella|feta|tofu|fleisch|hack|haehnchen|wurst|schinken|lachs|fisch|salat|beeren|hefe|pesto frisch|hummus|eier/;
const GEFRIERFACH = /^tk\b|\btk\b|tiefkuehl|gefroren|frost/;

export const GRUENDE: { id: Grund; text: string }[] = [
  { id: 'direkt_gegessen', text: 'Wird direkt gegessen' },
  { id: 'fuer_andere', text: 'Für jemand anderen' },
  { id: 'anderweitig', text: 'Schon anderweitig verwendet' },
  { id: 'sonstiges', text: 'Sonstiges' },
];

export function grundText(g: Grund | null, freitext: string | null): string {
  if (g === 'sonstiges' && freitext) return freitext;
  return GRUENDE.find((x) => x.id === g)?.text ?? 'Nicht übernommen';
}

// ───────── Mengen ─────────

const EINHEIT_NAME: Record<Einheit, string> = { g: 'Gramm', ml: 'ml', stueck: 'Stück', portion: 'Portionen' };

/** 1 Stück laut Bon = wie viele Einheiten der Sorte? null = unbekannt → Rückfrage. */
export function mengeProEinheit(
  bon: BonPosition,
  einheit: Einheit,
  gelernt: number | null,
): { wert: number | null; quelle: MengeQuelle | null } {
  if (gelernt !== null && gelernt > 0) return { wert: gelernt, quelle: 'gelernt' };
  if (bon.gewicht_g !== null) return einheit === 'g' ? { wert: bon.gewicht_g, quelle: 'gewicht' } : { wert: null, quelle: null };
  const p = bon.packung;
  if (p && p.einheit === einheit) return { wert: p.menge, quelle: 'packung' };
  // Ein Stück auf dem Bon ist ein Stück im Bestand (Dose, Brot, Packung) – außer bei Mehrfachpackungen „10ST“
  if (einheit === 'stueck') return { wert: 1, quelle: 'standard' };
  return { wert: null, quelle: null };
}

function einheitFuerNeu(bon: BonPosition): Einheit {
  if (bon.gewicht_g !== null) return 'g';
  if (bon.packung?.einheit === 'g') return 'g';
  if (bon.packung?.einheit === 'ml') return 'ml';
  return 'stueck';
}

export function neueSorteVorschlag(bon: BonPosition, hinweisName: string | null): NeueSorte {
  const name = (hinweisName?.trim() || lesbarerName(bon.text)).slice(0, 60);
  const n = normalisiere(`${name} ${bon.text}`);
  const kategorie = kategorieFuer(name);
  const einheit = einheitFuerNeu(bon);
  const lagerort: Lagerort = GEFRIERFACH.test(n) ? 'gefrierfach' : KUEHLSCHRANK.test(n) ? 'kuehlschrank' : 'vorrat';
  return {
    name,
    art: 'zutat',
    farbe: kategorie === 'sonstiges' ? 'gruen' : kategorie,
    lagerort,
    einheit,
    portion_menge: einheit === 'g' ? 100 : einheit === 'ml' ? 200 : 1,
    groesse_g: 100,
  };
}

/** Gebuchte Menge in der Einheit der Sorte. */
export function bestandMenge(p: PositionEntwurf): number {
  if (p.ziel.art === 'keine' || p.menge_pro_einheit === null || p.anzahl_uebernehmen <= 0) return 0;
  if (p.typ !== 'lebensmittel' && p.typ !== 'unbekannt') return 0;
  return Math.max(0, Math.round(p.anzahl_uebernehmen * p.menge_pro_einheit));
}

/** Bezahlter Preis der Zeile nach eindeutig zugeordnetem Rabatt; null = nicht lesbar. */
export function endpreis(bon: BonPosition): number | null {
  return bon.gesamtpreis_cent === null ? null : bon.gesamtpreis_cent - bon.rabatt_cent;
}

/** Kosten der gebuchten Menge (ungerundet) – dieselbe Formel wie bon_buchen(). null = Preis unbekannt. */
export function kostenGebucht(p: PositionEntwurf): number | null {
  const menge = bestandMenge(p);
  const preis = endpreis(p.bon);
  if (menge === 0) return 0;
  if (preis === null || p.menge_pro_einheit === null) return null;
  return preis * Math.min(1, menge / (p.bon.anzahl * p.menge_pro_einheit));
}

// ───────── Entwurf ─────────

export function einheitVonZiel(ziel: Ziel, sorten: SorteInfo[]): Einheit | null {
  if (ziel.art === 'sorte') return sorten.find((s) => s.id === ziel.sorte_id)?.einheit ?? null;
  if (ziel.art === 'neu') return ziel.daten.einheit;
  return null;
}

export function nameVonZiel(ziel: Ziel, sorten: SorteInfo[], ersatz: string): string {
  if (ziel.art === 'sorte') return sorten.find((s) => s.id === ziel.sorte_id)?.name ?? ersatz;
  if (ziel.art === 'neu') return ziel.daten.name;
  return ersatz;
}

function gewohnheitVon(schluessel: string, k: Kontext): Gewohnheit | null {
  return k.gewohnheiten.find((g) => g.schluessel === schluessel) ?? null;
}

function mitMenge(p: PositionEntwurf, k: Kontext): PositionEntwurf {
  const einheit = einheitVonZiel(p.ziel, k.sorten);
  if (!einheit) return { ...p, menge_pro_einheit: null, menge_quelle: null };
  const g = gewohnheitVon(p.schluessel, k);
  const gelernt = p.ziel.art === 'sorte' && g?.letzte_sorte === p.ziel.sorte_id ? g.letzte_menge_pro_einheit : null;
  const m = mengeProEinheit(p.bon, einheit, gelernt);
  return { ...p, menge_pro_einheit: m.wert, menge_quelle: m.quelle };
}

function gewohnheitsHinweis(name: string, g: Gewohnheit | null): { text: string | null; eher_nicht: boolean } {
  if (!g) return { text: null, eher_nicht: false };
  if (g.nicht_uebernommen >= 2 && g.uebernommen === 0) {
    return { text: `Du übernimmst ${name} normalerweise nicht in deinen Bestand.`, eher_nicht: true };
  }
  if (g.nicht_uebernommen >= 1 && g.uebernommen === 0) {
    return { text: `${name} hast du letztes Mal nicht in den Bestand übernommen.`, eher_nicht: true };
  }
  if (g.teilweise >= 1 || (g.nicht_uebernommen >= 1 && g.uebernommen >= 1)) {
    return { text: `${name} übernimmst du oft nur teilweise in den Bestand.`, eher_nicht: false };
  }
  return { text: null, eher_nicht: false };
}

function positionAus(bon: BonPosition, k: Kontext): PositionEntwurf {
  const schluessel = bonSchluessel(bon.text);
  const hinweisName = k.namen?.[bon.text]?.trim() || null;
  const lebensmittel = bon.typ === 'lebensmittel' || bon.typ === 'unbekannt';
  const zuordnung = lebensmittel
    ? ordneZu(bon.text, k.sorten, gewohnheitVon(schluessel, k), hinweisName)
    : { kandidaten: [], status: 'unbekannt' as const };

  let ziel: Ziel = { art: 'keine' };
  if (lebensmittel) {
    ziel = zuordnung.status !== 'unbekannt' && zuordnung.kandidaten[0]
      ? { art: 'sorte', sorte_id: zuordnung.kandidaten[0].sorte_id }
      : { art: 'neu', daten: neueSorteVorschlag(bon, hinweisName) };
  }

  const hinweise: string[] = [...bon.warnungen];
  if (bon.rabatt_cent > 0) hinweise.push(`Rabatt ${euroText(bon.rabatt_cent)} berücksichtigt`);
  if (bon.pfand_cent !== 0) hinweise.push(`Pfand ${euroText(Math.abs(bon.pfand_cent))} separat (keine Lebensmittelkosten)`);

  const p: PositionEntwurf = {
    nr: bon.nr,
    bon,
    schluessel,
    typ: bon.typ,
    zuordnung,
    hinweis_name: hinweisName,
    ziel,
    menge_pro_einheit: null,
    menge_quelle: null,
    anzahl_uebernehmen: lebensmittel ? bon.anzahl : 0,
    grund: null,
    grund_text: null,
    lagerort: null,
    ablauf_am: null,
    beantwortet: [],
    hinweise,
  };
  const mitM = mitMenge(p, k);
  const g = gewohnheitsHinweis(nameVonZiel(ziel, k.sorten, lesbarerName(bon.text)), gewohnheitVon(schluessel, k));
  if (g.text) mitM.hinweise.push(g.text);
  return mitM;
}

/** Fingerabdruck eines Bons (Händler, Datum, Summe, Positionen) – erkennt Doppelimporte. */
export function fingerabdruck(bon: BonDaten): string {
  const text = [
    normalisiere(bon.haendler ?? ''),
    bon.datum ?? '',
    bon.summe_cent ?? '',
    ...bon.positionen.map((p) => `${normalisiere(p.text)}:${p.gesamtpreis_cent ?? '?'}:${p.anzahl}`),
  ].join('|');
  const fnv = (saat: number) => {
    let h = saat >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return `bon-${fnv(0x811c9dc5)}${fnv(0x2f7a1c3b)}`;
}

export function erstelleEntwurf(
  bon: BonDaten,
  k: Kontext,
  quelle: { quelle: ImportQuelle; quelle_ref?: string | null; erkennung: string },
): ImportEntwurf {
  return {
    quelle: quelle.quelle,
    quelle_ref: quelle.quelle_ref ?? null,
    erkennung: quelle.erkennung,
    bon,
    positionen: bon.positionen.map((p) => positionAus(p, k)),
    fingerabdruck: fingerabdruck(bon),
  };
}

// ───────── Rückfragen ─────────

const hat = (p: PositionEntwurf, a: FrageArt) => p.beantwortet.includes(a);

/** Nur die Fragen, die für einen korrekten Bestand nötig oder unsicher sind – beste zuerst. */
export function fragenFuer(p: PositionEntwurf, k: Kontext): Rueckfrage[] {
  if (p.typ !== 'lebensmittel' && p.typ !== 'unbekannt') return [];
  const fragen: Rueckfrage[] = [];
  const name = nameVonZiel(p.ziel, k.sorten, lesbarerName(p.bon.text));
  const g = gewohnheitVon(p.schluessel, k);
  const gh = gewohnheitsHinweis(name, g);
  const nimmt = p.anzahl_uebernehmen > 0;

  if (nimmt && p.ziel.art === 'neu' && !hat(p, 'neu')) {
    fragen.push({
      nr: p.nr, art: 'neu', pflicht: true,
      frage: `Neues Produkt erkannt: „${p.ziel.daten.name}“`,
      hinweis: p.zuordnung.kandidaten.length ? `Oder meinst du ${p.zuordnung.kandidaten.map((c) => c.name).join(' / ')}?` : null,
    });
  }
  if (nimmt && p.ziel.art === 'sorte' && p.zuordnung.status !== 'sicher' && !hat(p, 'zuordnung')) {
    const mehrere = p.zuordnung.kandidaten.length > 1;
    fragen.push({
      nr: p.nr, art: 'zuordnung', pflicht: true,
      frage: mehrere ? `„${p.bon.text}“ – welche meinst du?` : `Ist „${p.bon.text}“ ${name}?`,
      hinweis: 'Ich bin mir nicht sicher, welches Produkt gemeint ist.',
    });
  }
  const einheit = einheitVonZiel(p.ziel, k.sorten);
  if (nimmt && einheit && p.menge_pro_einheit === null && !hat(p, 'umrechnung')) {
    fragen.push({
      nr: p.nr, art: 'umrechnung', pflicht: true,
      frage: `Wie viel ist 1 × „${p.bon.text}“ in ${EINHEIT_NAME[einheit]}?`,
      hinweis: p.bon.packung ? `Laut Bon: ${mengeText(p.bon.packung.menge, p.bon.packung.einheit)}` : null,
    });
  }

  const direkt = DIREKTVERZEHR.test(normalisiere(`${p.bon.text} ${name}`));
  const kenntEsSchon = !!g && g.uebernommen > 0 && g.nicht_uebernommen === 0 && g.teilweise === 0;
  const fraglich = gh.text !== null || (direkt && !kenntEsSchon);
  if (fraglich && p.bon.anzahl >= 2 && !hat(p, 'menge')) {
    fragen.push({
      nr: p.nr, art: 'menge', pflicht: false,
      frage: `${p.bon.anzahl} × ${name} gekauft – wie viele sollen in deinen Bestand?`,
      hinweis: gh.text,
    });
  } else if (fraglich && p.bon.anzahl < 2 && !hat(p, 'uebernehmen')) {
    fragen.push({
      nr: p.nr, art: 'uebernehmen', pflicht: false,
      frage: `Soll ${name} in deinen Bestand?`,
      hinweis: gh.text,
    });
  }
  return fragen;
}

export function alleFragen(e: ImportEntwurf, k: Kontext): Rueckfrage[] {
  return e.positionen.flatMap((p) => fragenFuer(p, k));
}

/** Vorschlag aus der Gewohnheit für die Mengenfrage (z. B. 0, wenn sonst nie übernommen) – nur ein Vorschlag. */
export function vorgeschlageneAnzahl(p: PositionEntwurf, k: Kontext): number {
  const g = gewohnheitVon(p.schluessel, k);
  return gewohnheitsHinweis('', g).eher_nicht ? 0 : p.bon.anzahl;
}

// ───────── Antworten (jede liefert einen neuen Entwurf) ─────────

function aendere(e: ImportEntwurf, nr: number, f: (p: PositionEntwurf) => PositionEntwurf): ImportEntwurf {
  return { ...e, positionen: e.positionen.map((p) => (p.nr === nr ? f(p) : p)) };
}

const plus = (p: PositionEntwurf, ...arten: FrageArt[]): FrageArt[] => [...new Set([...p.beantwortet, ...arten])];

/** „Das ist Sorte X“ – beantwortet Zuordnung bzw. „neu“. */
export function waehleSorte(e: ImportEntwurf, nr: number, sorteId: number, k: Kontext): ImportEntwurf {
  return aendere(e, nr, (p) => {
    const neu = mitMenge({ ...p, ziel: { art: 'sorte', sorte_id: sorteId }, beantwortet: plus(p, 'zuordnung', 'neu') }, k);
    // eine frühere Antwort auf die Umrechnung gilt nur für die alte Sorte
    return { ...neu, beantwortet: neu.beantwortet.filter((a) => a !== 'umrechnung') };
  });
}

/** Als neues Produkt übernehmen (optional mit geänderten Angaben). */
export function alsNeu(e: ImportEntwurf, nr: number, k: Kontext, daten?: Partial<NeueSorte>): ImportEntwurf {
  return aendere(e, nr, (p) => {
    const basis = p.ziel.art === 'neu' ? p.ziel.daten : neueSorteVorschlag(p.bon, p.hinweis_name);
    const ziel: Ziel = { art: 'neu', daten: { ...basis, ...daten } };
    const einheitGeaendert = p.ziel.art !== 'neu' || basis.einheit !== ziel.daten.einheit;
    const neu = einheitGeaendert ? mitMenge({ ...p, ziel }, k) : { ...p, ziel };
    return {
      ...neu,
      anzahl_uebernehmen: neu.anzahl_uebernehmen || p.bon.anzahl,
      beantwortet: plus(p, 'neu', 'zuordnung').filter((a) => !einheitGeaendert || a !== 'umrechnung'),
    };
  });
}

/** Wie viele Bon-Stück in den Bestand (0 … Anzahl laut Bon). Bei Wiegeware auch Bruchteile. */
export function setzeAnzahl(e: ImportEntwurf, nr: number, anzahl: number): ImportEntwurf {
  return aendere(e, nr, (p) => {
    const a = Math.max(0, Math.min(p.bon.anzahl, Number.isFinite(anzahl) ? anzahl : 0));
    return {
      ...p,
      anzahl_uebernehmen: a,
      grund: a > 0 && a >= p.bon.anzahl ? null : p.grund,
      beantwortet: plus(p, 'menge', 'uebernehmen'),
    };
  });
}

/** Gebuchte Menge direkt in der Einheit der Sorte (z. B. 300 g von 842 g Bananen). */
export function setzeBestandMenge(e: ImportEntwurf, nr: number, menge: number): ImportEntwurf {
  const p = e.positionen.find((x) => x.nr === nr);
  if (!p || !p.menge_pro_einheit) return e;
  return setzeAnzahl(e, nr, Math.max(0, menge) / p.menge_pro_einheit);
}

export function nichtUebernehmen(e: ImportEntwurf, nr: number, grund: Grund | null = null, freitext: string | null = null): ImportEntwurf {
  return aendere(e, nr, (p) => ({
    ...p,
    anzahl_uebernehmen: 0,
    grund,
    grund_text: grund === 'sonstiges' ? freitext?.slice(0, 200) ?? null : null,
    beantwortet: plus(p, 'menge', 'uebernehmen'),
  }));
}

export function setzeGrund(e: ImportEntwurf, nr: number, grund: Grund | null, freitext: string | null = null): ImportEntwurf {
  return aendere(e, nr, (p) => ({ ...p, grund, grund_text: grund === 'sonstiges' ? freitext?.slice(0, 200) ?? null : null }));
}

/** „1 × Pizza = 1 Portion“ – Umrechnung vom Nutzer. */
export function setzeMengeProEinheit(e: ImportEntwurf, nr: number, wert: number): ImportEntwurf {
  return aendere(e, nr, (p) => ({
    ...p,
    menge_pro_einheit: wert > 0 && Number.isFinite(wert) ? wert : null,
    menge_quelle: wert > 0 ? 'nutzer' : null,
    beantwortet: wert > 0 ? plus(p, 'umrechnung') : p.beantwortet,
  }));
}

/** „Doch ein Lebensmittel“ bzw. „kein Lebensmittel“. */
export function setzeTyp(e: ImportEntwurf, nr: number, typ: 'lebensmittel' | 'nicht_lebensmittel', k: Kontext): ImportEntwurf {
  return aendere(e, nr, (p) => {
    if (typ === 'nicht_lebensmittel') return { ...p, typ, ziel: { art: 'keine' }, anzahl_uebernehmen: 0 };
    const neu = positionAus({ ...p.bon, typ: 'lebensmittel' }, k);
    return { ...neu, typ: 'lebensmittel', beantwortet: p.beantwortet };
  });
}

export function setzeLagerung(e: ImportEntwurf, nr: number, lagerort: Lagerort | null, ablaufAm: string | null): ImportEntwurf {
  return aendere(e, nr, (p) => ({ ...p, lagerort, ablauf_am: ablaufAm || null }));
}

/** Weiche Fragen (Menge, Übernehmen) mit den angezeigten Vorschlägen beantworten. */
export function vorschlaegeAnnehmen(e: ImportEntwurf): ImportEntwurf {
  return { ...e, positionen: e.positionen.map((p) => ({ ...p, beantwortet: plus(p, 'menge', 'uebernehmen') })) };
}

// ───────── Vorschau: Bestandsänderungen prüfen ─────────

export type VorschauZeile = {
  nrn: number[];
  sorte_id: number | null;
  name: string;
  neu: boolean;
  einheit: Einheit;
  vorher: number;
  aenderung: number;
  nachher: number;
  /** Kosten der neuen Charge(n); null = Preis unbekannt */
  kosten_cent: number | null;
  kosten_text: string;
  lagerort: Lagerort | null;
};

export type Vorschau = {
  hinzufuegen: VorschauZeile[];
  nicht_uebernommen: { nr: number; name: string; menge: string; grund: string }[];
  kein_lebensmittel: { nr: number; text: string; cent: number | null }[];
  pfand: { nr: number; text: string; cent: number }[];
  pfand_cent: number;
  offene_rabatte: { nr: number; text: string; cent: number }[];
  fragen: Rueckfrage[];
  pflicht_offen: number;
  kann_buchen: boolean;
  /** z. B. „7 Artikel hinzugefügt · 2 nicht übernommen“ */
  zusammenfassung: string;
  anzahl_hinzu: number;
  anzahl_nicht: number;
  /** Summe der bekannten Kosten der neuen Chargen */
  wert_cent: number;
  wert_unbekannt: number;
  fehler: string[];
  warnungen: string[];
};

/** Preis je Einheit lesbar: „1,49 € · 0,15 € / 100 g“ bzw. „1,48 € · 0,74 € / Stück“ */
function kostenText(cent: number | null, menge: number, einheit: Einheit): string {
  if (cent === null) return 'Preis unbekannt';
  const proEinheit = cent / Math.max(1, menge);
  const bezug = einheit === 'g' || einheit === 'ml'
    ? `${euroText(proEinheit * (menge >= 1000 ? 1000 : 100))} / ${menge >= 1000 ? (einheit === 'g' ? 'kg' : 'l') : `100 ${einheit}`}`
    : `${euroText(proEinheit)} / ${einheit === 'stueck' ? 'Stück' : 'Portion'}`;
  return `${euroText(cent)} · ${bezug}`;
}

function bruchText(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace('.', ',').replace(/,?0+$/, '');
}

export function vorschau(e: ImportEntwurf, k: Kontext): Vorschau {
  const zeilen = new Map<string, VorschauZeile>();
  const nicht: Vorschau['nicht_uebernommen'] = [];
  const keinLm: Vorschau['kein_lebensmittel'] = [];
  const pfand: Vorschau['pfand'] = [];
  const rabatte: Vorschau['offene_rabatte'] = [];
  const warnungen = [...e.bon.warnungen];
  const fehler: string[] = [];

  for (const p of e.positionen) {
    if (p.typ === 'pfand') {
      pfand.push({ nr: p.nr, text: p.bon.text, cent: p.bon.gesamtpreis_cent ?? 0 });
      continue;
    }
    if (p.typ === 'rabatt') {
      rabatte.push({ nr: p.nr, text: p.bon.text, cent: p.bon.gesamtpreis_cent ?? 0 });
      continue;
    }
    if (p.typ === 'nicht_lebensmittel') {
      keinLm.push({ nr: p.nr, text: p.bon.text, cent: p.bon.gesamtpreis_cent });
      continue;
    }
    const menge = bestandMenge(p);
    const einheit = einheitVonZiel(p.ziel, k.sorten) ?? 'stueck';
    const name = nameVonZiel(p.ziel, k.sorten, lesbarerName(p.bon.text));
    const nichtTeil = p.bon.anzahl - p.anzahl_uebernehmen;
    if (nichtTeil > 1e-9) {
      const teil = p.bon.gewicht_g !== null && p.menge_pro_einheit
        ? mengeText(Math.round(nichtTeil * p.menge_pro_einheit), einheit)
        : p.bon.packung
          ? `${bruchText(nichtTeil)} × ${mengeText(p.bon.packung.menge, p.bon.packung.einheit)}`
          : `${bruchText(nichtTeil)} ×`;
      nicht.push({ nr: p.nr, name, menge: teil, grund: grundText(p.grund, p.grund_text) });
    }
    if (menge <= 0) continue;

    const schluessel = p.ziel.art === 'sorte' ? `s${p.ziel.sorte_id}` : `n${normalisiere(name)}`;
    const sorte = p.ziel.art === 'sorte' ? k.sorten.find((s) => s.id === (p.ziel as { sorte_id: number }).sorte_id) : null;
    const kosten = kostenGebucht(p);
    const alt = zeilen.get(schluessel);
    if (alt) {
      alt.nrn.push(p.nr);
      alt.aenderung += menge;
      alt.nachher += menge;
      alt.kosten_cent = alt.kosten_cent === null || kosten === null ? null : alt.kosten_cent + kosten;
      alt.kosten_text = kostenText(alt.kosten_cent, alt.aenderung, einheit);
    } else {
      const vorher = sorte?.anzahl ?? 0;
      zeilen.set(schluessel, {
        nrn: [p.nr],
        sorte_id: sorte?.id ?? null,
        name,
        neu: p.ziel.art === 'neu',
        einheit,
        vorher,
        aenderung: menge,
        nachher: vorher + menge,
        kosten_cent: kosten,
        kosten_text: kostenText(kosten, menge, einheit),
        lagerort: p.lagerort ?? (p.ziel.art === 'neu' ? p.ziel.daten.lagerort : sorte?.lagerort ?? null),
      });
    }
  }

  // Neue Sorten: Namen müssen eindeutig sein – vorher sagen statt beim Buchen scheitern.
  const vorhandene = new Set(k.sorten.map((s) => normalisiere(s.name)));
  const neueNamen = new Map<string, number>();
  for (const p of e.positionen) {
    if (p.ziel.art !== 'neu' || bestandMenge(p) <= 0) continue;
    const n = normalisiere(p.ziel.daten.name);
    if (!p.ziel.daten.name.trim()) fehler.push(`Position ${p.nr}: Das neue Produkt braucht einen Namen.`);
    else if (vorhandene.has(n)) fehler.push(`„${p.ziel.daten.name}“ gibt es schon als Sorte – bitte auswählen statt neu anlegen.`);
    else if (neueNamen.has(n) && neueNamen.get(n) !== p.nr) {
      // gleicher neuer Name zweimal → beide Positionen auf dieselbe neue Sorte wäre doppelt angelegt
      fehler.push(`„${p.ziel.daten.name}“ soll zweimal neu angelegt werden – bitte eine Position umbenennen.`);
    }
    neueNamen.set(n, p.nr);
  }
  for (const p of e.positionen) for (const w of p.bon.warnungen) if (!/Rabatt konnte/.test(w)) warnungen.push(`${p.bon.text}: ${w}`);

  const fragen = alleFragen(e, k);
  const pflicht = fragen.filter((f) => f.pflicht).length;
  const hinzufuegen = [...zeilen.values()];
  const anzahlNicht = e.positionen.filter((p) => (p.typ === 'lebensmittel' || p.typ === 'unbekannt') && bestandMenge(p) === 0).length;
  const wert = hinzufuegen.reduce((s, z) => s + (z.kosten_cent ?? 0), 0);
  const artikel = (n: number) => (n === 1 ? '1 Artikel' : `${n} Artikel`);
  return {
    hinzufuegen,
    nicht_uebernommen: nicht,
    kein_lebensmittel: keinLm,
    pfand,
    pfand_cent: pfand.reduce((s, x) => s + x.cent, 0),
    offene_rabatte: rabatte,
    fragen,
    pflicht_offen: pflicht,
    kann_buchen: pflicht === 0 && fehler.length === 0 && e.positionen.length > 0,
    zusammenfassung: `${artikel(hinzufuegen.length)} hinzugefügt · ${anzahlNicht} nicht übernommen`,
    anzahl_hinzu: hinzufuegen.length,
    anzahl_nicht: anzahlNicht,
    wert_cent: rundeCent(wert),
    wert_unbekannt: hinzufuegen.filter((z) => z.kosten_cent === null).length,
    fehler,
    warnungen,
  };
}

// ───────── Buchungsdaten für bon_buchen() ─────────

export type BonBuchung = {
  quelle: ImportQuelle;
  quelle_ref: string | null;
  erkennung: string;
  fingerabdruck: string;
  haendler: string | null;
  filiale: string | null;
  kaufdatum: string | null;
  summe_cent: number | null;
  positionen: Record<string, unknown>[];
};

export function buchungsDaten(e: ImportEntwurf): BonBuchung {
  return {
    quelle: e.quelle,
    quelle_ref: e.quelle_ref,
    erkennung: e.erkennung,
    fingerabdruck: e.fingerabdruck,
    haendler: e.bon.haendler,
    filiale: e.bon.filiale,
    kaufdatum: e.bon.datum,
    summe_cent: e.bon.summe_cent,
    positionen: e.positionen.map((p) => {
      const menge = bestandMenge(p);
      const bester = p.zuordnung.kandidaten.find((c) => p.ziel.art === 'sorte' && c.sorte_id === p.ziel.sorte_id);
      const hinweis = [...p.hinweise].join(' · ').slice(0, 300) || null;
      return {
        nr: p.nr,
        bon_text: p.bon.text.slice(0, 200) || '?',
        schluessel: p.schluessel,
        typ: p.typ,
        anzahl: p.bon.anzahl,
        packung_menge: p.bon.packung?.menge ?? null,
        packung_einheit: p.bon.packung?.einheit ?? null,
        einzelpreis_cent: p.bon.einzelpreis_cent,
        gesamtpreis_cent: p.bon.gesamtpreis_cent,
        rabatt_cent: p.bon.rabatt_cent,
        block_typ_id: p.ziel.art === 'sorte' ? p.ziel.sorte_id : null,
        neu: p.ziel.art === 'neu' && menge > 0 ? p.ziel.daten : null,
        sicherheit: p.beantwortet.includes('zuordnung') ? 1 : bester?.sicherheit ?? null,
        menge_pro_einheit: p.menge_pro_einheit,
        bestand_menge: menge,
        grund: menge < (p.menge_pro_einheit ?? 0) * p.bon.anzahl || menge === 0 ? p.grund : null,
        grund_text: p.grund_text,
        hinweis,
        ablauf_am: menge > 0 ? p.ablauf_am : null,
        lagerort: menge > 0 ? p.lagerort : null,
      };
    }),
  };
}
