// Health-Check der KI-Verbindung: Was ist eingerichtet (ohne Keys)? Und – auf Wunsch – ein echter,
// kleiner Probelauf durch die ganze Kette: KI → JSON → Schema → Kombi-Prüfung.
// So lässt sich nachvollziehen, ob die KI wirklich live angebunden ist, statt es zu behaupten.
import type { KiAnbieter, KiAnfrage, RohAntwort } from './typen.ts';
import { baueSnapshot } from './snapshot.ts';
import { erzeugeVorschlaege } from './engine.ts';
import { kiKonfiguration } from './anbieter/konfiguration.ts';

/** Version der Kombi-Engine – steht in App und Edge Function; weicht sie ab, ist die Function veraltet. */
export const ENGINE_VERSION = '2026-09-28.3';

export type KiProbe = {
  ok: boolean;
  ms: number;
  /** Der Anbieter hat geantwortet (false: Kontingent, Key, Modell, Netz – dann gibt es nichts zu prüfen) */
  antwort: boolean;
  /** Antwort war JSON (sonst Fehler vor der Prüfung) */
  json_gueltig: boolean;
  /** JSON hatte das erwartete Format (Liste „vorschlaege“) */
  schema_gueltig: boolean;
  vorschlaege_roh: number;
  gerichte: number;
  verworfen: { name: string; grund: string }[];
  /** Vorschläge mit Bildanforderung der KI / davon nach Prüfung übernommen */
  bildanforderungen: number;
  bildanforderungen_ok: number;
  namen: string[];
  fehler: string | null;
};

/** Kleiner, fester Haushalt für den Probelauf (keine echten Daten, nichts wird gespeichert). */
export const PROBE_ANFRAGE: KiAnfrage = {
  snapshot: baueSnapshot([
    { id: 1, name: 'Tomaten-Basis', farbe: 'rot', anzahl: 4, bald_ablaufen: false, groesse_g: 150, kosten_cent: 24, art: 'komponente', zusammensetzung: ['Tomaten', 'Zwiebeln', 'Knoblauch'] },
    { id: 2, name: 'Linsen gekocht', farbe: 'braun', anzahl: 4, bald_ablaufen: true, groesse_g: 150, kosten_cent: 12, art: 'komponente', zusammensetzung: ['Linsen'] },
    { id: 3, name: 'Spaghetti', farbe: 'gelb', anzahl: 500, bald_ablaufen: false, groesse_g: 125, kosten_cent: 99, art: 'zutat', einheit: 'g', portion_menge: 125, kosten_menge: 500, lagerort: 'vorrat' },
    { id: 4, name: 'Gurke', farbe: 'gruen', anzahl: 1, bald_ablaufen: false, groesse_g: 300, kosten_cent: 69, art: 'zutat', einheit: 'stueck', lagerort: 'kuehlschrank' },
    { id: 5, name: 'Joghurt', farbe: 'schwarz', anzahl: 500, bald_ablaufen: false, groesse_g: 100, kosten_cent: null, art: 'zutat', einheit: 'g', portion_menge: 100, lagerort: 'kuehlschrank' },
  ], '', '2026-09-28'),
  optionen: { personen: 2, max_minuten: 30, guenstig: true },
  gesehen: [],
  feedback: [],
  modus: { art: 'normal' },
  anzahl: 2,
};

/** Ein echter Aufruf mit dem Probe-Haushalt – misst Zeit, JSON, Schema und Prüfergebnis. */
export async function kiProbe(anbieter: KiAnbieter, jetzt: () => number = Date.now): Promise<KiProbe> {
  let roh: RohAntwort | null = null;
  const messend: KiAnbieter = {
    name: anbieter.name,
    async vorschlagen(a) {
      roh = await anbieter.vorschlagen(a);
      return roh;
    },
  };
  const start = jetzt();
  try {
    const e = await erzeugeVorschlaege(messend, PROBE_ANFRAGE);
    const r = roh as RohAntwort | null;
    const liste = Array.isArray(r?.vorschlaege) ? r!.vorschlaege! : [];
    return {
      ok: e.gerichte.length > 0,
      ms: jetzt() - start,
      antwort: true,
      json_gueltig: true,
      schema_gueltig: Array.isArray(r?.vorschlaege),
      vorschlaege_roh: liste.length,
      gerichte: e.gerichte.length,
      verworfen: e.verworfen.slice(0, 5),
      bildanforderungen: liste.filter((g) => g && typeof g === 'object' && g.image_request && typeof g.image_request === 'object').length,
      bildanforderungen_ok: e.gerichte.filter((g) => g.bild?.begriff_von === 'ki').length,
      namen: e.gerichte.map((g) => g.name),
      fehler: e.gerichte.length ? null : 'Kein Vorschlag hat die Prüfung bestanden.',
    };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    // Kam überhaupt eine Antwort? Kontingent, Key, Modell, Netz → nein; kein/ungültiges JSON oder falsches Format → ja.
    const antwort = /kein JSON|kein gültiges JSON|nicht das erwartete Format|Unerwartete Antwort/i.test(text);
    return {
      ok: false, ms: jetzt() - start,
      antwort,
      json_gueltig: antwort && /nicht das erwartete Format/i.test(text),
      schema_gueltig: false, vorschlaege_roh: 0, gerichte: 0, verworfen: [], bildanforderungen: 0, bildanforderungen_ok: 0, namen: [],
      fehler: text,
    };
  }
}

export type Gesundheit = {
  ok: true;
  version: string;
  ki: ReturnType<typeof kiKonfiguration>;
  bilder: { suche: 'wikimedia-commons' | 'aus'; generierung: { eingerichtet: boolean; anbieter: string | null; modell: string | null; speicher: boolean } };
  probe?: KiProbe;
};

export function gesundheit(env: (name: string) => string | undefined, generator: { name: string; modell: string } | null, speicher: boolean): Gesundheit {
  return {
    ok: true,
    version: ENGINE_VERSION,
    ki: kiKonfiguration(env),
    bilder: {
      suche: env('BILD_SUCHE')?.trim().toLowerCase() === 'aus' ? 'aus' : 'wikimedia-commons',
      generierung: { eingerichtet: !!generator && speicher, anbieter: generator?.name ?? null, modell: generator?.modell ?? null, speicher },
    },
  };
}
