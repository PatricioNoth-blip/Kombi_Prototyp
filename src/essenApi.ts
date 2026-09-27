// Datenzugriffe für „Was essen wir?“.
// Die KI läuft in der Edge Function „was-essen“ (dort liegt der API-Key). Ist sie nicht eingerichtet
// oder gerade nicht verfügbar, rechnet die App selbst mit dem regelbasierten Anbieter (Demo-Modus).
// Protokollieren ist „best effort“: Klappt es nicht (z. B. Migration fehlt), läuft alles trotzdem.
import { supabase } from './supabase';
import { fehltMigration, ladeBestand, type Sorte } from './api';
import { baueSnapshot, type BestandZeile } from '../supabase/functions/_shared/kombi/snapshot.ts';
import { erzeugeVorschlaege } from '../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { rezeptDatensatz } from '../supabase/functions/_shared/kombi/aktionen.ts';
import { kurz } from '../supabase/functions/_shared/kombi/bewertung.ts';
import type {
  Aktion, Ergebnis, Gericht, GerichtKurz, KiAnfrage, Optionen, Snapshot, Vorschlag,
} from '../supabase/functions/_shared/kombi/typen.ts';

export type Quelle = 'ki' | 'demo';
export type Antwort = { ergebnis: Ergebnis; quelle: Quelle; hinweis: string | null };
export type Rezept = { id: string; name: string; daten: Gericht; erstellt_am: string };

function heute(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Kontrollierter Snapshot: aktueller Bestand + Kühlschrank-Freitext + Grundausstattung. */
export function baueSnapshotAus(bestand: Sorte[], kuehlschrank: string): Snapshot {
  const zeilen: BestandZeile[] = bestand.map((s) => ({
    id: s.id,
    name: s.name,
    farbe: s.farbe,
    anzahl: s.anzahl,
    bald_ablaufen: s.bald_ablaufen,
    groesse_g: s.groesse_g,
    kosten_cent: s.kosten_cent,
    lagerort: s.lagerort ?? 'gefrierfach',
    art: s.art ?? null,
    herkunft: s.herkunft ?? null,
    einheit: s.einheit ?? null,
    portion_menge: s.portion_menge ?? null,
    kosten_menge: s.kosten_menge ?? null,
    zusammensetzung: s.zusammensetzung ?? null,
    notiz: s.notiz ?? null,
    naechster_ablauf: s.naechster_ablauf ?? null,
    geoeffnet: s.geoeffnet ?? null,
    abgelaufen: s.abgelaufen ?? null,
  }));
  return baueSnapshot(zeilen, kuehlschrank, heute());
}

/** Frisch aus der Datenbank – damit die KI den aktuellen Stand bekommt. */
export async function ladeSnapshot(kuehlschrank: string): Promise<Snapshot> {
  return baueSnapshotAus(await ladeBestand(), kuehlschrank);
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

/** Speichert strukturiert; ohne Migration „baukasten“ nur Name + vollständiger Vorschlag. */
export async function speichereRezept(g: Gericht, protokolliert: boolean, feedback: Aktion[] = []): Promise<void> {
  const r = rezeptDatensatz(g, feedback);
  const basis = { name: r.name, daten: r.daten, vorschlag_id: protokolliert ? g.id : null };
  let { error } = await supabase.from('rezept').insert({
    ...basis,
    gerichtstyp: r.gerichtstyp,
    portionen: r.portionen,
    zutaten: r.zutaten,
    schritte: r.schritte,
    bestandsarten: r.bestandsarten,
    tags: r.tags,
    kosten_pro_portion_cent: r.kosten_pro_portion_cent,
    kosten_status: r.kosten_status,
    feedback: r.feedback,
  });
  if (fehltMigration(error)) ({ error } = await supabase.from('rezept').insert(basis));
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
  if (error) return [];
  return (data as Rezept[]).map((r) => ({ ...r, daten: gespeichertesGericht(r.daten) }));
}

/**
 * Ältere gespeicherte Rezepte (vor dem Baukasten) haben „bloecke“ statt Mengen und eine
 * einfachere Kostenangabe. Sie werden hier ins aktuelle Format gebracht – ohne etwas zu erfinden:
 * Unbekanntes bleibt unbekannt.
 */
export function gespeichertesGericht(roh: Gericht): Gericht {
  const alt = roh;
  const zutaten = (alt.zutaten ?? []).map((z) => {
    const a = z as Partial<typeof z> & { bloecke?: number | null };
    const menge = z.menge ?? a.bloecke ?? null;
    return {
      ...z,
      art: z.art ?? null,
      einheit: z.einheit ?? 'portion',
      menge,
      portionen: z.portionen ?? menge,
      // Alte Rezepte: kosten_cent war der Preis pro Block → Wert = Blöcke × Preis (wie damals gerechnet).
      kosten_cent: a.einheit !== undefined ? z.kosten_cent : a.kosten_cent != null && menge != null ? a.kosten_cent * menge : null,
      geoeffnet: z.geoeffnet ?? false,
      zusammensetzung: z.zusammensetzung ?? null,
    };
  });
  const k = (alt.kosten ?? {}) as Partial<Gericht['kosten']> & { vollstaendig?: boolean };
  const kosten: Gericht['kosten'] = k.status
    ? (k as Gericht['kosten'])
    : {
        status: k.vollstaendig ? 'berechnet' : 'teilweise',
        gesamt_cent: k.gesamt_cent ?? null,
        pro_portion_cent: k.pro_portion_cent ?? null,
        personen: k.personen ?? 2,
        unbekannt: [],
        einkauf_cent: null,
        einkauf_unbekannt: [],
      };
  return {
    ...alt,
    beschreibung: alt.beschreibung ?? '',
    gerichtsart: alt.gerichtsart ?? 'rezept',
    zutaten,
    fehlt: (alt.fehlt ?? []).map((f) => ({ ...f, einheit: f.einheit ?? null, preis_bezug: f.preis_bezug ?? null })),
    portionen: alt.portionen ?? kosten.personen,
    rettet: alt.rettet ?? [],
    hinweise: alt.hinweise ?? [],
    warum_jetzt: alt.warum_jetzt ?? [],
    schritte: alt.schritte ?? [],
    kosten,
  };
}

/** Lieblingsrezepte als Kontext für die KI (nur Name, Eigenschaften, Zutatennamen). */
export function favoritenAus(rezepte: Rezept[]): GerichtKurz[] {
  return rezepte
    .filter((r) => r.daten?.eigenschaften && Array.isArray(r.daten.zutaten))
    .slice(0, 10)
    .map((r) => kurz(r.daten));
}
