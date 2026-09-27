// Datenzugriffe für „Bestand aktualisieren“ (Kassenbon, E-Bon, Text) und Chargenkosten.
// Gebucht wird ausschließlich über bon_buchen() – und erst nach „Bestand aktualisieren“.
import { supabase } from './supabase';
import { fehltMigration, meldung, type Sorte } from './api';
import { artVon, einheitVon, portionMengeVon } from './format';
import type { ChargeInfo } from '../supabase/functions/_shared/kombi/chargen.ts';
import type { Gewohnheit, SorteInfo } from '../supabase/functions/_shared/kombi/bon/typen.ts';
import type { BonBuchung } from '../supabase/functions/_shared/kombi/bon/vorschlag.ts';
import { pruefeBonLesung, type BonLesung } from '../supabase/functions/_shared/kombi/bon/ki.ts';
import { pdfText } from '../supabase/functions/_shared/kombi/bon/pdf.ts';

export const MIGRATION_FEHLT = 'Dafür fehlt noch die Migration „bon_produktion“ in Supabase (siehe README).';

/** Derselbe Bon wurde schon importiert – die App fragt, ob trotzdem gebucht werden soll. */
export class DoppeltFehler extends Error {}

export function sortenInfo(bestand: Sorte[]): SorteInfo[] {
  return bestand.map((s) => ({
    id: s.id,
    name: s.name,
    farbe: s.farbe,
    art: artVon(s),
    einheit: einheitVon(s),
    portion_menge: portionMengeVon(s),
    groesse_g: s.groesse_g,
    lagerort: s.lagerort ?? 'gefrierfach',
    herkunft: s.herkunft ?? null,
    kosten_cent: s.kosten_cent,
    kosten_menge: s.kosten_menge ?? 1,
    anzahl: s.anzahl,
  }));
}

/** Frühere Entscheidungen zu Bon-Artikeln. Lernen ist Komfort: Klappt das Laden nicht, geht es ohne. */
export async function ladeGewohnheiten(): Promise<Gewohnheit[]> {
  const { data, error } = await supabase.from('bon_gewohnheit').select('*');
  if (error || !data) return [];
  return (data as Gewohnheit[]).map((g) => ({ ...g, letzte_menge_pro_einheit: g.letzte_menge_pro_einheit === null ? null : Number(g.letzte_menge_pro_einheit) }));
}

/** Alle nicht leeren Chargen mit Kosten (für Kostenvorschau und Lagerort je Charge). */
export async function ladeAktiveChargen(): Promise<ChargeInfo[]> {
  const { data, error } = await supabase
    .from('charge')
    .select('id, block_typ_id, menge_aktuell, eingefroren_am, ablauf_am, geoeffnet_am, kosten_cent, kosten_menge, kosten_status, kosten_quelle, quelle, lagerort')
    .gt('menge_aktuell', 0);
  if (error) {
    if (fehltMigration(error)) return [];
    throw new Error(meldung(error));
  }
  return (data as ChargeInfo[]).map((c) => ({
    ...c,
    kosten_cent: c.kosten_cent === null ? null : Number(c.kosten_cent),
  }));
}

export type BonErgebnis = {
  import_id: string;
  bewegung_ids: number[];
  hinzugefuegt: number;
  nicht_uebernommen: number;
  neue_sorten: number;
};

/** Der eine Schritt, der den Bestand ändert – erst nach ausdrücklicher Bestätigung aufrufen. */
export async function bucheBon(daten: BonBuchung, trotzDoppelt = false): Promise<BonErgebnis> {
  const { data, error } = await supabase.rpc('bon_buchen', { p_bon: daten, p_trotz_doppelt: trotzDoppelt });
  if (error) {
    const e = error as { message: string; code?: string; hint?: string };
    if (e.hint === 'doppelt' || /schon importiert/.test(e.message)) throw new DoppeltFehler(e.message);
    if (fehltMigration(e)) throw new Error(MIGRATION_FEHLT);
    if (e.code === '23505') throw new Error('Eine Sorte mit diesem Namen gibt es schon – beim neuen Produkt bitte die vorhandene Sorte wählen oder umbenennen.');
    throw new Error(meldung(e));
  }
  return data as BonErgebnis;
}

export async function bonRueckgaengig(importId: string): Promise<void> {
  const { error } = await supabase.rpc('bon_rueckgaengig', { p_import_id: importId });
  if (error) throw new Error(meldung(error));
}

// ───────── Fotos und Dateien ─────────

export type Datei = { mime: string; daten: string };

function base64(blob: Blob): Promise<string> {
  return new Promise((ok, fehler) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => fehler(new Error('Datei konnte nicht gelesen werden.'));
    r.readAsDataURL(blob);
  });
}

