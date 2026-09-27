// Anzeige-Helfer für Datum, Geld, Mengen und Preise.
import type { Art, Einheit, Sorte } from './api';
import { artAusAltdaten } from '../supabase/functions/_shared/kombi/snapshot.ts';
import { bezugText, mengeText, portionenText } from '../supabase/functions/_shared/kombi/mengen.ts';
import { euroText, portionspreis } from '../supabase/functions/_shared/kombi/kosten.ts';

/** '2026-09-27' → '27.09.2026' */
export function datum(iso: string): string {
  const [j, m, t] = iso.split('-');
  return `${t}.${m}.${j}`;
}

/** '2026-09-27' + 90 Tage → '26.12.2026' */
export function plusTage(iso: string, tage: number): string {
  const [j, m, t] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t + tage));
  return datum(d.toISOString().slice(0, 10));
}

/** Wie viele Tage ist das Datum her (nach Handy-Kalender)? */
export function tageSeit(iso: string): number {
  const [j, m, t] = iso.split('-').map(Number);
  const jetzt = new Date();
  const heute = Date.UTC(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  return Math.round((heute - Date.UTC(j, m - 1, t)) / 86_400_000);
}

/** 17 → '0,17 €' */
export function euro(cent: number): string {
  return (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

/** '0,17' / '0.17' / '1' → Cent; leer → null; ungültig → NaN */
export function euroZuCent(text: string): number | null {
  const t = text.replace('€', '').trim().replace(',', '.');
  if (t === '') return null;
  const wert = Number(t);
  return Number.isFinite(wert) && wert >= 0 ? Math.round(wert * 100) : NaN;
}

// ───────── Sorten anzeigen (Einheiten, Portionen, Preise – über die zentrale Engine-Logik) ─────────

export { bezugText, mengeText, portionenText };

export const einheitVon = (s: Pick<Sorte, 'einheit'>): Einheit => s.einheit ?? 'portion';
export const portionMengeVon = (s: Pick<Sorte, 'einheit' | 'portion_menge'>): number =>
  einheitVon(s) === 'portion' ? 1 : Math.max(1, s.portion_menge ?? 1);
export const artVon = (s: Pick<Sorte, 'art' | 'farbe' | 'lagerort' | 'name'>): Art => s.art ?? artAusAltdaten(s);

/** Große Zahl + Einheit für Listen: { zahl: '375', einheit: 'g' } bzw. { zahl: '4', einheit: 'Port.' } */
export function mengeKurz(menge: number, einheit: Einheit): { zahl: string; einheit: string } {
  if (einheit === 'g' || einheit === 'ml') {
    const t = mengeText(menge, einheit).split(' ');
    return { zahl: t[0], einheit: t[1] };
  }
  return { zahl: String(menge), einheit: einheit === 'stueck' ? 'Stück' : menge === 1 ? 'Portion' : 'Port.' };
}

/** Portionen, die die Menge ergibt (abgerundet auf halbe) */
export function portionenVon(s: Sorte): number {
  return Math.floor((s.anzahl / portionMengeVon(s)) * 2) / 2;
}

/** „0,50 € / Portion“ – berechnet aus gespeichertem Preis und Bezugsmenge; sonst „Preis unbekannt“ */
export function portionspreisText(s: Pick<Sorte, 'kosten_cent' | 'kosten_menge' | 'einheit' | 'portion_menge'>): string {
  const p = portionspreis({ kosten_cent: s.kosten_cent, kosten_menge: s.kosten_menge ?? 1, portion_menge: portionMengeVon(s) });
  return p === null ? 'Preis unbekannt' : `${euroText(p)} / Portion`;
}

/** Gespeicherter Preis mit Bezug: „2,00 € für 4 Portionen“ */
export function preisMitBezug(s: Pick<Sorte, 'kosten_cent' | 'kosten_menge' | 'einheit'>): string | null {
  if (s.kosten_cent === null) return null;
  // geschütztes Leerzeichen: „500 g“ nicht umbrechen
  return `${euroText(s.kosten_cent)} ${bezugText(s.kosten_menge ?? 1, einheitVon(s)).replace(/(\d) /g, '$1\u00a0')}`;
}

export function tageBis(iso: string): number {
  return -tageSeit(iso);
}

/** „läuft heute ab“, „noch 3 Tage“, „seit 2 Tagen abgelaufen“ */
export function ablaufText(iso: string): string {
  const t = tageBis(iso);
  if (t < 0) return t === -1 ? 'seit gestern abgelaufen' : `seit ${-t} Tagen abgelaufen`;
  if (t === 0) return 'läuft heute ab';
  if (t === 1) return 'läuft morgen ab';
  return `noch ${t} Tage`;
}

/** Heute als YYYY-MM-DD (Handy-Kalender) */
export function heuteIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
