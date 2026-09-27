// Gemeinsame Typen der Kombi-Empfehlungslogik.
// Reines TypeScript ohne Abhängigkeiten: läuft im Browser, in der Edge Function (Deno) und in Node-Tests.

export type Farbe = 'rot' | 'braun' | 'gruen' | 'gelb' | 'weiss' | 'schwarz' | 'blau';
export type Lagerort = 'gefrierfach' | 'kuehlschrank' | 'vorrat';

/**
 * Was ein Lebensmittel ist:
 *   zutat           – einzelnes Lebensmittel (Pasta, Reis, Dosentomaten …)
 *   komponente      – vorbereiteter Baustein (Tomatensoße, gekochte Linsen …)
 *   komplettgericht – wird als Ganzes gegessen (Pizza, Lasagne-Portion …)
 */
export type Art = 'zutat' | 'komponente' | 'komplettgericht';
export type Herkunft = 'selbstgemacht' | 'gekauft';
/** Worin der Bestand gezählt wird. Die Menge ist immer eine ganze Zahl dieser Einheit. */
export type Einheit = 'portion' | 'stueck' | 'g' | 'ml';
export const ARTEN: readonly Art[] = ['zutat', 'komponente', 'komplettgericht'];
export const EINHEITEN: readonly Einheit[] = ['portion', 'stueck', 'g', 'ml'];

/** Woher eine Zutat stammt. Nur diese drei Quellen gelten als „vorhanden“. */
export type Quelle = 'bestand' | 'kuehlschrank' | 'grundausstattung';

// ───────── Snapshot: was der Haushalt tatsächlich hat ─────────

export type SnapshotZutat = {
  id: string; // 'b12' = Sorte 12 aus dem Bestand, 'k1' = Kühlschrank-Angabe, 'g-salz' = Grundausstattung
  quelle: Quelle;
  name: string;
  farbe: Farbe | null;
  lagerort: Lagerort | null;
  /** null = unbekannt (Kühlschrank-Angabe, Grundausstattung) */
  art: Art | null;
  herkunft: Herkunft | null;
  einheit: Einheit;
  /** Verwendbare Menge in `einheit` (ohne Abgelaufenes); null = unbekannt bzw. unbegrenzt */
  anzahl: number | null;
  /** Einheiten pro Portion (bei „portion“ immer 1) */
  portion_menge: number;
  groesse_g: number | null;
  /** Gespeicherter Preis für `kosten_menge` Einheiten; null = Preis unbekannt */
  kosten_cent: number | null;
  kosten_menge: number;
  /** Bekannte Bestandteile; null = unbekannt (dann darf nichts über den Inhalt behauptet werden) */
  zusammensetzung: string[] | null;
  notiz: string | null;
  bald_verbrauchen: boolean;
  /** angebrochen – zuerst verbrauchen */
  geoeffnet: boolean;
  /** kleiner Rest (weniger als zwei Portionen bzw. Kühlschrank-Rest) */
  rest: boolean;
  /** Tage bis zum bekannten Ablaufdatum; null = kein Datum bekannt */
  tage_bis_ablauf: number | null;
  /** aus dem Gefrierfach genommen und aufgetaut – heute verbrauchen */
  aufgetaut: boolean;
  /** wofür sich die Sorte eignet (hinterlegt); null = nicht hinterlegt */
  gerichtstypen: Gerichtstyp[] | null;
  richtung: Gewuerzrichtung | null;
  block_typ_id: number | null;
};

/** Bekannter Preis einer Sorte (auch wenn sie gerade leer ist) – Grundlage für Einkaufspreise. */
export type PreisInfo = {
  name: string;
  kosten_cent: number;
  kosten_menge: number;
  einheit: Einheit;
  portion_menge: number;
};

export type Snapshot = {
  datum: string;
  /** Nur, was wirklich da ist. */
  zutaten: SnapshotZutat[];
  /** Bekannte Preise, auch von gerade leeren Sorten – für Einkaufsvorschläge. */
  preise: PreisInfo[];
  /** Mengen, die wegen abgelaufenem Datum nicht eingeplant werden */
  abgelaufen: { name: string; menge: number; einheit: Einheit }[];
};

