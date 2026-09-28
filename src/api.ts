// Alle Zugriffe auf Supabase. Die Buchungslogik (Reihenfolge, Rückgängig, Prüfungen)
// liegt in der Datenbank – siehe supabase/migrations.
//
// Die App läuft auch, solange die Migration „baukasten“ noch fehlt: Dann gibt es die neuen
// Felder (Art, Einheit, Zusammensetzung, Ablaufdatum …) einfach nicht, und die App zeigt
// einen Hinweis statt eines Fehlers.
import { supabase } from './supabase';
import type { Farbe, LagerortId } from './farben';
import type { Art, Einheit, Gerichtstyp, Gewuerzrichtung, Herkunft } from '../supabase/functions/_shared/kombi/typen.ts';
import type { BildQuelle, BildStatus } from '../supabase/functions/_shared/kombi/bilder.ts';

export type Lagerort = LagerortId;
export type { Art, Einheit, Gerichtstyp, Gewuerzrichtung, Herkunft };

/** Eine Zeile der View „bestand“ */
export type Sorte = {
  id: number;
  name: string;
  farbe: Farbe;
  anzahl: number;
  mindestbestand: number;
  nachkochen: boolean;
  aelteste: string | null;
  bald_ablaufen: boolean;
  haltbar_tage: number;
  groesse_g: number;
  kosten_cent: number | null;
  /** fehlt, solange die Migration „was_essen“ nicht eingespielt ist → Gefrierfach */
  lagerort?: Lagerort;
  // ab Migration „baukasten“:
  art?: Art;
  herkunft?: Herkunft | null;
  einheit?: Einheit;
  portion_menge?: number;
  kosten_menge?: number;
  zusammensetzung?: string[] | null;
  notiz?: string | null;
  naechster_ablauf?: string | null;
  geoeffnet?: number;
  geoeffnet_seit?: string | null;
  abgelaufen?: number;
  // ab Migration „planung_einkauf“:
  gerichtstypen?: Gerichtstyp[] | null;
  richtung?: Gewuerzrichtung | null;
  /** Startmenge der Chargen, die noch etwas enthalten (für „6 / 8 Portionen“) */
  start_menge?: number;
  aufgetaut?: number;
  auftauen_geplant?: number;
  // ab Migration „kosten_naehrwerte“: Nährwerte für naehrwert_menge Einheiten (NULL = unbekannt)
  kcal?: number | string | null;
  protein_g?: number | string | null;
  kohlenhydrate_g?: number | string | null;
  fett_g?: number | string | null;
  naehrwert_menge?: number | null;
  // ab Migration „bilder_zutaten“: eigenes Bild und semantische Zutat (leer = automatisch erkannt)
  image_url?: string | null;
  image_source?: BildQuelle | null;
  image_status?: BildStatus | null;
  image_query?: string | null;
  image_alt?: string | null;
  image_generated?: boolean;
  image_updated_at?: string | null;
  zutat?: string | null;
};

export type SorteDaten = Pick<
  Sorte,
  | 'name' | 'farbe' | 'groesse_g' | 'mindestbestand' | 'haltbar_tage' | 'kosten_cent' | 'lagerort'
  | 'art' | 'herkunft' | 'einheit' | 'portion_menge' | 'kosten_menge' | 'zusammensetzung' | 'notiz'
  | 'gerichtstypen' | 'richtung'
  | 'kcal' | 'protein_g' | 'kohlenhydrate_g' | 'fett_g' | 'naehrwert_menge'
  | 'image_url' | 'image_source' | 'image_status' | 'image_alt' | 'image_updated_at' | 'zutat'
>;

export type Charge = {
  id: number;
  menge_start: number;
  menge_aktuell: number;
  eingefroren_am: string;
  ablauf_am?: string | null;
  geoeffnet_am?: string | null;
};

type DbFehler = { message: string; code?: string };

/** Spalte/Funktion gibt es noch nicht → Migration fehlt */
export const fehltMigration = (e: DbFehler | null | undefined) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || e.code === 'PGRST202' || /column .* does not exist/i.test(e.message));

