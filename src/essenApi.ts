// Datenzugriffe für „Was essen wir?“.
// Die KI läuft in der Edge Function „was-essen“ (dort liegt der API-Key). Ist sie nicht eingerichtet
// oder gerade nicht verfügbar, rechnet die App selbst mit dem regelbasierten Anbieter (Demo-Modus).
// Protokollieren ist „best effort“: Klappt es nicht (z. B. Migration fehlt), läuft alles trotzdem.
import { supabase, SUPABASE_KEY, SUPABASE_URL } from './supabase';
import { ENGINE_VERSION, type Gesundheit, type KiProbe } from '../supabase/functions/_shared/kombi/gesundheit.ts';
import { fehltMigration, ladeBestand, type Sorte } from './api';
import { baueSnapshot, type BestandZeile } from '../supabase/functions/_shared/kombi/snapshot.ts';
import { erzeugeKomponenten, erzeugeVorschlaege, erzeugeWoche } from '../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { rezeptDatensatz } from '../supabase/functions/_shared/kombi/aktionen.ts';
import { UNBEKANNTE_NAEHRWERTE } from '../supabase/functions/_shared/kombi/naehrwerte.ts';
import { kurz } from '../supabase/functions/_shared/kombi/bewertung.ts';
import type {
  Aktion, Ergebnis, Gericht, GerichtKurz, KiAnfrage, KomponentenErgebnis, Optionen, Snapshot, Vorschlag,
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
    gerichtstypen: s.gerichtstypen ?? null,
    richtung: s.richtung ?? null,
    aufgetaut: s.aufgetaut ?? null,
    kcal: s.kcal ?? null,
    protein_g: s.protein_g ?? null,
    kohlenhydrate_g: s.kohlenhydrate_g ?? null,
    fett_g: s.fett_g ?? null,
    naehrwert_menge: s.naehrwert_menge ?? null,
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

/**
 * Antworten einer noch nicht neu deployten Edge Function haben das alte Format
 * (ohne Beschreibung, Gerichtsart, Kostenstatus …). Sie werden ins neue Format gebracht,
 * damit nichts abstürzt – und die App bittet um ein Update.
 */
export function normalisiereErgebnis(e: Ergebnis): { ergebnis: Ergebnis; veraltet: boolean } {
  const veraltet = e.gerichte.some((g) => !('gerichtsart' in g)) ||
    (!!e.einkauf && !('gruende' in e.einkauf)) || (!!e.baustein_idee && !('kosten' in e.baustein_idee));
  if (!veraltet) return { ergebnis: e, veraltet };
  const unbekannt: Gericht['kosten'] = {
    status: 'unbekannt', gesamt_cent: null, pro_portion_cent: null, personen: 1,
    unbekannt: [], einkauf_cent: null, einkauf_unbekannt: [],
  };
  const b = e.baustein_idee as (Partial<NonNullable<Ergebnis['baustein_idee']>> & { name: string; id: string; farbe: NonNullable<Ergebnis['baustein_idee']>['farbe'] }) | null;
  return {
    veraltet,
    ergebnis: {
      ...e,
      gerichte: e.gerichte.map(gespeichertesGericht),
      einkauf: e.einkauf
        ? { ...e.einkauf, preis_bezug: e.einkauf.preis_bezug ?? null, heute: e.einkauf.heute ?? null, gruende: e.einkauf.gruende ?? [] }
        : null,
      baustein_idee: b
        ? {
            art: 'baustein', id: b.id, name: b.name, farbe: b.farbe,
            bestandsart: b.bestandsart ?? (b.farbe === 'blau' ? 'komplettgericht' : 'komponente'),
            lagerort: b.lagerort ?? 'gefrierfach', portionen: b.portionen ?? 6, portion_g: b.portion_g ?? null,
            zutaten: b.zutaten ?? [], verwendbar_fuer: b.verwendbar_fuer ?? [], kosten: b.kosten ?? unbekannt,
            begruendung: b.begruendung ?? '',
          }
        : null,
      leitplanken: { ...e.leitplanken, kurzfristig_meiden: e.leitplanken?.kurzfristig_meiden ?? [], vielfalt_sperre: e.leitplanken?.vielfalt_sperre ?? { gerichtstyp: [], sattmacher: [] } },
    },
  };
}

const ALTE_VERSION = 'Die KI-Funktion auf Supabase ist noch die alte Version – bitte neu deployen (siehe README).';
/** Länger wartet niemand am Handy – danach übernehmen die Kombi-Regeln. */
const KI_ZEITLIMIT_MS = 40_000;

/** Ruft die Edge Function; liefert die Antwort oder einen verständlichen Hinweis. */
async function rufeKi(anfrage: KiAnfrage): Promise<{ daten: Record<string, unknown> } | { hinweis: string }> {
  try {
    const zeitlimit = new Promise<'zeit'>((ja) => setTimeout(() => ja('zeit'), KI_ZEITLIMIT_MS));
    const r = await Promise.race([supabase.functions.invoke('was-essen', { body: anfrage }), zeitlimit]);
    if (r === 'zeit') return { hinweis: 'Die KI hat zu lange gebraucht – Vorschläge nach Kombi-Regeln.' };
    const { data, error } = r as { data: unknown; error: unknown };
    if (!error && data && typeof data === 'object') return { daten: data as Record<string, unknown> };
    return { hinweis: await hinweisAus(error) };
  } catch {
    return { hinweis: 'KI nicht erreichbar.' };
  }
}

/** Hinweis, wenn die Function eine andere Engine-Version hat (Prüflogik könnte veraltet sein). */
function versionsHinweis(daten: Record<string, unknown>): string | null {
  const v = daten.version;
  if (typeof v !== 'string') return null; // ältere Function ohne Versionsangabe → siehe ALTE_VERSION
  return v === ENGINE_VERSION ? null : `Die KI-Funktion auf Supabase hat Version ${v}, die App ${ENGINE_VERSION} – bitte neu deployen.`;
}

export type KiStatus =
  | { art: 'laedt' }
  | { art: 'nicht_erreichbar'; hinweis: string }
  | { art: 'alt'; hinweis: string }
  | { art: 'ok'; gesundheit: Gesundheit; aktuell: boolean };

/**
 * Health-Check der Edge Function (GET, ohne Keys). Mit probe=true zusätzlich ein echter kleiner
 * KI-Aufruf: Antwortzeit, JSON, Schema, Prüfergebnis. Ändert nichts im Haushalt.
 */
export async function pruefeKi(probe = false): Promise<KiStatus & { probe?: KiProbe }> {
  if (!SUPABASE_URL) return { art: 'nicht_erreichbar', hinweis: 'Supabase ist nicht eingerichtet.' };
  try {
    const r = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/was-essen${probe ? '?probe=1' : ''}`, {
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(probe ? 60_000 : 15_000),
    });
    if (r.status === 404) return { art: 'nicht_erreichbar', hinweis: 'Die KI-Funktion ist noch nicht deployt – Vorschläge kommen nach Kombi-Regeln (Demo).' };
    if (r.status === 405) return { art: 'alt', hinweis: ALTE_VERSION };
    if (!r.ok) return { art: 'nicht_erreichbar', hinweis: `KI-Funktion antwortet mit Fehler ${r.status}.` };
    const g = (await r.json()) as Gesundheit;
    return { art: 'ok', gesundheit: g, aktuell: g.version === ENGINE_VERSION, probe: g.probe };
  } catch {
    return { art: 'nicht_erreichbar', hinweis: 'KI-Funktion nicht erreichbar (offline?).' };
  }
}

/** Fragt die KI; bei Problemen übernimmt der regelbasierte Anbieter lokal. */
export async function holeVorschlaege(anfrage: KiAnfrage): Promise<Antwort> {
  const r = await rufeKi(anfrage);
  let hinweis: string;
  if ('daten' in r && Array.isArray(r.daten.gerichte)) {
    const { ergebnis, veraltet } = normalisiereErgebnis(r.daten as unknown as Ergebnis);
    // Ältere Versionen (ohne Feld „aufgabe“) kennen den Reste-Modus nicht – dann lokal nach Kombi-Regeln.
    const kenntReste = !veraltet && 'aufgabe' in r.daten;
    if (anfrage.modus.art !== 'reste' || kenntReste) {
      return { ergebnis, quelle: 'ki', hinweis: veraltet ? ALTE_VERSION : versionsHinweis(r.daten) };
    }
    hinweis = ALTE_VERSION;
  } else {
    hinweis = 'hinweis' in r ? r.hinweis : 'KI-Antwort unvollständig.';
  }
  return { ergebnis: await erzeugeVorschlaege(regelbasiert(), anfrage), quelle: 'demo', hinweis };
}

/**
 * Mahlzeiten für mehrere Tage – gegen den FREIEN Vorrat, ohne eine Portion doppelt zu verplanen.
 * Kennt die Edge Function die Wochenplanung noch nicht, plant Kombi lokal nach Regeln.
 */
export async function holeWoche(anfrage: KiAnfrage): Promise<Antwort> {
  const r = await rufeKi({ ...anfrage, aufgabe: 'woche' });
  if ('daten' in r && r.daten.aufgabe === 'woche' && Array.isArray(r.daten.gerichte)) {
    return { ergebnis: r.daten as unknown as Ergebnis, quelle: 'ki', hinweis: null };
  }
  const hinweis = 'daten' in r ? ALTE_VERSION : r.hinweis;
  return { ergebnis: await erzeugeWoche(regelbasiert(), { ...anfrage, aufgabe: 'woche' }), quelle: 'demo', hinweis };
}

export type KomponentenAntwort = { ergebnis: KomponentenErgebnis; quelle: Quelle; hinweis: string | null };

/** „Komponenten entdecken“: Ideen der KI, geprüft von der Software. Speichert nichts. */
export async function holeKomponenten(anfrage: KiAnfrage): Promise<KomponentenAntwort> {
  const r = await rufeKi({ ...anfrage, aufgabe: 'komponenten' });
  if ('daten' in r && Array.isArray(r.daten.komponenten)) {
    return { ergebnis: r.daten as unknown as KomponentenErgebnis, quelle: 'ki', hinweis: null };
  }
  const hinweis = 'daten' in r ? ALTE_VERSION : r.hinweis;
  return { ergebnis: await erzeugeKomponenten(regelbasiert(), { ...anfrage, aufgabe: 'komponenten' }), quelle: 'demo', hinweis };
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
    // ältere Vorschläge kennen keine Nährwerte – die App rechnet sie aus dem aktuellen Vorrat nach
    naehrwerte: alt.naehrwerte ?? UNBEKANNTE_NAEHRWERTE,
  };
}

/** Lieblingsrezepte als Kontext für die KI (nur Name, Eigenschaften, Zutatennamen). */
export function favoritenAus(rezepte: Rezept[]): GerichtKurz[] {
  return rezepte
    .filter((r) => r.daten?.eigenschaften && Array.isArray(r.daten.zutaten))
    .slice(0, 10)
    .map((r) => kurz(r.daten));
}
