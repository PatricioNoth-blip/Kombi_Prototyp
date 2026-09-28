// Startseite: Was wurde heute gegessen (kcal, Kosten), was kostet der Haushalt – nur aus echten Daten.
// „Heute wichtig“ steht nicht mehr als große Liste auf dem Start; Ablauf und Reste steuern im Hintergrund
// die Vorschläge (Engine) und erscheinen hier höchstens als eine dezente Zeile.
//
// Geld wird nie doppelt gezählt:
//   • Ausgegeben  = was beim Einkauf tatsächlich bezahlt wurde (Einkaufsbuchungen mit Preis).
//   • Produktion  = Wert der verarbeiteten Zutaten – kein zusätzliches Geld, sie sind schon eingekauft.
//   • Gekocht     = Wert der entnommenen Mengen (aus den Kosten der entnommenen Chargen).
//   • Sonstiges   = von Hand eingetragene Ausgaben ohne Bezug zum Vorrat (Kaffee, bestellt …).
// Nur Einkäufe und Sonstiges sind Geld, das den Haushalt verlassen hat; Produktion und Gekocht sind Warenwert.
import type { KomponentenVorschlag } from '../supabase/functions/_shared/kombi/typen.ts';
import type { Sorte } from './api';
import { tageBis, zustand } from './dashboard.ts';

export type EinkaufsBuchung = { erstellt_am: string; preis_cent: number | null; rueckgaengig: boolean };
export type HerstellungsZeile = { datum: string; kosten_cent: number | null; kosten_unbekannt: number; rueckgaengig: boolean };
export type SonstigeAusgabe = { id?: number; datum: string; betrag_cent: number; notiz?: string | null; entfernt: boolean };
export type MahlzeitZeile = {
  datum: string; titel: string; portionen: number;
  kosten_cent: number | null; kosten_unbekannt: number; kcal: number | null; kcal_unbekannt: number; rueckgaengig: boolean;
  /** Zeitpunkt der Buchung – für Frühstück/Mittag/Abend (fehlt bei älteren Daten) */
  erstellt_am?: string;
};

