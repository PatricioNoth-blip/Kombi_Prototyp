// Welche Teile welcher Migration gibt es in der echten Datenbank? Nur lesend, mit dem App-Schlüssel.
//
// • Tabellen, Views, Spalten: select … limit 0 – liest keine einzige Zeile.
// • Funktionen: GET-Aufruf mit den erwarteten Parameternamen und ungültigen Werten – siehe funktionDa().
//   (Das OpenAPI-Verzeichnis und die Hinweistexte von PostgREST sind mit dem App-Schlüssel nicht verlässlich.)
// • Migration „ohne_login“ ändert nur Rechte – geprüft über das, was die App-Rolle darf.
// Trigger, Constraints, Fremdschlüssel, RLS-Policies und Rechte im Detail sieht die App-Rolle nicht:
// dafür gibt es scripts/schema-stand.sql für den SQL-Editor (ebenfalls nur lesend).

const BESTAND_4 = ['art', 'herkunft', 'einheit', 'portion_menge', 'kosten_menge', 'zusammensetzung', 'notiz', 'naechster_ablauf', 'geoeffnet', 'geoeffnet_seit', 'abgelaufen'];
const NAEHRWERTE = ['kcal', 'protein_g', 'kohlenhydrate_g', 'fett_g', 'naehrwert_menge'];
const BILD = ['image_url', 'image_source', 'image_status', 'image_query', 'image_alt', 'image_generated', 'image_updated_at'];

