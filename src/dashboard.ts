// Vorrat als Haushalts-Übersicht: Was ist heute wichtig, was liegt wo, wie voll ist es?
// Reine Berechnungen aus den echten Bestandsdaten – nichts wird geschätzt.
import type { Farbe, KomponentenVorschlag } from '../supabase/functions/_shared/kombi/typen.ts';
import { normalisiere } from '../supabase/functions/_shared/kombi/text.ts';
import { bausteineFuerName } from '../supabase/functions/_shared/kombi/grundbausteine.ts';
import type { Sorte } from './api';
import { GRUPPEN, type GruppeId } from './farben.ts';
import { artVon, einheitVon, mengeText, portionenVon } from './format.ts';
import type { VorratOrt } from './navigation.ts';

/**
 * Zustände einer Sorte, vom dringendsten an:
 *   abgelaufen, aufgetaut, geöffnet, läuft bald ab → jetzt verbrauchen (sonst wird es weggeworfen)
 *   leer („aufgebraucht“)  → nichts mehr da, obwohl ein Mindestbestand gewünscht ist
 *   niedrig („wird knapp“) → noch etwas da, aber weniger als der Mindestbestand
 */
export type WichtigArt = 'abgelaufen' | 'aufgetaut' | 'geoeffnet' | 'bald' | 'leer' | 'niedrig';
export type Wichtig = { sorte: Sorte; art: WichtigArt; titel: string; text: string };

const REIHENFOLGE: WichtigArt[] = ['abgelaufen', 'aufgetaut', 'geoeffnet', 'bald', 'leer', 'niedrig'];

/** Muss bald gegessen werden (sonst Verschwendung)? „Aufgebraucht“ und „wird knapp“ gehören zum Einkauf. */
export const istDringend = (w: Pick<Wichtig, 'art'> | null | undefined): boolean =>
  !!w && (w.art === 'abgelaufen' || w.art === 'aufgetaut' || w.art === 'geoeffnet' || w.art === 'bald');

/** Tage von heute bis zum Datum (negativ = vorbei). Beide als YYYY-MM-DD. */
export function tageBis(heute: string, iso: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(iso) - t(heute)) / 86_400_000);
}

function ablauf(heute: string, iso: string): string {
  const t = tageBis(heute, iso);
  if (t < 0) return t === -1 ? 'seit gestern abgelaufen' : `seit ${-t} Tagen abgelaufen`;
  if (t === 0) return 'läuft heute ab';
  if (t === 1) return 'läuft morgen ab';
  return `noch ${t} Tage`;
}

/** Der wichtigste Zustand einer Sorte – oder null, wenn alles in Ordnung ist. */
export function zustand(s: Sorte, heute: string): Wichtig | null {
  const e = einheitVon(s);
  if ((s.abgelaufen ?? 0) > 0) {
    return { sorte: s, art: 'abgelaufen', titel: 'Abgelaufen', text: `${mengeText(s.abgelaufen!, e)} – bitte prüfen` };
  }
  if (s.anzahl > 0 && (s.aufgetaut ?? 0) > 0) {
    return { sorte: s, art: 'aufgetaut', titel: 'Aufgetaut', text: `${mengeText(Math.min(s.aufgetaut!, s.anzahl), e)} – bald verbrauchen` };
  }
  if (s.anzahl > 0 && (s.geoeffnet ?? 0) > 0) {
    return { sorte: s, art: 'geoeffnet', titel: 'Geöffnet', text: 'zuerst verbrauchen' };
  }
  if (s.anzahl > 0 && s.bald_ablaufen) {
    return { sorte: s, art: 'bald', titel: 'Läuft bald ab', text: s.naechster_ablauf ? ablauf(heute, s.naechster_ablauf) : 'bald verbrauchen' };
  }
  if (s.nachkochen) {
    const was = artVon(s) === 'zutat' ? 'nachkaufen' : 'nachkochen';
    if (s.anzahl <= 0) return { sorte: s, art: 'leer', titel: 'Aufgebraucht', text: was };
    return { sorte: s, art: 'niedrig', titel: 'Wird knapp', text: `nur noch ${mengeText(s.anzahl, e)} · ${was}` };
  }
  return null;
}

