// Gemeinsame Typen der Kombi-Empfehlungslogik.
// Reines TypeScript ohne Abhängigkeiten: läuft im Browser, in der Edge Function (Deno) und in Node-Tests.

export type Farbe = 'rot' | 'braun' | 'gruen' | 'gelb' | 'weiss' | 'schwarz' | 'blau';
export type Lagerort = 'gefrierfach' | 'kuehlschrank' | 'vorrat';

/** Woher eine Zutat stammt. Nur diese drei Quellen gelten als „vorhanden“. */
export type Quelle = 'bestand' | 'kuehlschrank' | 'grundausstattung';

// ───────── Snapshot: was der Haushalt tatsächlich hat ─────────

export type SnapshotZutat = {
  id: string; // 'b12' = Sorte 12 aus dem Bestand, 'k1' = Kühlschrank-Angabe, 'g-salz' = Grundausstattung
  quelle: Quelle;
  name: string;
  farbe: Farbe | null;
  lagerort: Lagerort | null;
  /** Blöcke/Portionen im Bestand; null = Menge unbekannt (Kühlschrank) bzw. unbegrenzt (Grundausstattung) */
  anzahl: number | null;
  groesse_g: number | null;
  /** Preis pro Block/Portion aus dem Bestand; null = kein Preis bekannt */
  kosten_cent: number | null;
  bald_verbrauchen: boolean;
  block_typ_id: number | null;
};

export type Snapshot = {
  datum: string;
  /** Nur, was wirklich da ist. */
  zutaten: SnapshotZutat[];
  /** Bekannte Preise, auch von gerade leeren Sorten – für Einkaufsvorschläge. */
  preise: { name: string; kosten_cent: number }[];
};

export type Optionen = {
  personen: number;
  max_minuten: number | null;
  guenstig: boolean;
};

// ───────── Eigenschaften eines Gerichts (Grundlage fürs Lernen) ─────────

export const GERICHTSTYPEN = [
  'pasta', 'curry', 'wrap', 'pfanne', 'suppe', 'eintopf', 'bowl', 'toast',
  'auflauf', 'salat', 'pizza', 'burger', 'aufwaermen', 'sonstiges',
] as const;
export const GESCHMACK = ['herzhaft', 'cremig', 'frisch', 'wuerzig', 'suesslich', 'rauchig', 'scharf'] as const;
export const KONSISTENZ = ['cremig', 'stueckig', 'knusprig', 'suppig', 'fest'] as const;
export const SATTMACHER = ['pasta', 'reis', 'brot', 'wrap', 'kartoffel', 'couscous', 'keiner', 'sonstiges'] as const;
export const GEWUERZRICHTUNGEN = [
  'italienisch', 'indisch', 'mexikanisch', 'asiatisch', 'orientalisch', 'deutsch', 'neutral',
] as const;
export const ZUBEREITUNG = ['pfanne', 'topf', 'ofen', 'aufwaermen', 'roh'] as const;

export type Gerichtstyp = (typeof GERICHTSTYPEN)[number];
export type Geschmack = (typeof GESCHMACK)[number];
export type Konsistenz = (typeof KONSISTENZ)[number];
export type Sattmacher = (typeof SATTMACHER)[number];
export type Gewuerzrichtung = (typeof GEWUERZRICHTUNGEN)[number];
export type Zubereitung = (typeof ZUBEREITUNG)[number];

export type Eigenschaften = {
  gerichtstyp: Gerichtstyp;
  hauptzutat: string;
  geschmack: Geschmack;
  schaerfe: 0 | 1 | 2 | 3;
  konsistenz: Konsistenz;
  sattmacher: Sattmacher;
  gewuerzrichtung: Gewuerzrichtung;
  zubereitung: Zubereitung;
};

// ───────── Rohantwort eines KI-Anbieters (ungeprüft!) ─────────

export type RohZutat = { id?: string | null; name?: string | null; bloecke?: number | null };

export type RohGericht = {
  name?: string;
  emoji?: string;
  zutaten?: RohZutat[];
  fehlt?: { name?: string }[];
  zeit_min?: number;
  schritte?: string[];
  begruendung?: string;
  eigenschaften?: Record<string, unknown>;
};

export type RohEinkauf = { name?: string; ermoeglicht?: string[]; begruendung?: string };
export type RohBaustein = {
  name?: string;
  farbe?: string;
  portionen?: number;
  verwendbar_fuer?: string[];
  begruendung?: string;
};

export type RohAntwort = {
  vorschlaege?: RohGericht[];
  einkauf?: RohEinkauf | null;
  baustein_idee?: RohBaustein | null;
};

