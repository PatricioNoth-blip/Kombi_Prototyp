// Typen für den Bon-Import. Reines TypeScript: Browser, Edge Function (Deno) und Node-Tests.
import type { Art, Einheit, Farbe, Lagerort } from '../typen.ts';

/**
 * lebensmittel       – kann in den Bestand
 * nicht_lebensmittel – Waschmittel, Kosmetik, Tierbedarf … (nie automatisch Bestand)
 * pfand              – Pfand bzw. Leergut (eigene Geldposition, keine Lebensmittelkosten)
 * rabatt             – Rabatt/Gutschein, der keinem Artikel eindeutig zuzuordnen ist
 * unbekannt          – nicht sicher einzuordnen
 */
export type BonTyp = 'lebensmittel' | 'nicht_lebensmittel' | 'pfand' | 'rabatt' | 'unbekannt';

/** Packungsgröße aus dem Artikeltext („500G“, „1KG“, „1,5L“, „10ST“) – immer in g, ml oder Stück. */
export type Packung = { menge: number; einheit: 'g' | 'ml' | 'stueck' };

/** Eine Artikelzeile des Bons, so wie sie gedruckt ist – noch ohne Zuordnung. */
export type BonPosition = {
  nr: number;
  /** Artikeltext ohne Preis und Mengenangabe */
  text: string;
  typ: BonTyp;
  /** Stück bzw. Packungen laut Bon (Wiegeware: 1) */
  anzahl: number;
  einzelpreis_cent: number | null;
  /** Zeilenbetrag laut Bon; bei Leergut/Rabatt negativ; null = nicht lesbar */
  gesamtpreis_cent: number | null;
  /** Wiegeware: gewogene Menge in g */
  gewicht_g: number | null;
  packung: Packung | null;
  /** eindeutig zugeordneter Rabatt (positiver Betrag) */
  rabatt_cent: number;
  rabatt_texte: string[];
  /** Pfand direkt unter dem Artikel (nur zur Anzeige – wird nie zu Lebensmittelkosten) */
  pfand_cent: number;
  /** Auffälligkeiten, z. B. „2 × 0,79 € ergibt nicht 1,68 €“ */
  warnungen: string[];
  /** Rohzeilen – zur Nachvollziehbarkeit */
  zeilen: string[];
};

export type BonDaten = {
  haendler: string | null;
  filiale: string | null;
  /** Kaufdatum YYYY-MM-DD */
  datum: string | null;
  /** SUMME / zu zahlen laut Bon */
  summe_cent: number | null;
  positionen: BonPosition[];
  /** Summe aller gelesenen Beträge (Artikel − Rabatte + Pfand) */
  berechnete_summe_cent: number;
  summe_geprueft: 'passt' | 'weicht_ab' | 'unbekannt';
  warnungen: string[];
  seiten: number;
};

// ───────── Zuordnung ─────────

/** Das, was der Abgleich von einer Sorte wissen muss (Auszug aus der View „bestand“). */
export type SorteInfo = {
  id: number;
  name: string;
  farbe: Farbe;
  art: Art;
  einheit: Einheit;
  portion_menge: number;
  groesse_g: number;
  lagerort: Lagerort;
  herkunft: 'selbstgemacht' | 'gekauft' | null;
  kosten_cent: number | null;
  kosten_menge: number;
  anzahl: number;
};

/** Eine Zeile der View „bon_gewohnheit“: was der Haushalt früher mit diesem Bon-Artikel gemacht hat. */
export type Gewohnheit = {
  schluessel: string;
  uebernommen: number;
  nicht_uebernommen: number;
  teilweise: number;
  letzte_sorte: number | null;
  letzte_menge_pro_einheit: number | null;
  letzter_grund: Grund | null;
};

export type Kandidat = {
  sorte_id: number;
  name: string;
  /** 0 … 1 */
  sicherheit: number;
  grund: 'gelernt' | 'name' | 'hinweis';
};

/** sicher: ohne Rückfrage · unsicher: Nutzer bestätigt · unbekannt: vermutlich neues Produkt */
export type ZuordnungsStatus = 'sicher' | 'unsicher' | 'unbekannt';

export type Zuordnung = { kandidaten: Kandidat[]; status: ZuordnungsStatus };

// ───────── Entwurf: Entscheidungen des Nutzers ─────────

export type Grund = 'direkt_gegessen' | 'fuer_andere' | 'anderweitig' | 'sonstiges';

export type NeueSorte = {
  name: string;
  art: Art;
  farbe: Farbe;
  lagerort: Lagerort;
  einheit: Einheit;
  portion_menge: number;
  groesse_g: number;
};

export type Ziel =
  | { art: 'sorte'; sorte_id: number }
  | { art: 'neu'; daten: NeueSorte }
  | { art: 'keine' };

export type FrageArt = 'zuordnung' | 'neu' | 'umrechnung' | 'menge' | 'uebernehmen';

export type MengeQuelle = 'packung' | 'gewicht' | 'gelernt' | 'standard' | 'nutzer';

export type PositionEntwurf = {
  nr: number;
  bon: BonPosition;
  /** normalisierter Bon-Text (Wiedererkennen, Lernen) */
  schluessel: string;
  /** kann der Nutzer ändern („doch ein Lebensmittel“) */
  typ: BonTyp;
  zuordnung: Zuordnung;
  /** verständlicher Name als Hinweis (z. B. von der KI); nie eine Entscheidung */
  hinweis_name: string | null;
  ziel: Ziel;
  /** 1 Stück laut Bon = so viele Einheiten der Sorte; null = unbekannt (Rückfrage) */
  menge_pro_einheit: number | null;
  menge_quelle: MengeQuelle | null;
  /** so viele Bon-Stück kommen in den Bestand (0 … anzahl) */
  anzahl_uebernehmen: number;
  grund: Grund | null;
  grund_text: string | null;
  lagerort: Lagerort | null;
  ablauf_am: string | null;
  /** vom Nutzer beantwortete Fragen */
  beantwortet: FrageArt[];
  /** Hinweise für den Nutzer (Gewohnheit, Rabatt, Preis …) */
  hinweise: string[];
};

export type ImportQuelle = 'kassenbon' | 'e_bon' | 'text';

export type ImportEntwurf = {
  quelle: ImportQuelle;
  quelle_ref: string | null;
  /** z. B. „text“, „pdf“ oder „ki:gemini-2.5-flash“ */
  erkennung: string;
  bon: BonDaten;
  positionen: PositionEntwurf[];
  fingerabdruck: string;
};

export type Rueckfrage = {
  nr: number;
  art: FrageArt;
  /** ohne Antwort kann nicht gebucht werden */
  pflicht: boolean;
  frage: string;
  hinweis: string | null;
};
