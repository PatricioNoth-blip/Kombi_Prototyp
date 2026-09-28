// Datenzugriffe für Planung, Einkauf, Auftauen und Nutzung – und die Brücke zur Engine.
// Alles ist tolerant: Fehlt die Migration „planung_einkauf“, liefern die Ladefunktionen leere
// Listen und die App zeigt einen Hinweis statt eines Fehlers.
import { supabase } from './supabase';
import { fehltMigration, type Sorte } from './api';
import type { Einheit, Gericht, KomponentenVorschlag } from '../supabase/functions/_shared/kombi/typen.ts';
import type {
  ListenEintrag, PlanBedarf, VorratSorte, ZeilenStatus,
} from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { produktSchluessel } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import type { AuftauEintrag } from '../supabase/functions/_shared/kombi/planung.ts';
import { bedarfAusGericht, bedarfAusKomponente } from '../supabase/functions/_shared/kombi/planung.ts';
import type { NutzungZeile } from '../supabase/functions/_shared/kombi/batch.ts';
import type { EinkaufsBuchung, HerstellungsZeile, MahlzeitZeile, SonstigeAusgabe } from './startseite.ts';
import { vormonatsanfang } from './startseite.ts';
import { artVon, einheitVon, portionMengeVon } from './format';
import { naehrwertAus, naehrwerteFuerGericht, type Naehrwert, type Naehrwerte } from '../supabase/functions/_shared/kombi/naehrwerte.ts';

export type Plan = {
  id: string;
  art: 'mahlzeit' | 'komponente';
  titel: string;
  datum: string | null;
  portionen: number;
  daten: { gericht?: Gericht; komponente?: KomponentenVorschlag; block_typ_id?: number | null };
  status: 'geplant' | 'erledigt';
  erstellt_am: string;
};

export type Haushaltsdaten = {
  plaene: Plan[];
  eintraege: ListenEintrag[];
  status: ZeilenStatus[];
  auftauen: AuftauEintrag[];
  nutzung: NutzungZeile[];
  /** Einkäufe, Herstellungen und Mahlzeiten seit Monatsanfang (für die Startseite) */
  einkaeufe: EinkaufsBuchung[];
  herstellungen: HerstellungsZeile[];
  mahlzeiten: MahlzeitZeile[];
  /** sonstige Ausgaben seit Anfang des Vormonats */
  sonstige: SonstigeAusgabe[];
  /** Migration „planung_einkauf“ vorhanden? */
  planung: boolean;
  /** Migration „kosten_naehrwerte“ vorhanden? (Protokoll von Kochen/Produktion, Kosten je Charge) */
  protokoll: boolean;
  /** Migration „ausgaben“ vorhanden? (sonstige Ausgaben) */
  ausgaben: boolean;
};

export const LEER: Haushaltsdaten = {
  plaene: [], eintraege: [], status: [], auftauen: [], nutzung: [], einkaeufe: [], herstellungen: [], mahlzeiten: [], sonstige: [],
  planung: false, protokoll: false, ausgaben: false,
};

