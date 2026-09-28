// Bilder in der App: erst der Cache (Tabelle „bild“), dann – nur für sichtbare Hauptkarten – einmal
// die Bildpipeline der Edge Function (Suche bei Wikimedia Commons, sonst Generierung, falls eingerichtet).
//
//   • Pro Inhalt (Schlüssel) wird höchstens EINMAL je Sitzung gesucht; ein gültiges Bild im Cache
//     verhindert jede neue Suche oder Generierung.
//   • Nie eine Pflichtabhängigkeit: Ohne Migration, ohne Edge Function oder offline bleibt es beim
//     lokalen Bild. Kaputte Bilder werden als „fehler“ markiert, die Karte zeigt sofort das lokale Bild.
//   • Die App speichert nur URLs, die sichereBildUrl() erlaubt (https, dauerhafte Quelle).
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { BildAnfrage, BildDaten } from '../supabase/functions/_shared/kombi/bilder.ts';
import { neuestesJeSchluessel, sichereBildUrl } from '../supabase/functions/_shared/kombi/bilder.ts';
import type { Sorte } from './api';

type Zeile = BildDaten & { id: number | null; schluessel: string };

const cache = new Map<string, Zeile | null>();
const hoerer = new Map<string, Set<() => void>>();
const angefragt = new Set<string>();
let cacheGeladen: Promise<boolean> | null = null;
/** Edge Function kann (noch) keine Bilder – dann in dieser Sitzung nicht weiter fragen */
let dienstAus = false;
let laufend = 0;
const warteschlange: (() => void)[] = [];

function melde(schluessel: string | null) {
  const ziele = schluessel ? [hoerer.get(schluessel)] : [...hoerer.values()];
  for (const set of ziele) set?.forEach((f) => f());
}

const SPALTEN = 'id, schluessel, image_url, image_source, image_status, image_query, image_alt, image_generated, image_updated_at, lizenz, urheber, quelle_seite';

/** Lädt den Bild-Cache einmal (500 neueste gültige Einträge). false = Migration „bilder_zutaten“ fehlt. */
export function ladeBildCache(): Promise<boolean> {
  if (!cacheGeladen) {
    cacheGeladen = (async () => {
      const { data, error } = await supabase.from('bild').select(SPALTEN).eq('image_status', 'ok')
        .order('image_updated_at', { ascending: false }).limit(500);
      if (error) return false;
      for (const [k, z] of neuestesJeSchluessel((data ?? []) as Zeile[])) if (!cache.has(k)) cache.set(k, z);
      melde(null);
      return true;
    })().catch(() => false);
  }
  return cacheGeladen;
}

function mitZeitlimit<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((ja, nein) => {
    const t = setTimeout(() => nein(new Error('Zeitüberschreitung')), ms);
    p.then((w) => { clearTimeout(t); ja(w); }, (e) => { clearTimeout(t); nein(e); });
  });
}

/** Höchstens zwei Bildanfragen gleichzeitig – die Startseite soll nicht warten müssen. */
async function inReihe<T>(f: () => Promise<T>): Promise<T> {
  if (laufend >= 2) await new Promise<void>((weiter) => warteschlange.push(weiter));
  laufend++;
  try {
    return await f();
  } finally {
    laufend--;
    warteschlange.shift()?.();
  }
}