/** Je Migration: neue Tabellen/Views mit Spalten, neue Spalten bestehender Tabellen, neue oder geänderte Funktionen (Parameter). */
export const MIGRATIONEN = [
  {
    datei: '20260927120000_inventar.sql',
    spalten: {
      block_typ: ['id', 'name', 'farbe', 'groesse_g', 'mindestbestand', 'haltbar_tage', 'kosten_cent'],
      charge: ['id', 'block_typ_id', 'menge_start', 'menge_aktuell', 'eingefroren_am'],
      bewegung: ['id', 'charge_id', 'menge', 'art', 'datum', 'erstellt_am', 'storno_von'],
      bestand: ['id', 'name', 'farbe', 'mindestbestand', 'haltbar_tage', 'groesse_g', 'kosten_cent', 'anzahl', 'nachkochen', 'aelteste', 'bald_ablaufen'],
    },
    funktionen: { heute: [], einfrieren: ['p_block_typ_id', 'p_anzahl'], entnehmen: ['p_block_typ_id', 'p_anzahl'], rueckgaengig: ['p_bewegung_ids'] },
  },
  { datei: '20260927180000_ohne_login.sql', rechte: true },
  {
    datei: '20260928090000_was_essen.sql',
    spalten: {
      block_typ: ['lagerort'],
      bestand: ['lagerort'],
      koch_session: ['id', 'erstellt_am', 'personen', 'max_minuten', 'guenstig', 'kuehlschrank'],
      vorschlag: ['id', 'session_id', 'erstellt_am', 'art', 'name', 'daten', 'anbieter'],
      vorschlag_feedback: ['id', 'vorschlag_id', 'aktion', 'erstellt_am'],
      rezept: ['id', 'name', 'daten', 'vorschlag_id', 'erstellt_am'],
    },
  },
  {
    datei: '20260929090000_baukasten.sql',
    spalten: {
      block_typ: ['art', 'herkunft', 'einheit', 'portion_menge', 'kosten_menge', 'zusammensetzung', 'notiz'],
      charge: ['ablauf_am', 'geoeffnet_am'],
      rezept: ['gerichtstyp', 'portionen', 'zutaten', 'schritte', 'bestandsarten', 'tags', 'kosten_pro_portion_cent', 'kosten_status', 'feedback'],
      bestand: BESTAND_4,
    },
    funktionen: { menge_text: ['p_menge', 'p_einheit'], einfrieren: ['p_block_typ_id', 'p_anzahl', 'p_ablauf_am'], setze_geoeffnet: ['p_charge_id', 'p_geoeffnet'], setze_ablauf: ['p_charge_id', 'p_ablauf_am'] },
  },
  {
    datei: '20260930090000_planung_einkauf.sql',
    spalten: {
      block_typ: ['gerichtstypen', 'richtung'],
      plan: ['id', 'art', 'titel', 'datum', 'portionen', 'daten', 'status', 'erstellt_am', 'erledigt_am'],
      einkauf_eintrag: ['id', 'name', 'schluessel', 'menge', 'einheit', 'kategorie', 'quelle', 'grund', 'block_typ_id', 'plan_id', 'status', 'erstellt_am', 'erledigt_am'],
      einkauf_status: ['schluessel', 'einheit', 'status', 'geaendert_am'],
      einkauf_buchung: ['id', 'schluessel', 'einheit', 'block_typ_id', 'menge', 'preis_cent', 'bewegung_ids', 'eintrag_ids', 'alter_kosten_cent', 'alter_kosten_menge', 'rueckgaengig', 'erstellt_am'],
      auftauen: ['id', 'block_typ_id', 'menge', 'auftauen_am', 'plan_id', 'status', 'status_vorher', 'bewegung_id', 'erstellt_am', 'geaendert_am'],
      nutzung: [],
      bestand: ['gerichtstypen', 'richtung', 'start_menge', 'aufgetaut', 'auftauen_geplant'],
    },
    funktionen: {
      entnehme_posten: ['p_posten', 'p_plan_id'], kochen: ['p_posten', 'p_plan_id'],
      herstellen: ['p_posten', 'p_block_typ_id', 'p_menge', 'p_ablauf_am', 'p_plan_id'], kochen_rueckgaengig: ['p_bewegung_ids', 'p_plan_id'],
      einkauf_buchen: ['p_schluessel', 'p_einheit', 'p_block_typ_id', 'p_menge', 'p_ablauf_am', 'p_preis_cent'], einkauf_rueckgaengig: ['p_buchung_id'],
    },
  },
  {
    datei: '20261001090000_kosten_naehrwerte.sql',
    spalten: {
      block_typ: NAEHRWERTE,
      charge: ['kosten_cent'],
      einkauf_buchung: ['direkt'],
      mahlzeit: ['id', 'datum', 'titel', 'portionen', 'plan_id', 'bewegung_ids', 'kosten_cent', 'kosten_unbekannt', 'kcal', 'kcal_unbekannt', 'rueckgaengig', 'erstellt_am'],
      herstellung: ['id', 'datum', 'block_typ_id', 'menge', 'plan_id', 'charge_id', 'bewegung_ids', 'kosten_cent', 'kosten_unbekannt', 'charge_kosten_cent', 'alter_kosten_cent', 'alter_kosten_menge', 'preis_gelernt', 'rueckgaengig', 'erstellt_am'],
      bestand: NAEHRWERTE,
    },
    funktionen: {
      wert_der_entnahme: ['p_bewegung_ids'], essen: ['p_posten', 'p_plan_id', 'p_titel', 'p_portionen'], essen_rueckgaengig: ['p_mahlzeit_id'],
      produzieren: ['p_posten', 'p_block_typ_id', 'p_menge', 'p_ablauf_am', 'p_plan_id', 'p_nicht_erfasst'], produzieren_rueckgaengig: ['p_herstellung_id'],
      einkaufen: ['p_block_typ_id', 'p_menge', 'p_ablauf_am', 'p_preis_cent'],
    },
  },
  { datei: '20261002090000_ausgaben.sql', spalten: { ausgabe: ['id', 'datum', 'betrag_cent', 'notiz', 'entfernt', 'erstellt_am'] } },
  {
    datei: '20261003090000_bilder_zutaten.sql',
    spalten: {
      block_typ: [...BILD, 'zutat'],
      bild: ['id', 'schluessel', 'art', ...BILD, 'lizenz', 'urheber', 'quelle_seite', 'erstellt_am'],
      bestand: [...BILD, 'zutat'],
    },
  },
  {
    // liegt nur auf dem Branch claude/hopeful-carson-0yl2z6 (Bon-Import) – geprüft, falls davon etwas live ist
    datei: '20261015090000_bon_produktion.sql (Branch hopeful-carson)',
    fremd: true,
    spalten: { bon_import: ['id'], bon_position: ['id'], produktion: ['id'], produktion_eingang: ['id'], bewegung_kosten: [], bon_gewohnheit: [] },
    funktionen: { bon_buchen: ['p_bon', 'p_trotz_doppelt'], bon_rueckgaengig: ['p_import_id'], preise_zuruecksetzen: ['p_preise'], produktion_rueckgaengig: ['p_produktion_id'] },
  },
];

