// Alle Zugriffe auf Supabase. Die Buchungslogik (FIFO, Rückgängig, Prüfungen)
// liegt in der Datenbank – siehe supabase/migrations.
import { supabase } from './supabase';
import type { Farbe, LagerortId } from './farben';

export type Lagerort = LagerortId;

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
};

export type SorteDaten = Pick<
  Sorte,
  'name' | 'farbe' | 'groesse_g' | 'mindestbestand' | 'haltbar_tage' | 'kosten_cent' | 'lagerort'
>;

export type Charge = {
  id: number;
  menge_start: number;
  menge_aktuell: number;
  eingefroren_am: string;
};

type DbFehler = { message: string; code?: string };

function meldung(fehler: DbFehler): string {
  if (fehler.code === '23505') return 'Eine Sorte mit diesem Namen gibt es schon.';
  if (fehler.code === '42501') {
    return 'Keine Berechtigung – sind beide Migrationen in Supabase eingespielt? (siehe README)';
  }
  if (/failed to fetch|networkerror|load failed/i.test(fehler.message)) {
    return 'Keine Verbindung zur Datenbank. Bist du online?';
  }
  // Eigene Meldungen der Buchungsfunktionen sind bereits deutsch und verständlich.
  return fehler.message;
}

export function fehlerText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function ladeBestand(): Promise<Sorte[]> {
  const { data, error } = await supabase.from('bestand').select('*');
  if (error) throw new Error(meldung(error));
  return data as Sorte[];
}

export async function ladeChargen(sorteId: number): Promise<Charge[]> {
  const { data, error } = await supabase
    .from('charge')
    .select('id, menge_start, menge_aktuell, eingefroren_am')
    .eq('block_typ_id', sorteId)
    .gt('menge_aktuell', 0)
    .order('eingefroren_am')
    .order('id');
  if (error) throw new Error(meldung(error));
  return data as Charge[];
}

/** Gibt die IDs der erzeugten Bewegungen zurück (für „Rückgängig“). */
export async function einfrieren(sorteId: number, anzahl: number): Promise<number[]> {
  const { data, error } = await supabase.rpc('einfrieren', {
    p_block_typ_id: sorteId,
    p_anzahl: anzahl,
  });
  if (error) throw new Error(meldung(error));
  return data as number[];
}

/** Entnimmt nach FIFO. Gibt die IDs der erzeugten Bewegungen zurück. */
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

export async function speichereSorte(id: number | null, daten: SorteDaten): Promise<void> {
  const { error } =
    id === null
      ? await supabase.from('block_typ').insert(daten)
      : await supabase.from('block_typ').update(daten).eq('id', id);
  if (error) throw new Error(meldung(error));
}