function heute(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function meldung(e: { message: string; code?: string }): string {
  if (/ausgabe/.test(e.message) && (e.code === 'PGRST205' || e.code === '42P01')) {
    return 'Dafür fehlt noch die Migration „ausgaben“ (siehe README).';
  }
  if (/essen|produzieren|einkaufen|mahlzeit|herstellung/.test(e.message) && (e.code === 'PGRST202' || e.code === 'PGRST205')) {
    return 'Dafür fehlt noch die Migration „kosten_naehrwerte“ (siehe README).';
  }
  if (fehltMigration(e) || e.code === 'PGRST205' || e.code === '42P01') return 'Dafür fehlt noch die Migration „planung_einkauf“ (siehe README).';
  if (/failed to fetch|networkerror|load failed/i.test(e.message)) return 'Keine Verbindung zur Datenbank. Bist du online?';
  return e.message;
}
function pruefe(error: { message: string; code?: string } | null) {
  if (error) throw new Error(meldung(error));
}

/** Lädt alles für Planung/Einkauf/Auftauen. Fehlt die Migration, gibt es leere Listen. */
export async function ladeHaushalt(): Promise<Haushaltsdaten> {
  // ab Anfang des Vormonats: für den Vergleich „bis zum gleichen Tag im Vormonat“
  const ab = vormonatsanfang(heute());
  const [plaene, eintraege, status, auftauen, nutzung, einkaeufe, herstellungen, mahlzeiten, sonstige] = await Promise.all([
    supabase.from('plan').select('*').eq('status', 'geplant').order('erstellt_am'),
    supabase.from('einkauf_eintrag').select('*').eq('status', 'offen').order('erstellt_am'),
    supabase.from('einkauf_status').select('schluessel, einheit, status'),
    supabase.from('auftauen').select('id, block_typ_id, menge, auftauen_am, plan_id, status'),
    supabase.from('nutzung').select('*'),
    supabase.from('einkauf_buchung').select('erstellt_am, preis_cent, rueckgaengig').gte('erstellt_am', ab),
    supabase.from('herstellung').select('datum, kosten_cent, kosten_unbekannt, rueckgaengig').gte('datum', ab),
    supabase.from('mahlzeit').select('datum, titel, portionen, kosten_cent, kosten_unbekannt, kcal, kcal_unbekannt, rueckgaengig').gte('datum', ab),
    supabase.from('ausgabe').select('id, datum, betrag_cent, notiz, entfernt').gte('datum', ab).order('datum', { ascending: false }),
  ]);
  if (plaene.error) return LEER; // Migration fehlt (oder keine Verbindung) → ohne Planung weiter
  const protokoll = !mahlzeiten.error && !herstellungen.error;
  return {
    plaene: (plaene.data ?? []) as Plan[],
    eintraege: (eintraege.data ?? []) as ListenEintrag[],
    status: (status.data ?? []) as ZeilenStatus[],
    auftauen: ((auftauen.data ?? []) as AuftauEintrag[]).filter((a) => a.status === 'geplant' || a.status === 'aufgetaut'),
    nutzung: (nutzung.data ?? []) as NutzungZeile[],
    einkaeufe: (einkaeufe.data ?? []) as EinkaufsBuchung[],
    herstellungen: protokoll ? (herstellungen.data ?? []) as HerstellungsZeile[] : [],
    mahlzeiten: protokoll ? (mahlzeiten.data ?? []) as MahlzeitZeile[] : [],
    sonstige: sonstige.error ? [] : (sonstige.data ?? []) as SonstigeAusgabe[],
    planung: true,
    protokoll,
    ausgaben: !sonstige.error,
  };
}

// ───────── Brücke zur Engine ─────────

export function alsVorratSorte(s: Sorte): VorratSorte {
  return {
    id: s.id,
    name: s.name,
    farbe: s.farbe,
    art: artVon(s),
    einheit: einheitVon(s),
    portion_menge: portionMengeVon(s),
    groesse_g: s.groesse_g,
    anzahl: s.anzahl,
    abgelaufen: s.abgelaufen ?? 0,
    kosten_cent: s.kosten_cent,
    kosten_menge: s.kosten_menge ?? 1,
    mindestbestand: s.mindestbestand,
    lagerort: s.lagerort ?? 'gefrierfach',
    herkunft: s.herkunft ?? null,
  };
}

/** Kalorien eines Gerichts aus dem AKTUELLEN Vorrat – gilt auch für gespeicherte und geplante Gerichte */
export function naehrwerteGericht(g: Gericht, bestand: Sorte[]): Naehrwerte {
  return naehrwerteFuerGericht(g, (id) => naehrwertVon(bestand, id));
}

/** Hinterlegte Nährwerte einer Sorte (für Gerichte, auch ältere gespeicherte) */
export function naehrwertVon(bestand: Sorte[], id: number | null): Naehrwert | null {
  const s = id === null ? undefined : bestand.find((b) => b.id === id);
  return s ? naehrwertAus(s, einheitVon(s)) : null;
}

export function planBedarf(p: Plan): PlanBedarf {
  const bedarf = p.daten.gericht
    ? bedarfAusGericht(p.daten.gericht)
    : p.daten.komponente
      ? bedarfAusKomponente(p.daten.komponente)
      : [];
  return { id: p.id, art: p.art, titel: p.titel, datum: p.datum, erstellt_am: p.erstellt_am, bedarf };
}

// ───────── Pläne ─────────

export async function planeGericht(g: Gericht, datum: string | null): Promise<string> {
  const { data, error } = await supabase
    .from('plan')
    .insert({ art: 'mahlzeit', titel: g.name, datum, portionen: g.portionen, daten: { gericht: g } })
    .select('id')
    .single();
  pruefe(error);
  return (data as { id: string }).id;
}

export async function planeKomponente(k: KomponentenVorschlag, blockTypId: number | null): Promise<string> {
  const { data, error } = await supabase
    .from('plan')
    .insert({ art: 'komponente', titel: k.name, datum: null, portionen: k.portionen, daten: { komponente: k, block_typ_id: blockTypId } })
    .select('id')
    .single();
  pruefe(error);
  return (data as { id: string }).id;
}

export async function aenderePlan(id: string, teil: Partial<Pick<Plan, 'datum' | 'titel' | 'portionen' | 'daten'>>): Promise<void> {
  const { error } = await supabase.from('plan').update(teil).eq('id', id);
  pruefe(error);
}

export async function entfernePlan(id: string): Promise<void> {
  const { error } = await supabase.from('plan').delete().eq('id', id);
  pruefe(error);
}

// ───────── Einkauf ─────────

export async function eintragHinzufuegen(e: {
  name: string; menge: number | null; einheit: Einheit | null; kategorie: ListenEintrag['kategorie'];
  quelle: ListenEintrag['quelle']; grund?: string | null; block_typ_id?: number | null;
}): Promise<void> {
  const { error } = await supabase.from('einkauf_eintrag').insert({
    name: e.name.trim().slice(0, 80),
    schluessel: produktSchluessel(e.name),
    menge: e.menge,
    einheit: e.menge === null ? null : e.einheit,
    kategorie: e.kategorie,
    quelle: e.quelle,
    grund: e.grund ?? null,
    block_typ_id: e.block_typ_id ?? null,
  });
  pruefe(error);
}

export async function eintragAendern(id: number, teil: { menge?: number | null; status?: 'offen' | 'geloescht' }): Promise<void> {
  const { error } = await supabase.from('einkauf_eintrag').update(teil).eq('id', id);
  pruefe(error);
}

/** Zeilenstatus setzen (null = wieder offen). */
export async function zeilenStatus(schluessel: string, einheit: string, status: ZeilenStatus['status'] | null): Promise<void> {
  const weg = await supabase.from('einkauf_status').delete().eq('schluessel', schluessel).eq('einheit', einheit);
  pruefe(weg.error);
  if (status) {
    const { error } = await supabase.from('einkauf_status').insert({ schluessel, einheit, status });
    pruefe(error);
  }
}

/** Gekaufte Menge in den Vorrat – nur einmal (die Datenbank sperrt die Zeile). Gibt die Buchung zurück. */
export async function einkaufBuchen(p: {
  schluessel: string; einheit: string; block_typ_id: number; menge: number; ablauf_am: string | null; preis_cent: number | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc('einkauf_buchen', {
    p_schluessel: p.schluessel,
    p_einheit: p.einheit,
    p_block_typ_id: p.block_typ_id,
    p_menge: p.menge,
    p_ablauf_am: p.ablauf_am,
    p_preis_cent: p.preis_cent,
  });
  pruefe(error);
  return data as number;
}

export async function einkaufRueckgaengig(buchungId: number): Promise<void> {
  const { error } = await supabase.rpc('einkauf_rueckgaengig', { p_buchung_id: buchungId });
  pruefe(error);
}

// ───────── Kochen & Herstellen (eine Transaktion) ─────────

type Posten = { block_typ_id: number; menge: number }[];

export async function kochen(posten: Posten, planId: string | null): Promise<number[]> {
  const { data, error } = await supabase.rpc('kochen', {
    p_posten: posten.map((p) => ({ block_typ_id: p.block_typ_id, menge: p.menge })),
    p_plan_id: planId,
  });
  pruefe(error);
  return data as number[];
}

export async function herstellen(posten: Posten, blockTypId: number, menge: number, ablaufAm: string | null, planId: string | null): Promise<number[]> {
  const { data, error } = await supabase.rpc('herstellen', {
    p_posten: posten.map((p) => ({ block_typ_id: p.block_typ_id, menge: p.menge })),
    p_block_typ_id: blockTypId,
    p_menge: menge,
    p_ablauf_am: ablaufAm,
    p_plan_id: planId,
  });
  pruefe(error);
  return data as number[];
}

export async function kochenRueckgaengig(ids: number[], planId: string | null): Promise<void> {
  const { error } = await supabase.rpc('kochen_rueckgaengig', { p_bewegung_ids: ids, p_plan_id: planId });
  pruefe(error);
}

// ───────── Auftauen ─────────

export async function auftauenVormerken(blockTypId: number, menge: number, auftauenAm: string, planId: string | null, sofort = false): Promise<void> {
  const { error } = await supabase.from('auftauen').insert({
    block_typ_id: blockTypId, menge, auftauen_am: auftauenAm, plan_id: planId, status: sofort ? 'aufgetaut' : 'geplant',
  });
  pruefe(error);
}

export async function auftauStatus(id: number, status: 'aufgetaut' | 'abgebrochen'): Promise<void> {
  const { error } = await supabase.from('auftauen').update({ status, geaendert_am: new Date().toISOString() }).eq('id', id);
  pruefe(error);
}

// ───────── Mit Protokoll (Migration „kosten_naehrwerte“) ─────────

export type EssenErgebnis = {
  mahlzeit_id: number; bewegung_ids: number[];
  kosten_cent: number | null; kosten_unbekannt: number; kcal: number | null; kcal_unbekannt: number;
};

/** Kochen + festhalten, was es tatsächlich gekostet hat (aus den entnommenen Chargen) – eine Transaktion. */
export async function essen(posten: Posten, planId: string | null, titel: string, portionen: number): Promise<EssenErgebnis> {
  const { data, error } = await supabase.rpc('essen', {
    p_posten: posten.map((p) => ({ block_typ_id: p.block_typ_id, menge: p.menge })),
    p_plan_id: planId,
    p_titel: titel,
    p_portionen: portionen,
  });
  pruefe(error);
  return data as EssenErgebnis;
}

export async function essenRueckgaengig(mahlzeitId: number): Promise<void> {
  const { error } = await supabase.rpc('essen_rueckgaengig', { p_mahlzeit_id: mahlzeitId });
  pruefe(error);
}

export type ProduktionErgebnis = {
  herstellung_id: number; bewegung_ids: number[];
  kosten_cent: number | null; kosten_bekannt_cent: number | null; kosten_unbekannt: number;
};

/** Herstellen mit tatsächlicher Menge und echten Kosten (nur wenn alle Zutatenpreise bekannt sind). */
export async function produzieren(posten: Posten, blockTypId: number, menge: number, ablaufAm: string | null, planId: string | null, nichtErfasst: number): Promise<ProduktionErgebnis> {
  const { data, error } = await supabase.rpc('produzieren', {
    p_posten: posten.map((p) => ({ block_typ_id: p.block_typ_id, menge: p.menge })),
    p_block_typ_id: blockTypId,
    p_menge: menge,
    p_ablauf_am: ablaufAm,
    p_plan_id: planId,
    p_nicht_erfasst: nichtErfasst,
  });
  pruefe(error);
  return data as ProduktionErgebnis;
}

export async function produzierenRueckgaengig(herstellungId: number): Promise<void> {
  const { error } = await supabase.rpc('produzieren_rueckgaengig', { p_herstellung_id: herstellungId });
  pruefe(error);
}

/** Direkt einbuchen mit bezahltem Preis – zählt als Einkaufsausgabe. */
export async function einkaufen(blockTypId: number, menge: number, ablaufAm: string | null, preisCent: number): Promise<number> {
  const { data, error } = await supabase.rpc('einkaufen', {
    p_block_typ_id: blockTypId, p_menge: menge, p_ablauf_am: ablaufAm, p_preis_cent: preisCent,
  });
  pruefe(error);
  return data as number;
}

// ───────── Sonstige Ausgaben (Migration „ausgaben“) ─────────

/** Eine sonstige Ausgabe eintragen – echter, bezahlter Betrag, nichts geschätzt. */
export async function ausgabeEintragen(betragCent: number, notiz: string | null, datum: string | null = null): Promise<void> {
  const zeile: { betrag_cent: number; notiz: string | null; datum?: string } = { betrag_cent: betragCent, notiz: notiz?.trim().slice(0, 80) || null };
  if (datum) zeile.datum = datum;
  const { error } = await supabase.from('ausgabe').insert(zeile);
  pruefe(error);
}

/** Nichts wird gelöscht: entfernen = ausblenden, zurückholen geht jederzeit. */
export async function ausgabeEntfernen(id: number, entfernt: boolean): Promise<void> {
  const { error } = await supabase.from('ausgabe').update({ entfernt }).eq('id', id);
  pruefe(error);
}
