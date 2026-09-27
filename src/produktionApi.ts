// Datenzugriffe für die Produktion (Vorkochen, Nachkochen, Einfrieren).
// Planen ändert keinen Bestand. Gebucht wird nur über produzieren() – nach „Produktion abschließen“.
import { supabase } from './supabase';
import { fehltMigration, meldung, type Lagerort, type Sorte } from './api';
import { MIGRATION_FEHLT } from './bonApi';
import { artVon, einheitVon, portionMengeVon } from './format';
import type {
  Eingang, EinkaufsEintragNeu, EingangZeile, ProduktionEintrag, ProduktSorte,
} from '../supabase/functions/_shared/kombi/produktion.ts';
import type { PreisStatus } from '../supabase/functions/_shared/kombi/typen.ts';

export type Produktion = ProduktionEintrag & {
  art: 'komponente' | 'komplettgericht';
  geplant: boolean;
  lagerort: Lagerort | null;
  ablauf_am: string | null;
  notiz: string | null;
  charge_id: number | null;
  bewegung_ids: number[];
  kosten_cent: number | null;
  kosten_status: PreisStatus | null;
  plan_id: string | null;
  rueckgaengig_am: string | null;
};

/** null = Migration „bon_produktion“ fehlt noch */
export async function ladeProduktionen(): Promise<Produktion[] | null> {
  const { data, error } = await supabase.from('produktion').select('*').order('erstellt_am', { ascending: false }).limit(300);
  if (error) {
    if (fehltMigration(error) || /produktion/.test(error.message)) return null;
    throw new Error(meldung(error));
  }
  return (data as Produktion[]).map((p) => ({
    ...p,
    zutaten: Array.isArray(p.zutaten) ? p.zutaten : [],
    kosten_cent: p.kosten_cent === null ? null : Number(p.kosten_cent),
  }));
}

export type Planung = {
  block_typ_id: number;
  geplant_fuer: string | null;
  geplante_menge: number | null;
  zutaten: Eingang[];
  lagerort: Lagerort | null;
  ablauf_am: string | null;
  notiz: string | null;
  plan_id?: string | null;
};

export async function planeProduktion(p: Planung): Promise<string> {
  const { data, error } = await supabase.from('produktion').insert(p).select('id').single();
  if (error) throw new Error(fehltMigration(error) ? MIGRATION_FEHLT : meldung(error));
  return (data as { id: string }).id;
}

export async function aenderePlanung(id: string, p: Partial<Omit<Planung, 'block_typ_id' | 'plan_id'>>): Promise<void> {
  const { error } = await supabase.from('produktion').update(p).eq('id', id).eq('status', 'geplant');
  if (error) throw new Error(meldung(error));
}

export async function verwerfePlanung(id: string): Promise<void> {
  const { error } = await supabase.from('produktion').update({ status: 'verworfen' }).eq('id', id).eq('status', 'geplant');
  if (error) throw new Error(meldung(error));
}

export type ProduktionsErgebnis = {
  produktion_id: string;
  charge_id: number;
  bewegung_ids: number[];
  kosten_cent: number | null;
  kosten_status: PreisStatus;
};

/** Produktion abschließen: Eingänge entnehmen, tatsächliche Menge als neue Charge – ein Schritt. */
export async function produziere(p: {
  block_typ_id: number;
  eingaenge: Eingang[];
  menge: number;
  lagerort: Lagerort | null;
  ablauf_am: string | null;
  produktion_id: string | null;
  plan_id: string | null;
  geplante_menge: number | null;
  notiz: string | null;
}): Promise<ProduktionsErgebnis> {
  const { data, error } = await supabase.rpc('produzieren', {
    p_block_typ_id: p.block_typ_id,
    p_eingaenge: p.eingaenge,
    p_menge: p.menge,
    p_lagerort: p.lagerort,
    p_ablauf_am: p.ablauf_am,
    p_produktion_id: p.produktion_id,
    p_plan_id: p.plan_id,
    p_geplante_menge: p.geplante_menge,
    p_notiz: p.notiz,
  });
  if (error) throw new Error(fehltMigration(error) ? MIGRATION_FEHLT : meldung(error));
  const e = data as ProduktionsErgebnis;
  return { ...e, kosten_cent: e.kosten_cent === null ? null : Number(e.kosten_cent) };
}

export async function produktionRueckgaengig(id: string): Promise<void> {
  const { error } = await supabase.rpc('produktion_rueckgaengig', { p_produktion_id: id });
  if (error) throw new Error(meldung(error));
}

/** Kostenherkunft einer abgeschlossenen Produktion. */
export async function ladeEingaenge(produktionId: string): Promise<EingangZeile[]> {
  const { data, error } = await supabase
    .from('produktion_eingang')
    .select('block_typ_id, menge, wert_cent, kosten_status')
    .eq('produktion_id', produktionId);
  if (error) throw new Error(meldung(error));
  return data as EingangZeile[];
}

/** Fehlendes für eine Produktion auf die Einkaufsliste (Tabelle einkauf_eintrag der Planung). */
export async function aufEinkaufsliste(eintraege: EinkaufsEintragNeu[]): Promise<number> {
  if (eintraege.length === 0) return 0;
  const { error } = await supabase.from('einkauf_eintrag').insert(eintraege);
  if (error) {
    if (fehltMigration(error) || /einkauf_eintrag/.test(error.message)) {
      throw new Error('Dafür fehlt noch die Migration „planung_einkauf“ in Supabase (siehe README).');
    }
    throw new Error(meldung(error));
  }
  return eintraege.length;
}

/** Sorte aus der View „bestand“ → was die Produktions-Engine braucht. */
export function produktSorte(s: Sorte): ProduktSorte {
  return {
    id: s.id,
    name: s.name,
    art: artVon(s),
    einheit: einheitVon(s),
    portion_menge: portionMengeVon(s),
    anzahl: s.anzahl,
    abgelaufen: s.abgelaufen ?? 0,
    haltbar_tage: s.haltbar_tage,
    mindestbestand: s.mindestbestand,
    bald_ablaufen: s.bald_ablaufen,
    geoeffnet: s.geoeffnet ?? 0,
    zusammensetzung: s.zusammensetzung ?? null,
    farbe: s.farbe,
  };
}