/** Foto verkleinern (lange Kante 1600 px, JPEG) – schneller und im Rahmen der KI-Grenzen. */
export async function fotoVorbereiten(datei: File, maxKante = 1600): Promise<Datei> {
  if (datei.type === 'application/pdf') return { mime: 'application/pdf', daten: await base64(datei) };
  try {
    const bild = await createImageBitmap(datei);
    const f = Math.min(1, maxKante / Math.max(bild.width, bild.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bild.width * f);
    canvas.height = Math.round(bild.height * f);
    canvas.getContext('2d')?.drawImage(bild, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    if (blob) return { mime: 'image/jpeg', daten: await base64(blob) };
  } catch {
    // Format kann der Browser nicht verkleinern (z. B. HEIC außerhalb von Safari) → Original schicken
  }
  return { mime: datei.type || 'image/jpeg', daten: await base64(datei) };
}

export class KiNichtDa extends Error {}

/** Fotos von der KI abschreiben lassen (Edge Function „bon-lesen“). Liefert nur geprüften Text. */
export async function leseFotos(dateien: File[]): Promise<{ lesung: BonLesung; anbieter: string }> {
  const vorbereitet = await Promise.all(dateien.map((d) => fotoVorbereiten(d)));
  const { data, error } = await supabase.functions.invoke('bon-lesen', { body: { dateien: vorbereitet } });
  if (error) {
    const antwort = (error as { context?: Response }).context;
    let text = '';
    try {
      text = ((await antwort?.json()) as { fehler?: string } | undefined)?.fehler ?? '';
    } catch {
      // ohne JSON
    }
    if (antwort?.status === 503 || antwort?.status === 404) {
      throw new KiNichtDa('Fotos lesen braucht die KI-Funktion „bon-lesen“ (siehe README). Du kannst den Bon-Text auch einfügen oder einen E-Bon als PDF wählen.');
    }
    if (/failed to fetch|networkerror|load failed/i.test(error.message)) throw new Error('Keine Verbindung. Bist du online?');
    throw new Error(text || 'Der Bon konnte gerade nicht gelesen werden. Bitte nochmal versuchen oder den Text einfügen.');
  }
  const d = data as { anbieter?: string };
  return { lesung: pruefeBonLesung(data), anbieter: typeof d?.anbieter === 'string' ? d.anbieter : 'ki' };
}

/** E-Bon-Datei: Text direkt, PDF mit Textebene ohne KI, sonst Bild (→ KI). */
export async function leseDatei(datei: File): Promise<{ art: 'text'; text: string; erkennung: string } | { art: 'bild' } | { art: 'pdf_ohne_text' }> {
  const name = datei.name.toLowerCase();
  if (datei.type.startsWith('text/') || /\.(txt|csv)$/.test(name)) {
    return { art: 'text', text: await datei.text(), erkennung: 'e-bon-text' };
  }
  if (datei.type === 'application/pdf' || name.endsWith('.pdf')) {
    const zeilen = await pdfText(new Uint8Array(await datei.arrayBuffer()));
    return zeilen.length ? { art: 'text', text: zeilen.join('\n'), erkennung: 'pdf' } : { art: 'pdf_ohne_text' };
  }
  return { art: 'bild' };
}

// ───────── Entwurf merken (nur Komfort, nur auf diesem Gerät) ─────────

const ENTWURF = 'kombi-bon-entwurf';

export function merkeEntwurf(wert: unknown | null): void {
  try {
    if (wert === null) localStorage.removeItem(ENTWURF);
    else localStorage.setItem(ENTWURF, JSON.stringify({ zeit: Date.now(), wert }));
  } catch {
    // Speicher voll oder gesperrt – dann eben ohne
  }
}

export function gemerkterEntwurf<T>(): { zeit: number; wert: T } | null {
  try {
    const roh = localStorage.getItem(ENTWURF);
    if (!roh) return null;
    const e = JSON.parse(roh) as { zeit: number; wert: T };
    return Date.now() - e.zeit < 2 * 86_400_000 ? e : null;
  } catch {
    return null;
  }
}

export type ImportKurz = { id: string; haendler: string | null; kaufdatum: string | null; erstellt_am: string; artikel: number };

/** Die letzten bestätigten Bon-Importe (für „Rückgängig“ auch später noch). */
export async function ladeLetzteImporte(anzahl = 3): Promise<ImportKurz[]> {
  const { data, error } = await supabase
    .from('bon_import')
    .select('id, haendler, kaufdatum, erstellt_am, bon_position(bestand_menge)')
    .eq('status', 'gebucht')
    .order('erstellt_am', { ascending: false })
    .limit(anzahl);
  if (error || !data) return [];
  return (data as unknown as (Omit<ImportKurz, 'artikel'> & { bon_position: { bestand_menge: number }[] })[]).map((i) => ({
    id: i.id,
    haendler: i.haendler,
    kaufdatum: i.kaufdatum,
    erstellt_am: i.erstellt_am,
    artikel: (i.bon_position ?? []).filter((p) => p.bestand_menge > 0).length,
  }));
}