async function anfordern(a: BildAnfrage, migration: boolean): Promise<void> {
  if (dienstAus || angefragt.has(a.schluessel) || cache.has(a.schluessel)) return;
  angefragt.add(a.schluessel);
  try {
    const { data, error } = await inReihe(() => mitZeitlimit<{ data: unknown; error: unknown }>(
      supabase.functions.invoke('was-essen', { body: { aufgabe: 'bild', bild: a } }), 70_000));
    if (error) {
      const antwort = (error as { context?: Response }).context;
      const status = antwort?.status;
      let text = '';
      try {
        text = ((await antwort?.json()) as { fehler?: string } | undefined)?.fehler ?? '';
      } catch {
        // Antwort ohne JSON
      }
      // Nur diese eine Anfrage passt nicht → kein Bild dafür. Sonst (404, 503, alte Function ohne
      // Bildteil) in dieser Sitzung nicht weiter fragen.
      if (status === 400 && /Bildanfrage/.test(text)) cache.set(a.schluessel, null);
      else if (status === 400 || status === 404 || status === 503) dienstAus = true;
      return;
    }
    const b = (data as { bild?: BildDaten | null } | null)?.bild ?? null;
    const url = b ? sichereBildUrl(b.image_url, b.image_source) : null;
    if (!b || !url || (b.image_source !== 'gefunden' && b.image_source !== 'generiert')) {
      cache.set(a.schluessel, null);
      melde(a.schluessel);
      return;
    }
    const zeile: Zeile = { ...b, image_url: url, id: null, schluessel: a.schluessel };
    cache.set(a.schluessel, zeile);
    melde(a.schluessel);
    if (migration) {
      // Merken, damit dasselbe Gericht nie wieder gesucht oder generiert wird
      const { data: neu } = await supabase.from('bild').insert({
        schluessel: a.schluessel, art: a.art, image_url: url, image_source: b.image_source, image_query: b.image_query,
        image_alt: b.image_alt, image_generated: b.image_source === 'generiert', lizenz: b.lizenz, urheber: b.urheber, quelle_seite: b.quelle_seite,
      }).select('id').single();
      if (neu) zeile.id = (neu as { id: number }).id;
    }
  } catch {
    // offline oder Zeitüberschreitung: lokales Bild bleibt, später erneut in einer neuen Sitzung
    angefragt.delete(a.schluessel);
  }
}

/** Bild lädt nicht (mehr): lokal zeigen und im Cache als „fehler“ markieren (nichts wird gelöscht). */
export function bildKaputt(schluessel: string | null | undefined) {
  if (!schluessel) return;
  const z = cache.get(schluessel);
  cache.set(schluessel, null);
  melde(schluessel);
  if (z?.id) void supabase.from('bild').update({ image_status: 'fehler' }).eq('id', z.id);
}

/**
 * Bild zu einer Anfrage: aus dem Cache – und mit suchen=true einmalig über die Bildpipeline.
 * null = (noch) kein Bild → die Komponente zeigt das lokale Fallback.
 */
export function useBild(anfrage: BildAnfrage | null | undefined, suchen = false): BildDaten | null {
  const schluessel = anfrage?.schluessel ?? null;
  const [, neu] = useState(0);
  useEffect(() => {
    if (!schluessel) return;
    const f = () => neu((n) => n + 1);
    const set = hoerer.get(schluessel) ?? new Set();
    set.add(f);
    hoerer.set(schluessel, set);
    return () => {
      set.delete(f);
    };
  }, [schluessel]);
  useEffect(() => {
    if (!anfrage) return;
    let aktiv = true;
    void ladeBildCache().then((migration) => {
      if (aktiv && suchen && !cache.has(anfrage.schluessel)) void anfordern(anfrage, migration);
    });
    return () => {
      aktiv = false;
    };
    // bewusst nur bei anderem Inhalt neu (die Anfrage selbst wird bei jedem Rendern neu gebaut)
  }, [schluessel, suchen]);
  return schluessel ? cache.get(schluessel) ?? null : null;
}

/** Eigenes Bild einer Sorte (Spalten image_* ab Migration „bilder_zutaten“) – sonst null. */
export function sortenBild(s: Pick<Sorte, 'image_url' | 'image_source' | 'image_status' | 'image_alt' | 'image_generated' | 'image_updated_at' | 'image_query'>): BildDaten | null {
  const quelle = s.image_source ?? (s.image_url ? 'eigen' : null);
  if (!s.image_url || !quelle || (s.image_status && s.image_status !== 'ok')) return null;
  const url = sichereBildUrl(s.image_url, quelle);
  if (!url) return null;
  return {
    image_url: url, image_source: quelle, image_status: 'ok', image_query: s.image_query ?? null, image_alt: s.image_alt ?? null,
    image_generated: !!s.image_generated, image_updated_at: s.image_updated_at ?? null, lizenz: null, urheber: null, quelle_seite: null,
  };
}