function meldung(fehler: DbFehler): string {
  if (fehler.code === '23505') return 'Eine Sorte mit diesem Namen gibt es schon.';
  if (fehler.code === '42501') {
    return 'Keine Berechtigung – sind alle Migrationen in Supabase eingespielt? (siehe README)';
  }
  if (fehltMigration(fehler)) return 'Dafür fehlt noch die Migration „baukasten“ (siehe README).';
  if (/failed to fetch|networkerror|load failed/i.test(fehler.message)) {
    return 'Keine Verbindung zur Datenbank. Bist du online?';
  }
  // Eigene Meldungen der Buchungsfunktionen sind bereits deutsch und verständlich.
  return fehler.message;
}

export function fehlerText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Bestand plus Info, ob die Baukasten-Migration schon da ist. */
export async function ladeBestand(): Promise<Sorte[]> {
  const { data, error } = await supabase.from('bestand').select('*');
  if (error) throw new Error(meldung(error));
  return data as Sorte[];
}

/** Gibt es die Baukasten-Spalten? (bei leerem Bestand per Probe-Abfrage) */
export async function hatBaukasten(bestand: Sorte[]): Promise<boolean> {
  if (bestand.length > 0) return 'art' in bestand[0];
  const { error } = await supabase.from('block_typ').select('art').limit(1);
  return !error;
}

export async function ladeChargen(sorteId: number): Promise<Charge[]> {
  const abfrage = (spalten: string) =>
    supabase
      .from('charge')
      .select(spalten)
      .eq('block_typ_id', sorteId)
      .gt('menge_aktuell', 0)
      .order('eingefroren_am')
      .order('id');
  let { data, error } = await abfrage('id, menge_start, menge_aktuell, eingefroren_am, ablauf_am, geoeffnet_am');
  if (fehltMigration(error)) ({ data, error } = await abfrage('id, menge_start, menge_aktuell, eingefroren_am'));
  if (error) throw new Error(meldung(error));
  return data as unknown as Charge[];
}

/** Gibt die IDs der erzeugten Bewegungen zurück (für „Rückgängig“). Ablaufdatum optional. */
export async function einfrieren(sorteId: number, anzahl: number, ablaufAm?: string | null): Promise<number[]> {
  const { data, error } = await supabase.rpc('einfrieren', {
    p_block_typ_id: sorteId,
    p_anzahl: anzahl,
    ...(ablaufAm ? { p_ablauf_am: ablaufAm } : {}),
  });
  if (error) throw new Error(meldung(error));
  return data as number[];
}

/** Entnimmt: geöffnete Charge zuerst, dann frühester Ablauf, sonst die älteste. */
export async function entnehmen(sorteId: number, anzahl: number): Promise<number[]> {
  const { data, error } = await supabase.rpc('entnehmen', {
    p_block_typ_id: sorteId,
    p_anzahl: anzahl,
  });
  if (error) throw new Error(meldung(error));
  return data as number[];
}

export async function rueckgaengig(bewegungIds: number[]): Promise<void> {
  const { error } = await supabase.rpc('rueckgaengig', { p_bewegung_ids: bewegungIds });
  if (error) throw new Error(meldung(error));
}

export async function setzeGeoeffnet(chargeId: number, geoeffnet: boolean): Promise<void> {
  const { error } = await supabase.rpc('setze_geoeffnet', { p_charge_id: chargeId, p_geoeffnet: geoeffnet });
  if (error) throw new Error(meldung(error));
}

export async function setzeAblauf(chargeId: number, ablaufAm: string | null): Promise<void> {
  const { error } = await supabase.rpc('setze_ablauf', { p_charge_id: chargeId, p_ablauf_am: ablaufAm });
  if (error) throw new Error(meldung(error));
}

/** Speichert eine Sorte und gibt ihre ID zurück. */
export async function speichereSorte(id: number | null, daten: SorteDaten): Promise<number> {
  if (id !== null) {
    const { error } = await supabase.from('block_typ').update(daten).eq('id', id);
    if (error) throw new Error(meldung(error));
    return id;
  }
  const { data, error } = await supabase.from('block_typ').insert(daten).select('id').single();
  if (error) throw new Error(meldung(error));
  return (data as { id: number }).id;
}

/** Nährwerte einer Sorte setzen (z. B. aus einer Produktion gelernt) – nur die Nährwert-Spalten. */
export async function setzeNaehrwerte(id: number, werte: Pick<Sorte, 'kcal' | 'protein_g' | 'kohlenhydrate_g' | 'fett_g' | 'naehrwert_menge'>): Promise<void> {
  const { error } = await supabase.from('block_typ').update(werte).eq('id', id);
  if (error) throw new Error(meldung(error));
}