export type VorratsLage = { artikel: number; abgelaufen: number; bald: number; knapp: number; aufgebraucht: number };

/** Zahlen für „Dein Vorrat“ – dieselben auf dem Start, im Vorrat, in Produktion und Einkauf. */
export function vorratsLage(bestand: Sorte[], heute: string): VorratsLage {
  const l: VorratsLage = { artikel: 0, abgelaufen: 0, bald: 0, knapp: 0, aufgebraucht: 0 };
  for (const s of bestand) {
    if (s.anzahl > 0) l.artikel++;
    const z = zustand(s, heute);
    if (!z) continue;
    if (z.art === 'abgelaufen') l.abgelaufen++;
    else if (istDringend(z)) l.bald++;
    else if (z.art === 'leer') l.aufgebraucht++;
    else l.knapp++;
  }
  return l;
}

/** „2 bald verbrauchen · 1 wird knapp · 1 aufgebraucht“ – oder null, wenn alles gut ist. */
export function vorratsLageText(l: VorratsLage): string | null {
  const teile = [
    l.abgelaufen ? `${l.abgelaufen} abgelaufen` : null,
    l.bald ? `${l.bald} bald verbrauchen` : null,
    l.knapp ? `${l.knapp} ${l.knapp === 1 ? 'wird' : 'werden'} knapp` : null,
    l.aufgebraucht ? `${l.aufgebraucht} aufgebraucht` : null,
  ].filter(Boolean);
  return teile.length ? teile.join(' · ') : null;
}

/**
 * Selbstgemachtes (Komponenten, Komplettgerichte) unter dem Mindestbestand: gehört in die Produktion
 * („nachkochen“). Zutaten unter dem Mindestbestand stehen im Einkauf (mangelVorschlaege).
 */
export function nachzukochen(bestand: Sorte[], heute: string): Wichtig[] {
  return bestand
    .filter((s) => artVon(s) !== 'zutat')
    .map((s) => zustand(s, heute))
    .filter((w): w is Wichtig => !!w && (w.art === 'leer' || w.art === 'niedrig'))
    .sort((a, b) => REIHENFOLGE.indexOf(a.art) - REIHENFOLGE.indexOf(b.art) || a.sorte.name.localeCompare(b.sorte.name, 'de'));
}

/** „Heute wichtig“: jede Sorte höchstens einmal, mit ihrem dringendsten Zustand. */
export function heuteWichtig(bestand: Sorte[], heute: string): Wichtig[] {
  return bestand
    .map((s) => zustand(s, heute))
    .filter((w): w is Wichtig => w !== null)
    .sort((a, b) => REIHENFOLGE.indexOf(a.art) - REIHENFOLGE.indexOf(b.art) || a.sorte.name.localeCompare(b.sorte.name, 'de'));
}

export type OrtKachel = {
  id: 'gefrierfach' | 'kuehlschrank' | 'vorrat';
  /** Gefrierfach: Portionen, sonst Artikel (Sorten mit Bestand) */
  zahl: number;
  einheit: string;
  sorten: number;
  leer: number;
  /** Anteile der Kombi-Farben (für den Farbbalken) */
  farben: { farbe: Farbe; anteil: number }[];
  /** Sorten mit „Heute wichtig“ */
  achtung: number;
};

const FARB_REIHE: Farbe[] = ['rot', 'braun', 'gruen', 'gelb', 'weiss', 'schwarz', 'blau'];

