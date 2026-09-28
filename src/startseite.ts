// Startseite: Was ist heute wichtig, was kostet der Haushalt – nur aus echten Daten.
//
// Geld wird nie doppelt gezählt:
//   • Ausgegeben  = was beim Einkauf tatsächlich bezahlt wurde (Einkaufsbuchungen mit Preis).
//   • Produktion  = Wert der verarbeiteten Zutaten – kein zusätzliches Geld, sie sind schon eingekauft.
//   • Gekocht     = Wert der entnommenen Mengen (aus den Kosten der entnommenen Chargen).
// Nur „Ausgegeben“ ist Geld, das den Haushalt verlassen hat; die anderen beiden sind Warenwert.
import type { KomponentenVorschlag } from '../supabase/functions/_shared/kombi/typen.ts';
import type { Sorte } from './api';
import { tageBis, zustand } from './dashboard.ts';

export type EinkaufsBuchung = { erstellt_am: string; preis_cent: number | null; rueckgaengig: boolean };
export type HerstellungsZeile = { datum: string; kosten_cent: number | null; kosten_unbekannt: number; rueckgaengig: boolean };
export type MahlzeitZeile = {
  datum: string; titel: string; portionen: number;
  kosten_cent: number | null; kosten_unbekannt: number; kcal: number | null; kcal_unbekannt: number; rueckgaengig: boolean;
};

export type Monatsbilanz = {
  monat: string;
  /** tatsächlich bezahlt; ohne_preis = Einkäufe, bei denen kein Preis angegeben wurde */
  ausgegeben: { cent: number; anzahl: number; ohne_preis: number };
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

export function monatsbilanz(
  d: { einkaeufe: EinkaufsBuchung[]; herstellungen: HerstellungsZeile[]; mahlzeiten: MahlzeitZeile[] },
  heute: string,
): Monatsbilanz {
  const monat = heute.slice(0, 7);
  const imMonat = (datum: string) => datum.slice(0, 7) === monat;
  const einkaeufe = d.einkaeufe.filter((e) => !e.rueckgaengig && imMonat(lokalesDatum(e.erstellt_am)));
  const herst = d.herstellungen.filter((h) => !h.rueckgaengig && imMonat(h.datum));
  const mahl = d.mahlzeiten.filter((m) => !m.rueckgaengig && imMonat(m.datum));
  const summe = (xs: { kosten_cent: number | null }[]) => xs.reduce((s, x) => s + (x.kosten_cent ?? 0), 0);
  const vollstaendig = (xs: { kosten_cent: number | null; kosten_unbekannt: number }[]) =>
    xs.every((x) => x.kosten_cent !== null && x.kosten_unbekannt === 0);
  const gekochtCent = summe(mahl);
  const gekochtVoll = vollstaendig(mahl);
  return {
    monat: MONATE[Number(monat.slice(5, 7)) - 1] ?? '',
    ausgegeben: {
      cent: einkaeufe.reduce((s, e) => s + (e.preis_cent ?? 0), 0),
      anzahl: einkaeufe.length,
      ohne_preis: einkaeufe.filter((e) => e.preis_cent === null).length,
    },
    produktion: { cent: summe(herst), anzahl: herst.length, vollstaendig: vollstaendig(herst) },
    gekocht: {
      cent: gekochtCent,
      anzahl: mahl.length,
      vollstaendig: gekochtVoll,
      pro_mahlzeit_cent: mahl.length && gekochtVoll ? Math.round(gekochtCent / mahl.length) : null,
    },
    leer: einkaeufe.length + herst.length + mahl.length === 0,
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

export type StartAbschnitt = 'wichtig' | 'essen' | 'geld' | 'produktion' | 'einkauf';

/**
 * Reihenfolge der Startseite: Heute → Essen → Vorratsprobleme → Geld → Produktion → Einkauf.
 * Ist heute etwas dringend, steht „Heute wichtig“ ganz oben; leere Bereiche entfallen.
 */
export function startReihenfolge(k: { dringend: boolean; wichtig: number; produktion: boolean; einkauf: boolean; geld: boolean }): StartAbschnitt[] {
  const folge: StartAbschnitt[] = k.dringend ? ['wichtig', 'essen'] : ['essen', 'wichtig'];
  folge.push('geld', 'produktion', 'einkauf');
  return folge.filter((a) =>
    (a !== 'wichtig' || k.wichtig > 0) && (a !== 'produktion' || k.produktion) && (a !== 'einkauf' || k.einkauf) && (a !== 'geld' || k.geld));
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
