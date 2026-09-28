// Vorrat als Haushalts-Übersicht: Was ist heute wichtig, was liegt wo, wie voll ist es?
// Reine Berechnungen aus den echten Bestandsdaten – nichts wird geschätzt.
import type { Art, Farbe, KomponentenVorschlag } from '../supabase/functions/_shared/kombi/typen.ts';
import { normalisiere } from '../supabase/functions/_shared/kombi/text.ts';
import type { Sorte } from './api';
import { artVon, einheitVon, mengeText, portionenVon } from './format.ts';
import type { VorratOrt } from './navigation.ts';

export type WichtigArt = 'abgelaufen' | 'aufgetaut' | 'geoeffnet' | 'bald' | 'niedrig';
export type Wichtig = { sorte: Sorte; art: WichtigArt; titel: string; text: string };

const REIHENFOLGE: WichtigArt[] = ['abgelaufen', 'aufgetaut', 'geoeffnet', 'bald', 'niedrig'];

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
    return { sorte: s, art: 'niedrig', titel: 'Wird knapp', text: `${s.anzahl === 0 ? 'leer' : `nur ${mengeText(s.anzahl, e)}`} · ${was}` };
  }
  return null;
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
      achtung: alle.filter((s) => { const z = zustand(s, heute); return z !== null && z.art !== 'niedrig'; }).length,
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

/** Wert des Vorrats aus gespeicherten Preisen (ohne Abgelaufenes); Sorten ohne Preis werden gezählt. */
export function vorratswert(bestand: Sorte[]): { cent: number; ohne_preis: number } {
  let cent = 0;
  let ohne = 0;
  for (const s of bestand) {
    const menge = Math.max(0, s.anzahl - Math.max(0, s.abgelaufen ?? 0));
    if (menge === 0) continue;
    if (s.kosten_cent === null) ohne++;
    else cent += (menge * s.kosten_cent) / Math.max(1, s.kosten_menge ?? 1);
  }
  return { cent: Math.round(cent), ohne_preis: ohne };
}

/** „Äpfel“ → „apfel“: Umlaute ohne Punkte (normalisiere() schreibt sie aus: „aepfel“) */
const ohnePunkte = (t: string) => normalisiere(t.normalize('NFD').replace(/[̀-ͯ]/g, ''));

/** Suche in Name und Zusammensetzung (ohne Groß/klein; „apfel“, „äpfel“ und „aepfel“ finden „Äpfel“). */
export function passtZuSuche(s: Sorte, suche: string): boolean {
  if (!normalisiere(suche)) return true;
  const text = [s.name, ...(s.zusammensetzung ?? [])].join(' ');
  return normalisiere(text).includes(normalisiere(suche)) || ohnePunkte(text).includes(ohnePunkte(suche));
}

/** Sorten eines Lagerorts (oder alle), optional nach Art und Suche; Vorhandenes und Dringendes zuerst. */
export function sortenFuer(bestand: Sorte[], f: { ort: VorratOrt; art: Art | null; suche: string }, heute: string): Sorte[] {
  return bestand
    .filter((s) => f.ort === 'alle' || (s.lagerort ?? 'gefrierfach') === f.ort)
    .filter((s) => !f.art || artVon(s) === f.art)
    .filter((s) => passtZuSuche(s, f.suche))
    .sort((a, b) => {
      const za = zustand(a, heute);
      const zb = zustand(b, heute);
      const dringend = (z: Wichtig | null) => (z && z.art !== 'niedrig' ? 0 : 1);
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