export function ortKacheln(bestand: Sorte[], heute: string): OrtKachel[] {
  return (['gefrierfach', 'kuehlschrank', 'vorrat'] as const).map((id) => {
    const alle = bestand.filter((s) => (s.lagerort ?? 'gefrierfach') === id);
    const da = alle.filter((s) => s.anzahl > 0);
    const portionen = id === 'gefrierfach';
    const zahl = portionen ? Math.floor(da.reduce((n, s) => n + portionenVon(s), 0)) : da.length;
    const gewicht = new Map<Farbe, number>();
    for (const s of da) gewicht.set(s.farbe, (gewicht.get(s.farbe) ?? 0) + (portionen ? Math.max(0.5, portionenVon(s)) : 1));
    const summe = [...gewicht.values()].reduce((a, b) => a + b, 0);
    return {
      id,
      zahl,
      einheit: portionen ? (zahl === 1 ? 'Portion' : 'Portionen') : 'Artikel',
      sorten: alle.length,
      leer: alle.length - da.length,
      farben: FARB_REIHE.filter((f) => gewicht.has(f)).map((f) => ({ farbe: f, anteil: gewicht.get(f)! / summe })),
      achtung: alle.filter((s) => istDringend(zustand(s, heute))).length,
    };
  });
}

/** Füllstand für Balken und „6 / 8 Portionen“: bezogen auf die Startmenge der aktuellen Chargen. */
export function fuellstand(s: Sorte): { anteil: number; text: string } | null {
  const e = einheitVon(s);
  const begrenzt = (x: number) => Math.max(0, Math.min(1, x));
  if (s.start_menge && s.start_menge > 0) {
    return { anteil: begrenzt(s.anzahl / s.start_menge), text: `${s.anzahl} / ${mengeText(s.start_menge, e)}` };
  }
  if (s.mindestbestand > 0) {
    return { anteil: begrenzt(s.anzahl / (2 * s.mindestbestand)), text: `${mengeText(s.anzahl, e)} · mind. ${s.mindestbestand}` };
  }
  return null;
}

/** „Äpfel“ → „apfel“: Umlaute ohne Punkte (normalisiere() schreibt sie aus: „aepfel“) */
const ohnePunkte = (t: string) => normalisiere(t.normalize('NFD').replace(/[̀-ͯ]/g, ''));

/**
 * Suche in Name und Zusammensetzung (ohne Groß/klein; „apfel“, „äpfel“ und „aepfel“ finden „Äpfel“).
 * Dazu gleichbedeutende Namen über die Grundbausteine: „Pasta“ findet „Nudeln“, „Basmati“ findet „Reis“.
 */
export function passtZuSuche(s: Sorte, suche: string): boolean {
  if (!normalisiere(suche)) return true;
  const text = [s.name, ...(s.zusammensetzung ?? [])].join(' ');
  if (normalisiere(text).includes(normalisiere(suche)) || ohnePunkte(text).includes(ohnePunkte(suche))) return true;
  const gesucht = bausteineFuerName(suche).map((b) => b.id);
  return gesucht.length > 0 && bausteineFuerName(s.name, s.farbe).some((b) => gesucht.includes(b.id));
}

const GRUPPE_NACH_FARBE: Record<Farbe, GruppeId> = {
  rot: 'basis', braun: 'protein', gruen: 'gemuese', gelb: 'sattmacher', blau: 'fertig', weiss: 'extras', schwarz: 'extras',
};

/** Obergruppe einer Sorte: Komplettgerichte sind Fertiggerichte, sonst entscheidet die Kombi-Farbe. */
export function gruppeVon(s: Pick<Sorte, 'art' | 'farbe' | 'lagerort' | 'name'>): GruppeId {
  return artVon(s) === 'komplettgericht' ? 'fertig' : GRUPPE_NACH_FARBE[s.farbe] ?? 'extras';
}

export type GruppenKachel = {
  id: GruppeId;
  /** Sorten der Gruppe (auch leere) */
  sorten: number;
  /** davon gerade da */
  da: number;
  /** die ersten drei Namen – Vorhandenes zuerst */
  namen: string[];
  /** Sorten mit „Jetzt wichtig“ (bald verbrauchen …) */
  achtung: number;
};