const FEHLT_TABELLE = new Set(['42P01', 'PGRST205']);
const FEHLT_SPALTE = new Set(['42703', 'PGRST204']);

/** Gibt es die Tabelle/View – und welche der Spalten fehlen? */
async function pruefeRelation(db, name, spalten) {
  const { error } = await db.from(name).select(spalten.length ? spalten.join(',') : '*').limit(0);
  if (!error || error.code === '42501') return { da: true, fehlend: [] }; // 42501: da, aber keine Leserechte
  if (FEHLT_TABELLE.has(error.code)) return { da: false, fehlend: spalten };
  if (!FEHLT_SPALTE.has(error.code)) throw new Error(`${name}: ${error.code} ${error.message}`);
  const fehlend = [];
  for (const s of spalten) {
    const r = await db.from(name).select(s).limit(0);
    if (r.error && FEHLT_SPALTE.has(r.error.code)) fehlend.push(s);
  }
  return { da: true, fehlend };
}

/**
 * Gibt es eine Funktion mit (mindestens) diesen Parameternamen? Aufruf per GET mit absichtlich
 * ungültigen Werten: Gibt es die Funktion, scheitert schon die Umwandlung der Werte (z. B. 22P02),
 * bevor sie läuft – und GET läuft in einer Nur-Lesen-Transaktion, schreiben ginge ohnehin nicht.
 * Gibt es keine passende Funktion, antwortet PostgREST mit PGRST202. Funktionen ohne Parameter
 * (heute()) werden dabei tatsächlich ausgeführt – nur lesende.
 */
async function funktionDa(db, name, params) {
  const { error } = await db.rpc(name, Object.fromEntries(params.map((p) => [p, '§kein-wert§'])), { get: true });
  if (!error) {
    if (params.length) throw new Error(`${name}: wurde mit ungültigen Werten ausgeführt`);
    return true;
  }
  return error.code !== 'PGRST202';
}

/**
 * Prüft alle Migrationen; liefert je Datei den Stand und eine Begründung.
 * Eine Funktion gilt als vorhanden, wenn sie mindestens die erwarteten Parameter hat
 * (spätere Migrationen dürfen sie erweitern, z. B. einfrieren(…, p_ablauf_am)).
 */
export async function schemaStand(db) {
  const ergebnis = [];
  for (const m of MIGRATIONEN) {
    const da = [];
    const fehlt = [];
    if (m.rechte) {
      // Rechte für die App ohne Login: lesen (RLS lässt Zeilen durch) und heute() ausführen
      const zeilen = await db.from('charge').select('id', { count: 'exact', head: true });
      if (zeilen.error) fehlt.push(`charge lesen (${zeilen.error.code})`);
      else if (zeilen.count > 0) da.push(`charge lesbar (${zeilen.count} Zeilen)`);
      else fehlt.push('charge: 0 Zeilen sichtbar (RLS?)');
      const h = await db.rpc('heute', {}, { get: true });
      if (h.error) fehlt.push(`heute() ausführen (${h.error.code})`);
      else da.push('heute() ausführbar');
    }
    for (const [name, spalten] of Object.entries(m.spalten ?? {})) {
      const r = await pruefeRelation(db, name, spalten);
      if (!r.da) fehlt.push(name);
      else if (r.fehlend.length) {
        fehlt.push(`${name}.{${r.fehlend.join(',')}}`);
        if (r.fehlend.length < spalten.length) da.push(`${name} (teilweise)`);
      } else da.push(name);
    }
    for (const [name, params] of Object.entries(m.funktionen ?? {})) {
      if (await funktionDa(db, name, params)) da.push(`${name}()`);
      else fehlt.push(`${name}(${params.join(', ')})`);
    }
    const status = fehlt.length === 0 ? 'vollständig' : da.length === 0 ? 'fehlt' : 'teilweise';
    ergebnis.push({ datei: m.datei, fremd: !!m.fremd, status, da, fehlt });
  }
  return ergebnis;
}