// ───────── Geprüfte Vorschläge ─────────

export type GerichtZutat = {
  id: string;
  name: string;
  quelle: Quelle;
  farbe: Farbe | null;
  /** Blöcke für das ganze Essen; null bei Kühlschrank/Grundausstattung */
  bloecke: number | null;
  kosten_cent: number | null;
  bald_verbrauchen: boolean;
  block_typ_id: number | null;
};

export type FehlendeZutat = {
  name: string;
  grund: 'nicht_im_bestand' | 'zu_wenig';
  menge: number | null;
  /** Nur ein bekannter Preis aus dem Bestand – niemals geschätzt. */
  preis_cent: number | null;
};

export type Kosten = {
  gesamt_cent: number;
  pro_portion_cent: number;
  personen: number;
  /** false, wenn Zutaten ohne bekannten Preis (Kühlschrank, Sorten ohne Preis) dabei sind */
  vollstaendig: boolean;
  /** Summe der bekannten Preise fehlender Zutaten */
  einkauf_cent: number;
};

export type Gericht = {
  art: 'gericht';
  id: string;
  name: string;
  emoji: string;
  zutaten: GerichtZutat[];
  fehlt: FehlendeZutat[];
  zeit_min: number;
  schritte: string[];
  begruendung: string;
  warum_jetzt: string[];
  eigenschaften: Eigenschaften;
  kosten: Kosten;
  bewertung: number;
};

export type Einkaufsvorschlag = {
  art: 'einkauf';
  id: string;
  name: string;
  preis_cent: number | null;
  ermoeglicht: string[];
  begruendung: string;
};

export type BausteinIdee = {
  art: 'baustein';
  id: string;
  name: string;
  farbe: Farbe;
  portionen: number;
  verwendbar_fuer: string[];
  begruendung: string;
};

export type Vorschlag = Gericht | Einkaufsvorschlag | BausteinIdee;

// ───────── Session: Kontext für die nächste Anfrage ─────────

export type Aktion = 'like' | 'dislike' | 'similar' | 'skip' | 'save' | 'cook';

export type GerichtKurz = { name: string; eigenschaften: Eigenschaften; zutaten: string[] };

export type FeedbackEintrag = GerichtKurz & { vorschlag_id: string; aktion: Aktion };

export type Modus = { art: 'normal' } | { art: 'aehnlich'; zu: GerichtKurz };

export type KiAnfrage = {
  snapshot: Snapshot;
  optionen: Optionen;
  /** Bereits gezeigte Gerichte dieser Session (keine Wiederholungen) */
  gesehen: GerichtKurz[];
  /** Entscheidungen dieser Session in zeitlicher Reihenfolge */
  feedback: FeedbackEintrag[];
  modus: Modus;
  anzahl: number;
};

export type Tendenz = {
  dimension: 'gerichtstyp' | 'hauptzutat' | 'gewuerzrichtung' | 'sattmacher' | 'geschmack' | 'zubereitung';
  wert: string;
  positiv: number;
  negativ: number;
  /** −1 … +1, geglättet: eine einzelne Entscheidung zählt nur schwach */
  score: number;
};

export type Leitplanken = {
  /** 0 = normal … 3 = komplett andere Richtung (nach vielen Ablehnungen hintereinander) */
  radius: 0 | 1 | 2 | 3;
  ablehnungen_in_folge: number;
  ausschluss: {
    gerichtstyp: string[];
    gewuerzrichtung: string[];
    sattmacher: string[];
    hauptzutat: string[];
  };
  gemieden: Tendenz[];
  beliebt: Tendenz[];
  /** Vorsichtig formulierte Beobachtungen – für Nutzer und KI */
  muster: string[];
  anker: GerichtKurz | null;
};

/** Was ein KI-Anbieter bekommt: Anfrage plus abgeleitete Leitplanken. */
export type KiAuftrag = KiAnfrage & { leitplanken: Leitplanken; notfall: boolean };

export type Ergebnis = {
  anbieter: string;
  gerichte: Gericht[];
  einkauf: Einkaufsvorschlag | null;
  baustein_idee: BausteinIdee | null;
  notfall: boolean;
  leitplanken: Leitplanken;
  verworfen: { name: string; grund: string }[];
};

/** Schnittstelle für KI-Anbieter (Groq, Gemini, OpenRouter, Ollama, regelbasiert …). */
export interface KiAnbieter {
  readonly name: string;
  vorschlagen(auftrag: KiAuftrag): Promise<RohAntwort>;
}