export type Monatsbilanz = {
  monat: string;
  /** Einkäufe + Sonstiges – nur echtes Geld, kein Warenwert */
  gesamt_cent: number;
  /** tatsächlich bezahlt; ohne_preis = Einkäufe, bei denen kein Preis angegeben wurde */
  ausgegeben: { cent: number; anzahl: number; ohne_preis: number };
  sonstiges: { cent: number; anzahl: number };
  /** Vormonat bis zum gleichen Tag – null, wenn es dort keine Ausgaben gab (dann kein Vergleich) */
  vormonat: { cent: number; bis_tag: number; aenderung_prozent: number } | null;
  /** Warenwert der verarbeiteten Zutaten; vollstaendig = alle Preise bekannt */
  produktion: { cent: number; anzahl: number; vollstaendig: boolean };
  /** Warenwert der gekochten Mahlzeiten; Ø nur, wenn für jede Mahlzeit alles bekannt ist */
  gekocht: { cent: number; anzahl: number; vollstaendig: boolean; pro_mahlzeit_cent: number | null };
  leer: boolean;
};

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Zeitstempel → Kalendertag in der Zeitzone des Geräts */
export function lokalesDatum(zeitstempel: string): string {
  const d = new Date(zeitstempel);
  if (Number.isNaN(d.getTime())) return zeitstempel.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Erster Tag des Vormonats (YYYY-MM-DD) */
export function vormonatsanfang(heute: string): string {
  const j = Number(heute.slice(0, 4));
  const m = Number(heute.slice(5, 7));
  return m === 1 ? `${j - 1}-12-01` : `${j}-${String(m - 1).padStart(2, '0')}-01`;
}

export function monatsbilanz(
  d: { einkaeufe: EinkaufsBuchung[]; herstellungen: HerstellungsZeile[]; mahlzeiten: MahlzeitZeile[]; sonstige?: SonstigeAusgabe[] },
  heute: string,
): Monatsbilanz {
  const monat = heute.slice(0, 7);
  const imMonat = (datum: string) => datum.slice(0, 7) === monat;
  const einkaeufe = d.einkaeufe.filter((e) => !e.rueckgaengig && imMonat(lokalesDatum(e.erstellt_am)));
  const sonstige = (d.sonstige ?? []).filter((a) => !a.entfernt && imMonat(a.datum));

  // Vergleich fair: Vormonat nur bis zum gleichen Tag (am 28. also 1.–28. des Vormonats)
  const vm = vormonatsanfang(heute).slice(0, 7);
  const tag = Number(heute.slice(8, 10));
  const imVormonat = (datum: string) => datum.slice(0, 7) === vm && Number(datum.slice(8, 10)) <= tag;
  const vorEinkauf = d.einkaeufe.filter((e) => !e.rueckgaengig && e.preis_cent !== null && imVormonat(lokalesDatum(e.erstellt_am)));
  const vorSonst = (d.sonstige ?? []).filter((a) => !a.entfernt && imVormonat(a.datum));
  const vorCent = vorEinkauf.reduce((s, e) => s + (e.preis_cent ?? 0), 0) + vorSonst.reduce((s, a) => s + a.betrag_cent, 0);
  const herst = d.herstellungen.filter((h) => !h.rueckgaengig && imMonat(h.datum));
  const mahl = d.mahlzeiten.filter((m) => !m.rueckgaengig && imMonat(m.datum));
  const summe = (xs: { kosten_cent: number | null }[]) => xs.reduce((s, x) => s + (x.kosten_cent ?? 0), 0);
  const vollstaendig = (xs: { kosten_cent: number | null; kosten_unbekannt: number }[]) =>
    xs.every((x) => x.kosten_cent !== null && x.kosten_unbekannt === 0);
  const gekochtCent = summe(mahl);
  const gekochtVoll = vollstaendig(mahl);
  const einkaufCent = einkaeufe.reduce((s, e) => s + (e.preis_cent ?? 0), 0);
  const sonstCent = sonstige.reduce((s, a) => s + a.betrag_cent, 0);
  const gesamt = einkaufCent + sonstCent;
  return {
    monat: MONATE[Number(monat.slice(5, 7)) - 1] ?? '',
    gesamt_cent: gesamt,
    ausgegeben: {
      cent: einkaufCent,
      anzahl: einkaeufe.length,
      ohne_preis: einkaeufe.filter((e) => e.preis_cent === null).length,
    },
    sonstiges: { cent: sonstCent, anzahl: sonstige.length },
    vormonat: vorCent > 0 ? { cent: vorCent, bis_tag: tag, aenderung_prozent: Math.round(((gesamt - vorCent) / vorCent) * 100) } : null,
    produktion: { cent: summe(herst), anzahl: herst.length, vollstaendig: vollstaendig(herst) },
    gekocht: {
      cent: gekochtCent,
      anzahl: mahl.length,
      vollstaendig: gekochtVoll,
      pro_mahlzeit_cent: mahl.length && gekochtVoll ? Math.round(gekochtCent / mahl.length) : null,
    },
    leer: einkaeufe.length + herst.length + mahl.length + sonstige.length === 0,
  };
}

/** Heute Gekochtes – kcal nur, wenn sie für alles bekannt sind. */
export function heuteGekocht(mahlzeiten: MahlzeitZeile[], heute: string): { titel: string[]; kcal: number | null; vollstaendig: boolean } {
  const m = mahlzeiten.filter((x) => !x.rueckgaengig && x.datum === heute);
  const voll = m.length > 0 && m.every((x) => x.kcal !== null && x.kcal_unbekannt === 0);
  return { titel: m.map((x) => x.titel), kcal: voll ? m.reduce((s, x) => s + (x.kcal as number), 0) : null, vollstaendig: voll };
}

/** Muss heute gehandelt werden? (abgelaufen, aufgetaut, läuft heute/morgen ab, Auftauen fällig) */
export function dringendHeute(bestand: Sorte[], heute: string, auftauenFaellig: number): boolean {
  if (auftauenFaellig > 0) return true;
  return bestand.some((s) => {
    const z = zustand(s, heute);
    if (!z) return false;
    if (z.art === 'abgelaufen' || z.art === 'aufgetaut') return true;
    return z.art === 'bald' && !!s.naechster_ablauf && tageBis(heute, s.naechster_ablauf) <= 1;
  });
}

export type StartAbschnitt = 'heute' | 'hinweis' | 'auftauen' | 'essen' | 'monat' | 'kacheln';

/**
 * Reihenfolge der kompakten Startseite: Heute (kcal, Kosten) → höchstens ein dezenter Hinweis →
 * Auftauen, wenn heute fällig → Was essen wir? → Monat → Produktion | Einkauf.
 * Leere Teile entfallen; „Was essen wir?“ und die beiden Kacheln bleiben immer.
 */
export function startAbschnitte(k: { hinweis: boolean; auftauen: boolean; monat: boolean }): StartAbschnitt[] {
  const folge: StartAbschnitt[] = ['heute', 'hinweis', 'auftauen', 'essen', 'monat', 'kacheln'];
  return folge.filter((a) => (a !== 'hinweis' || k.hinweis) && (a !== 'auftauen' || k.auftauen) && (a !== 'monat' || k.monat));
}

export type Status = 'berechnet' | 'teilweise' | 'unbekannt' | 'leer';

export type Tagesuebersicht = {
  mahlzeiten: number;
  /** kcal pro Person (Mahlzeit ÷ Portionen), Summe der bekannten; null = keine bekannt */
  kcal: number | null;
  kcal_status: Status;
  /** Essenskosten heute: Warenwert der gekochten Mahlzeiten + sonstige Ausgaben von heute */
  kosten_cent: number | null;
  kosten_status: Status;
  mahlzeit_arten: { fruehstueck: boolean; mittag: boolean; abend: boolean };
  /** persönliches Tagesziel (optional) und Anteil 0…1 – nur, wenn die kcal vollständig bekannt sind */
  ziel: number | null;
  anteil: number | null;
};

/** Frühstück vor 11 Uhr, Mittag bis 16 Uhr, danach Abendessen (Gerätezeit). */
export function mahlzeitArt(zeitstempel: string | undefined): 'fruehstueck' | 'mittag' | 'abend' | null {
  if (!zeitstempel) return null;
  const d = new Date(zeitstempel);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  return h < 11 ? 'fruehstueck' : h < 16 ? 'mittag' : 'abend';
}

/**
 * Der Tag in Zahlen – nur aus protokollierten Mahlzeiten und eingetragenen Ausgaben.
 * Kalorien kommen aus hinterlegten Nährwerten der TATSÄCHLICH entnommenen Mengen (essen() in der DB):
 * Eine gegessene Portion Tomaten-Basis zählt mit ihren eigenen kcal – die Tomaten darin nicht noch einmal.
 * Unbekannt bleibt unbekannt: „teilweise“ heißt „mindestens“, nie geschätzt.
 */
export function tagesuebersicht(
  mahlzeiten: MahlzeitZeile[], sonstige: SonstigeAusgabe[], heute: string, ziel: number | null = null,
): Tagesuebersicht {
  const m = mahlzeiten.filter((x) => !x.rueckgaengig && x.datum === heute);
  const s = sonstige.filter((a) => !a.entfernt && a.datum === heute);
  const kcalBekannt = m.filter((x) => x.kcal !== null);
  const kcal = kcalBekannt.length ? Math.round(kcalBekannt.reduce((sum, x) => sum + (x.kcal as number) / Math.max(1, x.portionen), 0)) : null;
  const kcalVoll = m.length > 0 && m.every((x) => x.kcal !== null && x.kcal_unbekannt === 0);
  const kcal_status: Status = m.length === 0 ? 'leer' : kcalVoll ? 'berechnet' : kcal !== null ? 'teilweise' : 'unbekannt';
  const kostenBekannt = m.filter((x) => x.kosten_cent !== null);
  const kostenVoll = m.every((x) => x.kosten_cent !== null && x.kosten_unbekannt === 0);
  const kosten = kostenBekannt.reduce((sum, x) => sum + (x.kosten_cent as number), 0) + s.reduce((sum, a) => sum + a.betrag_cent, 0);
  const kosten_status: Status = m.length + s.length === 0 ? 'leer' : kostenVoll ? 'berechnet' : kostenBekannt.length || s.length ? 'teilweise' : 'unbekannt';
  const arten = new Set(m.map((x) => mahlzeitArt(x.erstellt_am)));
  const zielOk = ziel !== null && Number.isFinite(ziel) && ziel >= 500 && ziel <= 8000 ? Math.round(ziel) : null;
  return {
    mahlzeiten: m.length,
    kcal,
    kcal_status,
    kosten_cent: kosten_status === 'leer' || kosten_status === 'unbekannt' ? null : kosten,
    kosten_status,
    mahlzeit_arten: { fruehstueck: arten.has('fruehstueck'), mittag: arten.has('mittag'), abend: arten.has('abend') },
    ziel: zielOk,
    anteil: zielOk !== null && kcal !== null && kcal_status === 'berechnet' ? Math.min(1.5, kcal / zielOk) : null,
  };
}

/**
 * Höchstens EINE dezente Zeile statt „Heute wichtig“-Kacheln: „1 abgelaufen · 2 bald verbrauchen“.
 * Knapp werdende Sorten gehören in den Einkauf, nicht hierher. null = nichts zu sagen.
 */
export function startHinweis(bestand: Sorte[], heute: string): string | null {
  let abgelaufen = 0;
  let bald = 0;
  for (const s of bestand) {
    const z = zustand(s, heute);
    if (!z) continue;
    if (z.art === 'abgelaufen') abgelaufen++;
    else if (z.art !== 'niedrig') bald++;
  }
  const teile = [
    abgelaufen ? `${abgelaufen} abgelaufen` : null,
    bald ? `${bald} Lebensmittel bald verbrauchen` : null,
  ].filter(Boolean);
  return teile.length ? teile.join(' · ') : null;
}

/** „Guten Morgen“ … abhängig von der Uhrzeit */
export function gruss(stunde: number): string {
  if (stunde >= 5 && stunde < 11) return 'Guten Morgen';
  if (stunde >= 11 && stunde < 17) return 'Guten Tag';
  if (stunde >= 17 && stunde < 23) return 'Guten Abend';
  return 'Gute Nacht';
}

export type ProduktionsTipp =
  | { art: 'vorgemerkt'; plan_id: string; titel: string; portionen: number; grund: string }
  | { art: 'idee'; komponente: KomponentenVorschlag; grund: string };

/**
 * Ist heute eine Produktion sinnvoll? Nur wenn ja – sonst null (kein Füllmaterial):
 *   1. Vorgemerkte Komponente, für die alles da ist.
 *   2. Idee, die Dringendes verwertet und für die nichts eingekauft werden muss.
 */
export function sinnvolleProduktion(
  vorgemerkt: { plan_id: string; titel: string; portionen: number; alles_da: boolean }[],
  ideen: KomponentenVorschlag[],
): ProduktionsTipp | null {
  const bereit = vorgemerkt.find((v) => v.alles_da);
  if (bereit) return { art: 'vorgemerkt', ...bereit, grund: 'Alles da – vorgemerkt' };
  const idee = ideen.find((k) => k.typ === 'verwerten' && k.verwertet.length > 0);
  if (idee) return { art: 'idee', komponente: idee, grund: `Verwertet ${idee.verwertet.slice(0, 2).join(' und ')}` };
  return null;
}