export type Optionen = {
  personen: number;
  max_minuten: number | null;
  guenstig: boolean;
};

// ───────── Eigenschaften eines Gerichts (Grundlage fürs Lernen) ─────────

export const GERICHTSTYPEN = [
  'pasta', 'curry', 'wrap', 'pfanne', 'suppe', 'eintopf', 'bowl', 'toast', 'reisgericht',
  'auflauf', 'salat', 'pizza', 'burger', 'snack', 'aufwaermen', 'sonstiges',
] as const;
export const GESCHMACK = ['herzhaft', 'cremig', 'frisch', 'wuerzig', 'suesslich', 'rauchig', 'scharf'] as const;
export const KONSISTENZ = ['cremig', 'stueckig', 'knusprig', 'suppig', 'fest'] as const;
export const SATTMACHER = ['pasta', 'reis', 'brot', 'wrap', 'kartoffel', 'couscous', 'keiner', 'sonstiges'] as const;
export const GEWUERZRICHTUNGEN = [
  'italienisch', 'indisch', 'mexikanisch', 'asiatisch', 'orientalisch', 'deutsch', 'neutral',
] as const;
export const ZUBEREITUNG = ['pfanne', 'topf', 'ofen', 'aufwaermen', 'roh'] as const;
export const TEMPERATUR = ['warm', 'kalt'] as const;

export type Gerichtstyp = (typeof GERICHTSTYPEN)[number];
export type Geschmack = (typeof GESCHMACK)[number];
export type Konsistenz = (typeof KONSISTENZ)[number];
export type Sattmacher = (typeof SATTMACHER)[number];
export type Gewuerzrichtung = (typeof GEWUERZRICHTUNGEN)[number];
export type Zubereitung = (typeof ZUBEREITUNG)[number];
export type Temperatur = (typeof TEMPERATUR)[number];

export type Eigenschaften = {
  gerichtstyp: Gerichtstyp;
  hauptzutat: string;
  geschmack: Geschmack;
  schaerfe: 0 | 1 | 2 | 3;
  konsistenz: Konsistenz;
  sattmacher: Sattmacher;
  gewuerzrichtung: Gewuerzrichtung;
  zubereitung: Zubereitung;
  temperatur: Temperatur;
};

// ───────── Rohantwort eines KI-Anbieters (ungeprüft!) ─────────

export type RohFehlt = { name?: string; menge?: number | null; einheit?: string | null };

/**
 * portionen = Portionen dieses Eintrags für das ganze Essen; bloecke = ältere Schreibweise dafür.
 * menge/einheit nur für Zutaten, die eingekauft werden müssen (Komponenten-Vorschläge).
 */
export type RohZutat = {
  id?: string | null;
  name?: string | null;
  portionen?: number | null;
  bloecke?: number | null;
  menge?: number | null;
  einheit?: string | null;
};

export type RohGericht = {
  name?: string;
  emoji?: string;
  beschreibung?: string;
  zutaten?: RohZutat[];
  fehlt?: RohFehlt[];
  zeit_min?: number;
  schritte?: string[];
  begruendung?: string;
  eigenschaften?: Record<string, unknown>;
};

export type RohEinkauf = { name?: string; ermoeglicht?: string[]; begruendung?: string };
export type RohBaustein = {
  name?: string;
  art?: string;
  farbe?: string;
  lagerort?: string;
  portionen?: number;
  portion_g?: number;
  zutaten?: RohZutat[];
  verwendbar_fuer?: string[];
  begruendung?: string;
};

export type RohKomponente = {
  name?: string;
  beschreibung?: string;
  rolle?: string;
  richtung?: string;
  gerichtstypen?: string[];
  verwendung?: string[];
  zutaten?: RohZutat[];
  portionen?: number;
  portion_g?: number;
  lagerort?: string;
  zeit_min?: number;
  schritte?: string[];
};

export type RohAntwort = {
  vorschlaege?: RohGericht[];
  einkauf?: RohEinkauf | null;
  baustein_idee?: RohBaustein | null;
  komponenten?: RohKomponente[];
};

// ───────── Geprüfte Vorschläge ─────────

