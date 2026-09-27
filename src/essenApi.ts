// Datenzugriffe für „Was essen wir?“.
// Die KI läuft in der Edge Function „was-essen“ (dort liegt der API-Key). Ist sie nicht eingerichtet
// oder gerade nicht verfügbar, rechnet die App selbst mit dem regelbasierten Anbieter (Demo-Modus).
// Protokollieren ist „best effort“: Klappt es nicht (z. B. Migration fehlt), läuft alles trotzdem.
import { supabase } from './supabase';
import { ladeBestand } from './api';
import { baueSnapshot, type BestandZeile } from '../supabase/functions/_shared/kombi/snapshot.ts';
import { erzeugeVorschlaege } from '../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { rezeptDatensatz } from '../supabase/functions/_shared/kombi/aktionen.ts';
import type {
  Aktion, Ergebnis, Gericht, KiAnfrage, Optionen, Snapshot, Vorschlag,
} from '../supabase/functions/_shared/kombi/typen.ts';

export type Quelle = 'ki' | 'demo';
export type Antwort = { ergebnis: Ergebnis; quelle: Quelle; hinweis: string | null };
export type Rezept = { id: string; name: string; daten: Gericht; erstellt_am: string };

function heute(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Kontrollierter Snapshot: aktueller Bestand + Kühlschrank-Freitext + Grundausstattung. */
export async function ladeSnapshot(kuehlschrank: string): Promise<Snapshot> {
  const bestand = await ladeBestand();
  const zeilen: BestandZeile[] = bestand.map((s) => ({
    id: s.id,
    name: s.name,
    farbe: s.farbe,
    anzahl: s.anzahl,
    bald_ablaufen: s.bald_ablaufen,
    groesse_g: s.groesse_g,
    kosten_cent: s.kosten_cent,
    lagerort: s.lagerort ?? 'gefrierfach',
  }));
  return baueSnapshot(zeilen, kuehlschrank, heute());
}

async function hinweisAus(error: unknown): Promise<string> {
  const antwort = (error as { context?: Response } | null)?.context;
  const status = antwort?.status;
  if (status === 503) return 'KI noch nicht eingerichtet (siehe README).';
  if (status === 404) return 'KI-Funktion nicht gefunden (siehe README).';
  let text = '';
  try {
    text = ((await antwort?.json()) as { fehler?: string } | undefined)?.fehler ?? '';
  } catch {
    // Antwort ohne JSON
  }
  if (status === 429) return text || 'Kostenloses KI-Kontingent gerade erschöpft.';
  return `KI gerade nicht verfügbar${text ? ` (${text})` : ''}.`;
}

/** Fragt die KI; bei Problemen übernimmt der regelbasierte Anbieter lokal. */
export async function holeVorschlaege(anfrage: KiAnfrage): Promise<Antwort> {
  let hinweis: string;
  try {
    const { data, error } = await supabase.functions.invoke('was-essen', { body: anfrage });
    const ergebnis = data as Ergebnis | null;
    if (!error && ergebnis && Array.isArray(ergebnis.gerichte)) return { ergebnis, quelle: 'ki', hinweis: null };
    hinweis = await hinweisAus(error);
  } catch {
    hinweis = 'KI nicht erreichbar.';
  }
  return { ergebnis: await erzeugeVorschlaege(regelbasiert(), anfrage), quelle: 'demo', hinweis };
}

export async function starteSession(id: string, optionen: Optionen, kuehlschrank: string): Promise<boolean> {
  const { error } = await supabase.from('koch_session').insert({
    id,
    personen: optionen.personen,
    max_minuten: optionen.max_minuten,
    guenstig: optionen.guenstig,
    kuehlschrank: kuehlschrank.trim() ? kuehlschrank.trim().slice(0, 1000) : null,
  });
  return !error;
}

/** Protokolliert gezeigte Vorschläge; liefert die IDs, die gespeichert wurden. */
export async function protokolliereVorschlaege(sessionId: string, vorschlaege: Vorschlag[], anbieter: string): Promise<string[]> {
  if (vorschlaege.length === 0) return [];
  const { error } = await supabase.from('vorschlag').insert(
    vorschlaege.map((v) => ({ id: v.id, session_id: sessionId, art: v.art, name: v.name, daten: v, anbieter })),
  );
  return error ? [] : vorschlaege.map((v) => v.id);
}

export async function protokolliereFeedback(vorschlagId: string, aktion: Aktion): Promise<void> {
  await supabase.from('vorschlag_feedback').insert({ vorschlag_id: vorschlagId, aktion });
}

export async function speichereRezept(g: Gericht, protokolliert: boolean): Promise<void> {
  const r = rezeptDatensatz(g);
  const { error } = await supabase
    .from('rezept')
    .insert({ name: r.name, daten: r.daten, vorschlag_id: protokolliert ? g.id : null });
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      throw new Error('Rezepte speichern geht erst nach der Migration „was_essen“ (siehe README).');
    }
    throw new Error(error.message);
  }
}

export async function ladeRezepte(): Promise<Rezept[]> {
  const { data, error } = await supabase
    .from('rezept')
    .select('id, name, daten, erstellt_am')
    .order('erstellt_am', { ascending: false })
    .limit(50);
  return error ? [] : (data as Rezept[]);
}