/** Obergruppen in fester Reihenfolge – nur die, zu denen es Sorten gibt. */
export function gruppenKacheln(bestand: Sorte[], heute: string, ort: VorratOrt = 'alle'): GruppenKachel[] {
  const sorten = sortenFuer(bestand, { ort, gruppe: null, suche: '' }, heute);
  return GRUPPEN.map((g) => {
    const drin = sorten.filter((s) => gruppeVon(s) === g.id);
    return {
      id: g.id,
      sorten: drin.length,
      da: drin.filter((s) => s.anzahl > 0).length,
      namen: drin.slice(0, 3).map((s) => s.name),
      achtung: drin.filter((s) => istDringend(zustand(s, heute))).length,
    };
  }).filter((k) => k.sorten > 0);
}

/** Sorten eines Lagerorts (oder alle), optional nach Obergruppe und Suche; Vorhandenes und Dringendes zuerst. */
export function sortenFuer(bestand: Sorte[], f: { ort: VorratOrt; gruppe: GruppeId | null; suche: string }, heute: string): Sorte[] {
  return bestand
    .filter((s) => f.ort === 'alle' || (s.lagerort ?? 'gefrierfach') === f.ort)
    .filter((s) => !f.gruppe || gruppeVon(s) === f.gruppe)
    .filter((s) => passtZuSuche(s, f.suche))
    .sort((a, b) => {
      const za = zustand(a, heute);
      const zb = zustand(b, heute);
      const dringend = (z: Wichtig | null) => (istDringend(z) ? 0 : 1);
      return Number(b.anzahl > 0) - Number(a.anzahl > 0) || dringend(za) - dringend(zb) || a.name.localeCompare(b.name, 'de');
    });
}

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** „Heute“, „Morgen“, „Gestern“, sonst „Mi 30.09.“ */
export function tagName(heute: string, iso: string): string {
  const t = tageBis(heute, iso);
  if (t === 0) return 'Heute';
  if (t === 1) return 'Morgen';
  if (t === -1) return 'Gestern';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `${WOCHENTAGE[d.getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

/** YYYY-MM-DD plus n Tage */
export function plusTageIso(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Die nächsten n freien Tage ab heute (Tage mit schon geplanter Mahlzeit werden übersprungen). */
export function freieTage(heute: string, belegt: (string | null)[], n: number): string[] {
  const schon = new Set(belegt.filter(Boolean));
  const tage: string[] = [];
  for (let i = 0; tage.length < n && i < 60; i++) {
    const tag = plusTageIso(heute, i);
    if (!schon.has(tag)) tage.push(tag);
  }
  return tage;
}

/**
 * Warum jetzt produzieren? Nur aus strukturierten Daten – nichts davon kommt von der KI:
 *   dringend: „700 g Gehackte Tomaten – noch 2 Tage“ (Menge aus dem Rezept, Zustand aus dem Vorrat)
 *   passend:  „Passt zu 6 Sachen im Vorrat“, „Für 5 Gerichtsarten“
 */
export function produktionsGruende(
  k: Pick<KomponentenVorschlag, 'zutaten' | 'partner' | 'gerichtstypen'>, bestand: Sorte[], heute: string,
): { dringend: string[]; passend: string[] } {
  const dringend: string[] = [];
  for (const z of k.zutaten) {
    if (z.quelle !== 'bestand' || !z.dringend || z.menge === null || !z.einheit) continue;
    const s = bestand.find((b) => b.id === z.block_typ_id);
    const w = s ? zustand(s, heute) : null;
    const was = `${mengeText(z.menge, z.einheit)} ${z.name}`;
    if (w?.art === 'bald') dringend.push(`${was} – ${w.text}`);
    else if (w?.art === 'geoeffnet') dringend.push(`${was} – angebrochen`);
    else if (w?.art === 'aufgetaut') dringend.push(`${was} – aufgetaut, heute verbrauchen`);
    else if (w?.art !== 'abgelaufen') dringend.push(`verwertet ${was}`); // Abgelaufenes wird nie eingeplant
  }
  const passend: string[] = [];
  if (k.partner.length) passend.push(`Passt zu ${k.partner.length} ${k.partner.length === 1 ? 'Sache' : 'Sachen'} im Vorrat`);
  if (k.gerichtstypen.length) passend.push(`Für ${k.gerichtstypen.length} Gerichtsarten`);
  return { dringend, passend };
}