export type GerichtZutat = {
  id: string;
  name: string;
  quelle: Quelle;
  farbe: Farbe | null;
  art: Art | null;
  einheit: Einheit;
  /** Menge in `einheit` für das ganze Essen (wird so entnommen); null bei Kühlschrank/Grundausstattung */
  menge: number | null;
  /** dieselbe Menge in Portionen (zur Anzeige) */
  portionen: number | null;
  /** Wert dieser Menge, von der Software berechnet; null = Preis unbekannt */
  kosten_cent: number | null;
  bald_verbrauchen: boolean;
  geoeffnet: boolean;
  zusammensetzung: string[] | null;
  block_typ_id: number | null;
};

export type FehlendeZutat = {
  name: string;
  grund: 'nicht_im_bestand' | 'zu_wenig';
  /** fehlende Menge in `einheit`, falls bekannt */
  menge: number | null;
  einheit: Einheit | null;
  /** Nur ein bekannter Preis aus dem Bestand – niemals geschätzt. */
  preis_cent: number | null;
  /** worauf sich preis_cent bezieht, z. B. „für 500 g“ */
  preis_bezug: string | null;
};

/**
 * berechnet – alle Preise bekannt
 * teilweise – einige Preise unbekannt: Summe der bekannten, `unbekannt` nennt den Rest
 * unbekannt – kein einziger Preis bekannt
 */
export type PreisStatus = 'berechnet' | 'teilweise' | 'unbekannt';

export type Kosten = {
  status: PreisStatus;
  /** Wert der verwendeten Bestandsmengen; null, wenn unbekannt */
  gesamt_cent: number | null;
  pro_portion_cent: number | null;
  personen: number;
  /** Zutaten ohne bekannten Preis */
  unbekannt: string[];
  /** Summe der bekannten Preise fehlender Zutaten; null, wenn keiner bekannt */
  einkauf_cent: number | null;
  einkauf_unbekannt: string[];
};

/**
 * komplett      – ein Komplettgericht als Ganzes („heute einfach die Pizza“)
 * komplett_plus – Komplettgericht mit Beilage aus dem Bestand („Suppe + Brötchen“)
 * rezept        – aus Zutaten und Komponenten zusammengestellt
 */
export type Gerichtsart = 'komplett' | 'komplett_plus' | 'rezept';

export type Gericht = {
  art: 'gericht';
  id: string;
  name: string;
  emoji: string;
  /** ein appetitlicher Satz – nur mit Zutaten, die es wirklich gibt */
  beschreibung: string;
  gerichtsart: Gerichtsart;
  zutaten: GerichtZutat[];
  fehlt: FehlendeZutat[];
  zeit_min: number;
  portionen: number;
  schritte: string[];
  begruendung: string;
  warum_jetzt: string[];
  /** Lebensmittel, die dieses Gericht vor dem Verderben rettet (geöffnet, bald ablaufend, Reste) */
  rettet: string[];
  /** Was die Software nicht weiß, z. B. „Zusammensetzung von Pizza unbekannt“ */
  hinweise: string[];
  eigenschaften: Eigenschaften;
  kosten: Kosten;
  bewertung: number;
};

export type Einkaufsvorschlag = {
  art: 'einkauf';
  id: string;
  name: string;
  /** bekannter Preis aus dem Bestand; null = unbekannt (wird nie geschätzt) */
  preis_cent: number | null;
  preis_bezug: string | null;
  ermoeglicht: string[];
  /** konkrete Kombination mit dem, was schon da ist */
  heute: string | null;
  /** von der Software ermittelte Gründe (Haltbarkeit, Lagerung, passt zu …) */
  gruende: string[];
  begruendung: string;
};

export type BausteinIdee = {
  art: 'baustein';
  id: string;
  name: string;
  bestandsart: Art;
  farbe: Farbe;
  lagerort: Lagerort;
  portionen: number;
  portion_g: number | null;
  zutaten: string[];
  verwendbar_fuer: string[];
  /** Kosten pro Portion, nur wenn aus bekannten Preisen berechenbar */
  kosten: Kosten;
  begruendung: string;
};

export type Vorschlag = Gericht | Einkaufsvorschlag | BausteinIdee;

// ───────── Session: Kontext für die nächste Anfrage ─────────

export type Aktion = 'like' | 'dislike' | 'similar' | 'skip' | 'save' | 'cook';

