// Startseite: Vorschläge, was heute gegessen wurde (kcal) und der Überblick – nur aus echten Daten.
// Ablauf und Reste steuern im Hintergrund die Vorschläge (Engine) und erscheinen hier höchstens als eine Zeile.
import type { Gericht, KomponentenVorschlag } from '../supabase/functions/_shared/kombi/typen.ts';
import type { Sorte } from './api';
import { istDringend, tageBis, zustand, type Wichtig } from './dashboard.ts';

export type HerstellungsZeile = {
  datum: string; rueckgaengig: boolean;
  /** für den Verlauf in „Produktion“ (fehlt bei älteren Abfragen) */
  block_typ_id?: number; menge?: number; erstellt_am?: string;
};
export type MahlzeitZeile = {
  datum: string; titel: string; portionen: number;
  kcal: number | null; kcal_unbekannt: number; rueckgaengig: boolean;
  /** Zeitpunkt der Buchung – für Frühstück/Mittag/Abend (fehlt bei älteren Daten) */
  erstellt_am?: string;
};

/** Erster Tag des Vormonats (YYYY-MM-DD) – ab hier lädt die App Verlauf und Mahlzeiten */
export function vormonatsanfang(heute: string): string {
  const j = Number(heute.slice(0, 4));
  const m = Number(heute.slice(5, 7));
  return m === 1 ? `${j - 1}-12-01` : `${j}-${String(m - 1).padStart(2, '0')}-01`;
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

export type StartAbschnitt = 'essen' | 'auftauen' | 'willkommen' | 'ueberblick';

/**
 * Reihenfolge der Startseite: erst der Nutzen („Was möchtest du heute kochen?“ mit einem großen
 * Vorschlag und „Jetzt kochen“), dann – nur wenn heute fällig – Auftauen, für neue Nutzer eine kurze
 * Erklärung, und ganz unten der Überblick (Vorrat, Einkauf, Produktion, Heute gegessen) als ruhige Liste.
 * Kennzahlen stehen nie über dem Vorschlag.
 */
export function startAbschnitte(k: { auftauen: boolean; willkommen: boolean }): StartAbschnitt[] {
  const folge: StartAbschnitt[] = ['essen', 'auftauen', 'willkommen', 'ueberblick'];
  return folge.filter((a) => (a !== 'auftauen' || k.auftauen) && (a !== 'willkommen' || k.willkommen));
}

export type StartVorschlag = { g: Gericht; planId: string | null };

/**
 * Vorschläge für den Start: für heute (oder früher) Geplantes zuerst, dann Ideen aus dem freien Vorrat –
 * ohne was heute schon gekocht wurde und ohne doppelte Namen. Der erste ist der große Vorschlag.
 */
export function startVorschlaege(
  plaene: { id: string; art: string; datum: string | null; daten: { gericht?: Gericht } }[],
  ideen: Gericht[],
  heuteGekochtTitel: string[],
  heute: string,
  anzahl = 3,
): StartVorschlag[] {
  const geplant = plaene
    .filter((p) => p.art === 'mahlzeit' && p.daten.gericht && p.datum !== null && p.datum <= heute)
    .sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? ''))
    .map((p) => ({ g: p.daten.gericht!, planId: p.id as string | null }));
  const gekocht = new Set(heuteGekochtTitel.map((t) => t.trim().toLocaleLowerCase('de-DE')));
  const alle = [...geplant, ...ideen.filter((g) => !gekocht.has(g.name.trim().toLocaleLowerCase('de-DE'))).map((g) => ({ g, planId: null }))];
  const gesehen = new Set<string>();
  return alle.filter((v) => {
    const k = v.g.name.trim().toLocaleLowerCase('de-DE');
    if (gesehen.has(k)) return false;
    gesehen.add(k);
    return true;
  }).slice(0, anzahl);
}

export type Status = 'berechnet' | 'teilweise' | 'unbekannt' | 'leer';

export type Tagesuebersicht = {
  mahlzeiten: number;
  /** kcal pro Person (Mahlzeit ÷ Portionen), Summe der bekannten; null = keine bekannt */
  kcal: number | null;
  kcal_status: Status;
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
 * Der Tag in Zahlen – nur aus protokollierten Mahlzeiten.
 * Kalorien kommen aus hinterlegten Nährwerten der TATSÄCHLICH entnommenen Mengen (essen() in der DB):
 * Eine gegessene Portion Tomaten-Basis zählt mit ihren eigenen kcal – die Tomaten darin nicht noch einmal.
 * Unbekannt bleibt unbekannt: „teilweise“ heißt „mindestens“, nie geschätzt.
 */
export function tagesuebersicht(mahlzeiten: MahlzeitZeile[], heute: string, ziel: number | null = null): Tagesuebersicht {
  const m = mahlzeiten.filter((x) => !x.rueckgaengig && x.datum === heute);
  const kcalBekannt = m.filter((x) => x.kcal !== null);
  const kcal = kcalBekannt.length ? Math.round(kcalBekannt.reduce((sum, x) => sum + (x.kcal as number) / Math.max(1, x.portionen), 0)) : null;
  const kcalVoll = m.length > 0 && m.every((x) => x.kcal !== null && x.kcal_unbekannt === 0);
  const kcal_status: Status = m.length === 0 ? 'leer' : kcalVoll ? 'berechnet' : kcal !== null ? 'teilweise' : 'unbekannt';
  const arten = new Set(m.map((x) => mahlzeitArt(x.erstellt_am)));
  const zielOk = ziel !== null && Number.isFinite(ziel) && ziel >= 500 && ziel <= 8000 ? Math.round(ziel) : null;
  return {
    mahlzeiten: m.length,
    kcal,
    kcal_status,
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
    else if (istDringend(z)) bald++;
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
 * Eine Zeile „Produktion“ für den Überblick auf dem Start – aus denselben Daten wie der Bereich
 * Produktion: Selbstgemachtes, das aufgebraucht ist oder knapp wird, zuerst; dann was vorgemerkt und
 * startklar ist oder Dringendes verwertet; sonst ehrlich „gerade nichts nötig“.
 */
export function produktionsZeile(knapp: Wichtig[], tipp: ProduktionsTipp | null, vorgemerkt: number): { text: string; achtung: boolean } {
  // knapp ist sortiert: aufgebraucht vor „wird knapp“; „(+2)“ = weitere Sorten, die nachgekocht werden sollten
  const mehr = knapp.length > 1 ? ` (+${knapp.length - 1})` : '';
  if (knapp[0]?.art === 'leer') return { text: `${knapp[0].sorte.name} aufgebraucht – nachkochen${mehr}`, achtung: true };
  if (knapp.length) return { text: `${knapp[0].sorte.name} wird knapp${mehr}`, achtung: true };
  if (tipp?.art === 'vorgemerkt') return { text: `${tipp.titel}: alles da zum Vorkochen`, achtung: false };
  if (tipp?.art === 'idee') return { text: `Idee: ${tipp.komponente.name}`, achtung: false };
  if (vorgemerkt > 0) return { text: `${vorgemerkt} vorgemerkt`, achtung: false };
  return { text: 'Gerade nichts nötig', achtung: false };
}

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