export type GerichtKurz = { name: string; eigenschaften: Eigenschaften; zutaten: string[] };

export type FeedbackEintrag = GerichtKurz & { vorschlag_id: string; aktion: Aktion };

/** normal · ähnlich zu einem Gericht · Resteverwertung („Was sollte heute weg?“) */
export type Modus = { art: 'normal' } | { art: 'aehnlich'; zu: GerichtKurz } | { art: 'reste' };

/** gerichte = Abendessen-Vorschläge · komponenten = „Komponenten entdecken“ · woche = Planung */
export type Aufgabe = 'gerichte' | 'komponenten' | 'woche';

export type KiAnfrage = {
  snapshot: Snapshot;
  optionen: Optionen;
  /** Bereits gezeigte Gerichte dieser Session in Reihenfolge (keine Wiederholungen, Abwechslung) */
  gesehen: GerichtKurz[];
  /** Gespeicherte Lieblingsrezepte (optional): Inspiration für die KI, leichtes Plus in der Rangfolge */
  favoriten?: GerichtKurz[];
  /** Entscheidungen dieser Session in zeitlicher Reihenfolge */
  feedback: FeedbackEintrag[];
  modus: Modus;
  anzahl: number;
  /** Standard: gerichte */
  aufgabe?: Aufgabe;
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
  /** „Gerade etwas anderes“: kurzfristig meiden, ohne daraus etwas zu lernen */
  kurzfristig_meiden: GerichtKurz[];
  /** Abwechslung: Werte, die zuletzt zu oft kamen (≥ 3 der letzten 4) */
  vielfalt_sperre: { gerichtstyp: string[]; sattmacher: string[] };
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
  /** ehrlicher Hinweis, z. B. „Gerade muss nichts dringend weg.“ */
  hinweis?: string | null;
};

// ───────── Komponenten entdecken ─────────

export type KomponentenZutat = {
  name: string;
  block_typ_id: number | null;
  /** Menge in `einheit`; null = unbekannt */
  menge: number | null;
  einheit: Einheit | null;
  /** bestand = aus dem Vorrat, grund = immer da, kuehlschrank = Rest, einkauf = fehlt noch */
  quelle: 'bestand' | 'grundausstattung' | 'kuehlschrank' | 'einkauf';
  /** anteiliger Wert (Herstellungskosten), von der Software berechnet; null = unbekannt */
  kosten_cent: number | null;
  /** geöffnet, bald ablaufend, Rest – wird damit verwertet */
  dringend: boolean;
};

export type Nutzbarkeit = {
  /** 1–5, von der Software berechnet (nicht von der KI) */
  sterne: number;
  punkte: number;
  gruende: string[];
};

export type KomponentenVorschlag = {
  art: 'komponente';
  id: string;
  name: string;
  beschreibung: string;
  rolle: Farbe;
  richtung: Gewuerzrichtung | null;
  gerichtstypen: Gerichtstyp[];
  /** konkrete Gerichtsideen der KI (Freitext, geprüft) */
  verwendung: string[];
  zutaten: KomponentenZutat[];
  portionen: number;
  portion_g: number | null;
  lagerort: Lagerort;
  /** Standardwert je Lagerort, im Formular änderbar */
  haltbar_tage: number;
  zeit_min: number;
  schritte: string[];
  nutzbarkeit: Nutzbarkeit;
  /** Herstellungskosten gesamt; pro_portion_cent = je Portion der Komponente */
  kosten: Kosten;
  /** Einkauf fehlender Zutaten (Packungspreise, nur bekannte) */
  einkauf: Kosten;
  verwertet: string[];
  partner: string[];
  /** A = verwertet vorhandene Lebensmittel, B = neu (mit Einkauf) */
  typ: 'verwerten' | 'neu';
  vorteil: string;
};

export type KomponentenErgebnis = {
  anbieter: string;
  komponenten: KomponentenVorschlag[];
  verworfen: { name: string; grund: string }[];
  hinweis: string | null;
};

/** Schnittstelle für KI-Anbieter (Groq, Gemini, OpenRouter, Ollama, regelbasiert …). */
export interface KiAnbieter {
  readonly name: string;
  vorschlagen(auftrag: KiAuftrag): Promise<RohAntwort>;
}
