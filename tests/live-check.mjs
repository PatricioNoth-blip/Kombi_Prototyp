// Live-Check gegen die echte Supabase-Datenbank aus der .env – ändert KEINE Daten.
// Buchungen werden nur mit Werten aufgerufen, die garantiert abgelehnt werden
// (Anzahl 0, Überentnahme, ID −1). Die KI wird über den Health-Check der Edge Function und einen
// kleinen Probelauf mit einem festen Beispiel-Haushalt geprüft (keine echten Daten, nichts gespeichert).
// Externe Dienste (KI-Anbieter, Wikimedia) melden Probleme als ⚠ – das ist kein Fehler im Code.
//
// Läuft im GitHub-Workflow „Live-Check“. Lokal:
//   npm run build && npx vite preview &      (App unter http://localhost:4173)
//   APP_URL=http://localhost:4173/ node tests/live-check.mjs
// Ohne APP_URL wird nur die Datenbank geprüft; der App-Teil braucht Playwright.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function ladeEnv() {
  const werte = {};
  for (const zeile of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(zeile);
    if (m) werte[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return werte;
}

/** Beschreibt den Schlüssel, ohne ihn (oder Teile davon) auszugeben. */
function schluesselDiagnose(url, key) {
  const hinweise = [];
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(url ?? '')?.[1];
  if (!ref) hinweise.push('URL hat nicht die Form https://<projekt>.supabase.co');
  if (!key) return { typ: 'fehlt', hinweise: [...hinweise, 'VITE_SUPABASE_KEY ist leer'] };
  if (/\s/.test(key)) hinweise.push('Schlüssel enthält Leerzeichen oder Zeilenumbruch');
  let typ;
  if (key.startsWith('sb_publishable_')) {
    typ = 'Publishable key';
  } else if (key.startsWith('sb_secret_')) {
    typ = 'Secret key';
    hinweise.push('Secret key gehört nicht in die App – Publishable key verwenden und den Secret key in Supabase neu erzeugen');
  } else if (key.split('.').length === 3) {
    try {
      const inhalt = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
      typ = `JWT-Schlüssel (alt), role=${inhalt.role}`;
      if (inhalt.role !== 'anon') hinweise.push(`role=${inhalt.role} – für die App den anon-Key verwenden`);
      if (ref && inhalt.ref && inhalt.ref !== ref) hinweise.push('Schlüssel gehört zu einem anderen Projekt als die URL');
    } catch {
      typ = 'JWT, nicht lesbar';
      hinweise.push('Schlüssel ist beschädigt – unvollständig kopiert?');
    }
  } else {
    typ = 'unbekanntes Format';
    hinweise.push('weder Publishable key (sb_publishable_…) noch anon-Key (eyJ…) – falscher Wert kopiert?');
  }
  return { typ: `${typ}, ${key.length} Zeichen`, hinweise };
}

const env = ladeEnv();
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY, {
  auth: { persistSession: false },
});

const HINWEISE = {
  '42501': 'keine Berechtigung – Migration „ohne_login“ ausgeführt?',
  PGRST205: 'Tabelle/View unbekannt – Migration „inventar“ ausgeführt?',
  PGRST202: 'Funktion unbekannt – Migration „inventar“ ausgeführt?',
};
const fehlerText = (f) =>
  `${f.code ? `${f.code}: ` : ''}${f.message}${HINWEISE[f.code] ? ` (${HINWEISE[f.code]})` : ''}`;

let fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try {
    const info = await fn();
    console.log(`✓ ${name}${info ? ` – ${info}` : ''}`);
  } catch (e) {
    fehlgeschlagen++;
    console.log(`✗ ${name} – ${e.message}`);
  }
}

/** Erwartet einen Fehler mit diesem Code (und optional diesem Text). */
function erwarteFehler({ error }, code, text) {
  if (!error) throw new Error('kein Fehler, obwohl einer erwartet war');
  if (error.code !== code || (text && !error.message.includes(text))) throw new Error(fehlerText(error));
  return `korrekt abgelehnt: „${error.message}“`;
}

async function ladeBestand() {
  const { data, error } = await db.from('bestand').select('*').order('id');
  if (error) throw new Error(fehlerText(error));
  return data;
}

// Zählt Bestand und neueste Bewegung – ändert sich beides nicht, hat niemand gebucht.
async function bestandsStand() {
  const [bestand, letzte] = await Promise.all([
    ladeBestand(),
    db.from('bewegung').select('id').order('id', { ascending: false }).limit(1),
  ]);
  return { mengen: new Map(bestand.map((s) => [s.id, { name: s.name, anzahl: s.anzahl }])), bewegung: letzte.data?.[0]?.id ?? 0 };
}

// Was hat sich zwischen zwei Ständen geändert? Nennt Sorten und neue Bewegungen (Art, Menge, Zeit).
async function bestandsAenderung(vorher, nachher) {
  const sorten = [...nachher.mengen].filter(([id, s]) => vorher.mengen.get(id)?.anzahl !== s.anzahl)
    .map(([id, s]) => `${s.name} ${vorher.mengen.get(id)?.anzahl ?? '–'} → ${s.anzahl}`);
  if (!sorten.length && nachher.bewegung === vorher.bewegung) return null;
  const { data } = await db.from('bewegung').select('id, menge, art, erstellt_am').gt('id', vorher.bewegung).order('id');
  const neu = (data ?? []).map((b) => `${b.art} ${b.menge > 0 ? '+' : ''}${b.menge} um ${b.erstellt_am.slice(11, 19)}`);
  return `${sorten.join(', ') || 'keine Mengenänderung'}; neue Bewegungen: ${neu.join(', ') || 'keine'}`;
}

// ───────── Verbindung ─────────
console.log('Verbindung');
const diagnose = schluesselDiagnose(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY);
await pruefe('Supabase-Werte in .env', async () => {
  if (diagnose.hinweise.length) throw new Error(`${diagnose.typ}; ${diagnose.hinweise.join('; ')}`);
  return diagnose.typ;
});

let bestand = [];
let verbunden = false;
await pruefe('Bestand lesen', async () => {
  try {
    bestand = await ladeBestand();
  } catch (e) {
    if (/Invalid API key/i.test(e.message)) {
      throw new Error(`Supabase lehnt den Schlüssel ab (${diagnose.typ}). ` +
        'Publishable key aus Project Settings → API Keys desselben Projekts wie die URL in .env eintragen.');
    }
    throw e;
  }
  verbunden = true;
  if (bestand.length === 0) throw new Error('keine Sorten – seed.sql ausgeführt?');
  const namen = (liste) => liste.map((s) => s.name).join(', ') || '–';
  return `${bestand.length} Sorten, ${bestand.reduce((s, x) => s + x.anzahl, 0)} Blöcke; ` +
    `Nachkochen: ${namen(bestand.filter((s) => s.nachkochen))}; ` +
    `Bald ablaufen: ${namen(bestand.filter((s) => s.bald_ablaufen))}`;
});

if (!verbunden) {
  console.log('\nWeitere Prüfungen übersprungen: keine Verbindung zur Datenbank.');
  console.log(`\n${fehlgeschlagen} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}

console.log('\nDatenbank');
for (const tabelle of ['charge', 'bewegung']) {
  await pruefe(`${tabelle} lesen`, async () => {
    const { count, error } = await db.from(tabelle).select('id', { count: 'exact', head: true });
    if (error) throw new Error(fehlerText(error));
    return `${count} Zeilen`;
  });
}

const sorte = bestand.find((s) => s.anzahl > 0) ?? bestand[0];
const sorteId = sorte?.id ?? -1;

await pruefe('einfrieren() erreichbar', async () =>
  erwarteFehler(await db.rpc('einfrieren', { p_block_typ_id: sorteId, p_anzahl: 0 }), 'P0001', 'mindestens 1'));
await pruefe('entnehmen() erreichbar', async () =>
  erwarteFehler(await db.rpc('entnehmen', { p_block_typ_id: sorteId, p_anzahl: 0 }), 'P0001', 'mindestens 1'));
await pruefe('rueckgaengig() erreichbar', async () =>
  erwarteFehler(await db.rpc('rueckgaengig', { p_bewegung_ids: [] }), 'P0001', 'Nichts zum'));

if (sorte) {
  await pruefe(`Überentnahme ${sorte.name} wird abgelehnt, Bestand bleibt`, async () => {
    const info = erwarteFehler(
      await db.rpc('entnehmen', { p_block_typ_id: sorte.id, p_anzahl: sorte.anzahl + 1000 }),
      'P0001', 'Es wurde nichts entnommen');
    const nachher = (await ladeBestand()).find((s) => s.id === sorte.id);
    if (nachher.anzahl !== sorte.anzahl) throw new Error(`Bestand ${sorte.anzahl} → ${nachher.anzahl}`);
    return info;
  });
}

await pruefe('Chargen nicht direkt änderbar', async () =>
  erwarteFehler(await db.from('charge').update({ menge_aktuell: 1 }).eq('id', -1), '42501'));
await pruefe('Bewegungen nicht direkt beschreibbar', async () =>
  erwarteFehler(await db.from('bewegung').insert({ charge_id: -1, menge: 1, art: 'korrektur', datum: '2026-01-01' }), '42501'));
await pruefe('Sorten nicht löschbar', async () =>
  erwarteFehler(await db.from('block_typ').delete().eq('id', -1), '42501'));
await pruefe('Sorten anlegen erlaubt', async () =>
  // Ungültige Farbe: Die Rechte greifen vor der Prüfung, gespeichert wird nichts.
  erwarteFehler(await db.from('block_typ').insert({ name: '__live_check__', farbe: 'lila' }), '23514'));
await pruefe('Sorten bearbeiten erlaubt', async () => {
  const { error } = await db.from('block_typ').update({ mindestbestand: 0 }).eq('id', -1);
  if (error) throw new Error(fehlerText(error));
});

// Migration „baukasten“ ist optional: Ohne sie läuft die App im Kompatibilitätsmodus.
const baukasten = bestand.length > 0 && 'art' in bestand[0];
if (baukasten) {
  await pruefe('Baukasten: Art, Einheit, Ablauf und „geöffnet“ vorhanden', async () => {
    const arten = [...new Set(bestand.map((s) => s.art))].join(', ');
    return `Arten: ${arten}; geöffnet: ${bestand.filter((s) => s.geoeffnet > 0).length}, abgelaufen: ${bestand.filter((s) => s.abgelaufen > 0).length}`;
  });
  await pruefe('setze_geoeffnet() erreichbar', async () =>
    erwarteFehler(await db.rpc('setze_geoeffnet', { p_charge_id: -1, p_geoeffnet: true }), 'P0001', 'gibt es nicht'));
  await pruefe('setze_ablauf() erreichbar', async () =>
    erwarteFehler(await db.rpc('setze_ablauf', { p_charge_id: -1, p_ablauf_am: null }), 'P0001', 'gibt es nicht'));
} else {
  console.log('ℹ Migration „baukasten“ noch nicht eingespielt – die App läuft wie bisher, neue Felder sind ausgeblendet.');
}

// Migration „planung_einkauf“ ist ebenfalls optional: Ohne sie fehlen Einkaufsliste, Wochenplan, Auftauen, Herstellen.
// Normale Abfrage statt HEAD: Bei HEAD liefert PostgREST für eine fehlende Tabelle keinen auswertbaren Fehler.
const planung = !(await db.from('plan').select('id').limit(1)).error;
if (planung) {
  for (const tabelle of ['plan', 'einkauf_eintrag', 'einkauf_status', 'einkauf_buchung', 'auftauen', 'nutzung']) {
    await pruefe(`${tabelle} lesen`, async () => {
      const { data, error } = await db.from(tabelle).select('*').limit(1000);
      if (error) throw new Error(fehlerText(error));
      return `${data.length} Zeilen`;
    });
  }
  await pruefe('Bestand kennt Startmenge und Auftau-Status', async () => {
    if (!('start_menge' in bestand[0]) || !('aufgetaut' in bestand[0])) throw new Error('Spalten fehlen in der View „bestand“');
  });
  await pruefe('kochen() erreichbar', async () =>
    erwarteFehler(await db.rpc('kochen', { p_posten: [], p_plan_id: null }), 'P0001', 'Nichts zu entnehmen'));
  await pruefe('herstellen() erreichbar', async () =>
    erwarteFehler(await db.rpc('herstellen', { p_posten: [], p_block_typ_id: sorteId, p_menge: 0, p_ablauf_am: null, p_plan_id: null }), 'P0001', 'mindestens 1'));
  await pruefe('kochen_rueckgaengig() erreichbar', async () =>
    erwarteFehler(await db.rpc('kochen_rueckgaengig', { p_bewegung_ids: [], p_plan_id: null }), 'P0001', 'Nichts zum'));
  await pruefe('einkauf_buchen() bucht nur Abgehaktes', async () =>
    erwarteFehler(await db.rpc('einkauf_buchen', {
      p_schluessel: '__live_check__', p_einheit: 'g', p_block_typ_id: sorteId, p_menge: 1, p_ablauf_am: null, p_preis_cent: null,
    }), 'P0001', 'nicht als gekauft markiert'));
  await pruefe('einkauf_rueckgaengig() erreichbar', async () =>
    erwarteFehler(await db.rpc('einkauf_rueckgaengig', { p_buchung_id: -1 }), 'P0001', 'nicht gefunden'));
  await pruefe('Einkaufsverlauf nicht direkt beschreibbar', async () =>
    erwarteFehler(await db.from('einkauf_buchung').insert({ schluessel: 'x', einheit: 'g', block_typ_id: -1, menge: 1, bewegung_ids: [] }), '42501'));
  await pruefe('Einkaufseinträge nicht löschbar (nur als gelöscht markierbar)', async () =>
    erwarteFehler(await db.from('einkauf_eintrag').delete().eq('id', -1), '42501'));
} else {
  console.log('ℹ Migration „planung_einkauf“ noch nicht eingespielt – Einkaufsliste, Wochenplan, Auftauen und Herstellen sind ausgeblendet.');
}

// Migration „kosten_naehrwerte“ (optional): Kosten je Charge, Protokoll von Mahlzeiten/Produktion, Nährwerte.
const protokoll = planung && !(await db.from('mahlzeit').select('id').limit(1)).error;
if (protokoll) {
  for (const tabelle of ['mahlzeit', 'herstellung']) {
    await pruefe(`${tabelle} lesen`, async () => {
      const { data, error } = await db.from(tabelle).select('*').limit(1000);
      if (error) throw new Error(fehlerText(error));
      return `${data.length} Zeilen`;
    });
  }
  await pruefe('Bestand kennt Nährwerte (leer = unbekannt)', async () => {
    if (!('kcal' in bestand[0]) || !('naehrwert_menge' in bestand[0])) throw new Error('Spalten fehlen in der View „bestand“');
    return `${bestand.filter((s) => s.kcal !== null).length} von ${bestand.length} Sorten mit kcal`;
  });
  await pruefe('essen() erreichbar', async () =>
    erwarteFehler(await db.rpc('essen', { p_posten: [], p_plan_id: null, p_titel: '', p_portionen: 1 }), 'P0001', 'Name des Gerichts fehlt'));
  await pruefe('essen_rueckgaengig() erreichbar', async () =>
    erwarteFehler(await db.rpc('essen_rueckgaengig', { p_mahlzeit_id: -1 }), 'P0001', 'nicht gefunden'));
  await pruefe('produzieren() erreichbar', async () =>
    erwarteFehler(await db.rpc('produzieren', {
      p_posten: [], p_block_typ_id: -1, p_menge: 1, p_ablauf_am: null, p_plan_id: null, p_nicht_erfasst: 0,
    }), 'P0001', 'gibt es nicht'));
  await pruefe('produzieren_rueckgaengig() erreichbar', async () =>
    erwarteFehler(await db.rpc('produzieren_rueckgaengig', { p_herstellung_id: -1 }), 'P0001', 'nicht gefunden'));
  await pruefe('einkaufen() verlangt einen Preis', async () =>
    erwarteFehler(await db.rpc('einkaufen', { p_block_typ_id: sorteId, p_menge: 1, p_ablauf_am: null, p_preis_cent: null }), 'P0001', 'gültigen Preis'));
  await pruefe('Mahlzeiten nicht direkt beschreibbar', async () =>
    erwarteFehler(await db.from('mahlzeit').insert({ titel: '__live_check__', portionen: 1 }), '42501'));
  await pruefe('Kosten einer Charge nicht direkt änderbar', async () =>
    erwarteFehler(await db.from('charge').update({ kosten_cent: 1 }).eq('id', -1), '42501'));
} else if (planung) {
  console.log('ℹ Migration „kosten_naehrwerte“ noch nicht eingespielt – Ausgaben, Kosten je Mahlzeit und Kalorien sind ausgeblendet.');
}

// Migration „ausgaben“ (optional): sonstige Ausgaben – eintragen und als entfernt markieren, nie löschen.
const ausgaben = !(await db.from('ausgabe').select('id').limit(1)).error;
if (ausgaben) {
  await pruefe('ausgabe lesen', async () => {
    const { data, error } = await db.from('ausgabe').select('betrag_cent, entfernt').limit(1000);
    if (error) throw new Error(fehlerText(error));
    return `${data.filter((a) => !a.entfernt).length} Einträge`;
  });
  await pruefe('Ausgabe mit Betrag 0 wird abgelehnt', async () =>
    // Die Prüfung greift vor dem Speichern – es entsteht kein Eintrag.
    erwarteFehler(await db.from('ausgabe').insert({ betrag_cent: 0, notiz: '__live_check__' }), '23514'));
  await pruefe('Ausgaben nicht löschbar', async () =>
    erwarteFehler(await db.from('ausgabe').delete().eq('id', -1), '42501'));
} else if (planung) {
  console.log('ℹ Migration „ausgaben“ noch nicht eingespielt – „Sonstiges“ auf der Startseite ist ausgeblendet.');
}

// ───────── Schema je Migration (nur lesend – Überblick, kein Fehler, wenn etwas fehlt) ─────────
console.log('\nSchema je Migration (nur lesend)');
try {
  const { schemaStand } = await import('./schema-stand.mjs');
  for (const m of await schemaStand(db)) {
    const zeichen = { vollständig: '●', teilweise: '◐', fehlt: '○' }[m.status];
    console.log(`${zeichen} ${m.datei}: ${m.status}` +
      (m.status === 'teilweise' ? ` – vorhanden: ${m.da.join(', ')} · fehlt: ${m.fehlt.join(', ')}` : '') +
      (m.status === 'vollständig' ? ` – ${m.da.length} Objekte` : '') +
      (m.status === 'fehlt' ? ` – keines von ${m.fehlt.length} Objekten (${m.fehlt.slice(0, 4).join(', ')}${m.fehlt.length > 4 ? ' …' : ''})` : ''));
  }
  console.log('ℹ Trigger, Constraints, Fremdschlüssel, RLS und Policies im Detail: scripts/schema-stand.sql im SQL-Editor (nur lesend).');
} catch (e) {
  console.log(`⚠ Schema-Prüfung nicht möglich: ${e.message}`);
}

// ───────── KI: Edge Function, Anbieter, Modell, echter Probelauf ─────────
console.log('\nKI (Edge Function „was-essen“)');
const { ENGINE_VERSION } = await import('../supabase/functions/_shared/kombi/gesundheit.ts');
const FUNKTION = `${env.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/was-essen`;
const kopf = { apikey: env.VITE_SUPABASE_KEY, authorization: `Bearer ${env.VITE_SUPABASE_KEY}` };
let health = null;
await pruefe('Health-Check', async () => {
  const r = await fetch(FUNKTION, { headers: kopf, signal: AbortSignal.timeout(20000) });
  // Welcher Code läuft? Der Health-Check-Stand setzt an jeder Antwort „x-kombi-version“;
  // der ältere Stand lehnt GET mit 405 „Nur POST.“ ab und setzt keinen solchen Header.
  const kennung = r.headers.get('x-kombi-version');
  const koerper = await r.clone().text().catch(() => '');
  console.log(`ℹ Function antwortet auf GET: HTTP ${r.status}, x-kombi-version: ${kennung ?? 'keine'}` +
    (r.ok ? '' : `, Antwort: ${koerper.slice(0, 80)}`) +
    (r.status === 405 && !kennung ? ' → deployt ist der Code-Stand OHNE Health-Check (vor Commit 2f35b48)' : ''));
  if (r.status === 404) return 'ℹ nicht deployt – die App nutzt den Demo-Modus (Vorschläge nach Kombi-Regeln, keine KI)';
  if (r.status === 405) {
    // Ältere Function ohne Health-Check: ein kleiner, echter Aufruf mit dem Probe-Haushalt zeigt trotzdem,
    // ob die KI angebunden ist (503 = kein Key → Demo-Modus). Nichts wird gespeichert.
    const { PROBE_ANFRAGE } = await import('../supabase/functions/_shared/kombi/gesundheit.ts');
    const start = Date.now();
    const antwort = await fetch(FUNKTION, {
      method: 'POST', headers: { ...kopf, 'content-type': 'application/json' }, body: JSON.stringify(PROBE_ANFRAGE), signal: AbortSignal.timeout(90000),
    });
    const ms = Date.now() - start;
    const daten = await antwort.json().catch(() => ({}));
    const alt = 'ℹ ältere Version ohne Health-Check – bitte neu deployen (README „KI einrichten“)';
    if (antwort.status === 503) return `${alt}; KI NICHT eingerichtet (KI_API_KEY fehlt) → App nutzt den Demo-Modus`;
    if (!antwort.ok) return `${alt}; ⚠ KI-Aufruf: HTTP ${antwort.status} ${daten.fehler ?? ''}`;
    return `${alt}; KI live über die alte Version: ${daten.anbieter ?? 'Anbieter unbekannt'} – ${(ms / 1000).toFixed(1)} s, ` +
      `${(daten.gerichte ?? []).length} geprüfte Vorschläge (${(daten.gerichte ?? []).map((g) => g.name).join(', ') || '–'}), ${(daten.verworfen ?? []).length} verworfen`;
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  health = await r.json();
  if (JSON.stringify(health).match(/sk-|gsk_|AIza|Bearer /)) throw new Error('Antwort enthält etwas, das wie ein Key aussieht!');
  const ki = health.ki;
  return `Version ${health.version}${health.version === ENGINE_VERSION ? '' : ` (App: ${ENGINE_VERSION} – neu deployen)`}; ` +
    `KI ${ki.eingerichtet ? 'eingerichtet' : 'NICHT eingerichtet (KI_API_KEY fehlt → Demo-Modus)'}: ${ki.anbieter} · ${ki.modell ?? '–'}; ` +
    `Bilder: Suche ${health.bilder.suche}, Generierung ${health.bilder.generierung.eingerichtet ? `${health.bilder.generierung.anbieter} · ${health.bilder.generierung.modell}` : 'nicht eingerichtet'}`;
});
if (health?.ki?.eingerichtet) {
  const probe = await fetch(`${FUNKTION}?probe=1`, { headers: kopf, signal: AbortSignal.timeout(90000) }).then((r) => r.json()).catch((e) => ({ fehler: e.message }));
  const p = probe.probe;
  if (!p) console.log(`⚠ KI-Probelauf nicht möglich – ${probe.fehler ?? 'keine Antwort'}`);
  else if (p.ok) {
    console.log(`✓ KI live: ${health.ki.anbieter} · ${health.ki.modell} – ${(p.ms / 1000).toFixed(1)} s, JSON gültig, Format gültig, ` +
      `${p.gerichte} von ${p.vorschlaege_roh} Vorschlägen bestanden die Kombi-Prüfung (${p.namen.join(', ')}); ` +
      `Bildanforderungen: ${p.bildanforderungen_ok}/${p.bildanforderungen} passend` +
      (p.verworfen.length ? `; verworfen: ${p.verworfen.map((v) => `${v.name} (${v.grund})`).join('; ')}` : ''));
  } else if (p.antwort === false) {
    console.log(`⚠ KI-Probelauf: keine Antwort vom Anbieter – ${p.fehler} (${(p.ms / 1000).toFixed(1)} s)`);
  } else {
    console.log(`⚠ KI-Probelauf: ${p.fehler ?? 'kein Vorschlag bestand die Prüfung'} – JSON ${p.json_gueltig ? 'gültig' : 'ungültig'}, Format ${p.schema_gueltig ? 'gültig' : 'ungültig'}, ${(p.ms / 1000).toFixed(1)} s`);
  }
}
if (health && health.version === ENGINE_VERSION) {
  const { bildAnfrageFuerKomponente } = await import('../supabase/functions/_shared/kombi/bilder.ts');
  const r = await fetch(FUNKTION, {
    method: 'POST', headers: { ...kopf, 'content-type': 'application/json' }, signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ aufgabe: 'bild', bild: bildAnfrageFuerKomponente({ name: 'Falafel', zutaten: [] }) }),
  }).then((x) => x.json()).catch((e) => ({ fehler: e.message }));
  if (r.bild) console.log(`✓ Bildpipeline der Function: ${r.bild.image_source} – ${r.bild.image_url} (${r.bild.lizenz ?? 'ohne Lizenzangabe'})`);
  else console.log(`⚠ Bildpipeline der Function: kein Bild (${r.hinweis ?? r.fehler ?? (r.weg ?? []).join(', ')}) – die App zeigt dann lokale Bilder`);
}

// ───────── Bildsuche direkt (dieselbe Prüfung wie in der Function) ─────────
console.log('\nBildsuche (Wikimedia Commons)');
{
  const { bildAnfrageFuerKomponente, bildAnfrageFuerZutat, commonsSuchUrl, werteCommonsAus } = await import('../supabase/functions/_shared/kombi/bilder.ts');
  for (const a of [bildAnfrageFuerKomponente({ name: 'Falafel', zutaten: [] }), bildAnfrageFuerZutat('Strauchtomaten')]) {
    try {
      const r = await fetch(commonsSuchUrl(a.suchbegriff), { headers: { 'user-agent': 'Kombi-Live-Check/1.0 (GitHub Actions)' }, signal: AbortSignal.timeout(20000) });
      const funde = werteCommonsAus(await r.json(), a);
      if (!funde.length) {
        console.log(`⚠ „${a.suchbegriff}“: kein Foto hat die Prüfung bestanden – lokales Bild`);
        continue;
      }
      const kopfAntwort = await fetch(funde[0].url, { method: 'HEAD', headers: { 'user-agent': 'Kombi-Live-Check/1.0' }, signal: AbortSignal.timeout(20000) });
      const ok = kopfAntwort.ok && /^image\//.test(kopfAntwort.headers.get('content-type') ?? '');
      console.log(`${ok ? '✓' : '⚠'} „${a.suchbegriff}“: ${funde.length} passende Fotos, bestes „${funde[0].titel}“ (${funde[0].lizenz}) ${ok ? 'erreichbar' : `nicht erreichbar (${kopfAntwort.status})`}`);
    } catch (e) {
      console.log(`⚠ „${a.suchbegriff}“: Wikimedia nicht erreichbar (${e.message})`);
    }
  }
}

// ───────── App im Browser ─────────
const APP_URL = process.env.APP_URL;
if (!APP_URL) {
  console.log('\n(App-Teil übersprungen: APP_URL nicht gesetzt)');
} else {
  console.log('\nApp');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
  const jsFehler = [];
  page.on('pageerror', (e) => jsFehler.push(e.message));
  page.on('console', (m) => {
    // Abgelehnte Buchungen (HTTP 400) sind hier gewollt und keine JS-Fehler.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) jsFehler.push(m.text());
  });

  await pruefe('App startet mit der Startseite und fünf Bereichen', async () => {
    await page.goto(APP_URL);
    await page.waitForSelector('.tabbar, .karte', { timeout: 20000 });
    if (await page.isVisible('.karte')) throw new Error('„Supabase ist noch nicht eingerichtet“ – .env fehlt beim Build');
    await page.waitForSelector('main .start, main .leer-zustand, .fehlerbox', { timeout: 20000 });
    if (await page.isVisible('.fehlerbox')) throw new Error(await page.textContent('.fehlerbox'));
    const tabs = await page.locator('.tabbar button > span:last-child').allTextContents();
    if (tabs.map((t) => t.trim()).join(',') !== 'Start,Essen,Vorrat,Produktion,Einkauf') throw new Error(`Bereiche: ${tabs.join(', ')}`);
    const titel = await page.textContent('.kopf h1');
    const abschnitte = await page.locator('main > div:not([hidden]) .start > :is(.heute-karte, .start-hinweis, .start-block, .monat-karte, .kachel-paar)')
      .evaluateAll((els) => els.map((e) => (e.querySelector('.ueber, h2, strong') ?? e).textContent.trim()));
    if (await page.isVisible('main > div:not([hidden]) .kacheln')) throw new Error('„Heute wichtig“-Kacheln stehen noch auf dem Start');
    const hinweis = await page.locator('main > .hinweisbox').allTextContents();
    return `„${titel}“; Abschnitte: ${abschnitte.join(', ') || '–'}` + (hinweis.length ? `; Hinweis: ${hinweis.join(' ')}` : '');
  });
  await page.screenshot({ path: 'live-check-uebersicht.png', fullPage: true });

  await pruefe('Startseite kompakt', async () => {
    const hoehen = await page.evaluate(() => [...document.querySelectorAll('main > div:not([hidden]) .start > *')]
      .map((e) => `${e.className.split(' ')[0] || e.tagName.toLowerCase()} ${Math.round(e.getBoundingClientRect().height)} px`));
    const ende = await page.evaluate(() => Math.round(document.querySelector('main > div:not([hidden]) .start')?.getBoundingClientRect().bottom ?? 0));
    if (ende > 844 * 1.6) throw new Error(`Startseite ${ende} px hoch – nicht kompakt`);
    return `${hoehen.join(' · ')}; Ende bei ${ende} px (Bildschirm 844 px)`;
  });


  /**
   * Lesbarkeit: Kontrast jedes sichtbaren Texts gegen seinen (deckenden) Hintergrund nach WCAG
   * (4,5:1, große/fette Schrift 3:1) und Texte, die per „…“ abgeschnitten werden.
   */
  const lesbarkeit = () => page.evaluate(() => {
    // „rgb(…)“, „rgba(…)“ oder „color(srgb r g b / a)“ (color-mix) → [r, g, b, a] mit r, g, b in 0–255
    const zahlen = (t) => {
      const z = (t.match(/[\d.]+/g) ?? []).map(Number);
      if (/^color\(srgb/.test(t)) return [z[0] * 255, z[1] * 255, z[2] * 255, z[3] ?? 1];
      if (/^(oklab|oklch|lab|lch)/.test(t)) return [0, 0, 0, 0]; // nicht auswertbar → wie transparent
      return z;
    };
    const lum = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
    // Hintergrund: erste deckende Farbe; bei Verläufen (Knöpfe) alle Verlaufsfarben – gewertet wird die schwächste
    const gruende = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const st = getComputedStyle(e);
        if (st.backgroundImage.includes('gradient')) {
          const farben = [...st.backgroundImage.matchAll(/rgba?\([^)]*\)/g)].map((m) => zahlen(m[0])).filter((f) => (f[3] ?? 1) > 0.9);
          if (farben.length) return farben;
        }
        const [r, g, b, a = 1] = zahlen(st.backgroundColor);
        if (a > 0.9) return [[r, g, b]];
      }
      return [zahlen(getComputedStyle(document.body).backgroundColor)];
    };
    const schwach = new Set();
    const abgeschnitten = new Set();
    for (const el of document.querySelectorAll('main > div:not([hidden]) *, .kopf *, .tabbar *')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || el.getBoundingClientRect().width === 0 || el.closest('[aria-hidden="true"]')) continue;
      const l1 = lum(zahlen(st.color));
      const k = Math.min(...gruende(el).map((f) => { const l2 = lum(f); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }));
      const gross = parseFloat(st.fontSize) >= 18.66 || (parseFloat(st.fontSize) >= 14 && Number(st.fontWeight) >= 700);
      if (k < (gross ? 3 : 4.5) && !el.closest('button:disabled')) schwach.add(`„${el.textContent.trim().slice(0, 24)}“ ${k.toFixed(1)}:1`);
      if (st.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) abgeschnitten.add(`„${el.textContent.trim().slice(0, 40)}“`);
    }
    return { schwach: [...schwach].slice(0, 10), abgeschnitten: [...abgeschnitten].slice(0, 10) };
  });

  /** Mobile Darstellung: kein horizontales Scrollen, keine abgeschnittenen Reiter, keine kaputten Bilder. */
  const layoutFehler = () => page.evaluate(() => {
    const f = [];
    const d = document.documentElement;
    if (d.scrollWidth > d.clientWidth + 1) f.push(`Seite ${d.scrollWidth}px breit bei ${d.clientWidth}px`);
    for (const el of document.querySelectorAll('main > div:not([hidden]) *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > d.clientWidth + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.karussell, .kacheln, .chips, .empfohlen')) {
        f.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ragt ${Math.round(r.right - d.clientWidth)}px hinaus`);
        break;
      }
    }
    for (const b of document.querySelectorAll('.tabbar button > span:last-child')) {
      if (b.scrollWidth > b.clientWidth + 1) f.push(`Reiter „${b.textContent}“ abgeschnitten`);
    }
    for (const img of document.querySelectorAll('main > div:not([hidden]) img')) {
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) f.push(`kaputtes Bild ${img.getAttribute('src').slice(0, 60)}`);
    }
    return f;
  });
  await pruefe('Mobile Darstellung (390 px): kein Überlauf, Reiter vollständig, keine kaputten Bilder', async () => {
    const fehler = [];
    for (const b of ['Start', 'Essen', 'Vorrat', 'Produktion', 'Einkauf']) {
      await page.click(`.tabbar button:has-text("${b}")`);
      await page.waitForTimeout(400);
      for (const x of await layoutFehler()) fehler.push(`${b}: ${x}`);
    }
    // kleinstes aktuelles iPhone-Format (SE / mini): 375 px
    await page.setViewportSize({ width: 375, height: 667 });
    for (const b of ['Start', 'Vorrat', 'Essen']) {
      await page.click(`.tabbar button:has-text("${b}")`);
      await page.waitForTimeout(300);
      for (const x of await layoutFehler()) fehler.push(`${b} (375 px): ${x}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('.tabbar button:has-text("Start")');
    if (fehler.length) throw new Error(fehler.join(' | '));
    return 'Start, Essen, Vorrat, Produktion, Einkauf bei 390 px; Start, Vorrat, Essen bei 375 px';
  });
  await pruefe('Lesbarkeit hell: Kontrast (WCAG) und abgeschnittene Texte', async () => {
    const teile = [];
    for (const b of ['Start', 'Vorrat', 'Essen']) {
      await page.click(`.tabbar button:has-text("${b}")`);
      await page.waitForTimeout(300);
      const l = await lesbarkeit();
      if (l.schwach.length) teile.push(`${b}: Kontrast zu schwach ${l.schwach.join(', ')}`);
      if (l.abgeschnitten.length) teile.push(`${b}: abgeschnitten ${l.abgeschnitten.join(', ')}`);
    }
    await page.click('.tabbar button:has-text("Start")');
    if (teile.length) throw new Error(teile.join(' | '));
    return 'Start, Vorrat, Essen: alle Texte ≥ WCAG AA, nichts abgeschnitten';
  });
  await pruefe('Lesbarkeit dunkel: Kontrast (WCAG) und abgeschnittene Texte', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const teile = [];
    for (const b of ['Start', 'Vorrat', 'Essen']) {
      await page.click(`.tabbar button:has-text("${b}")`);
      await page.waitForTimeout(300);
      const l = await lesbarkeit();
      if (l.schwach.length) teile.push(`${b}: Kontrast zu schwach ${l.schwach.join(', ')}`);
      if (l.abgeschnitten.length) teile.push(`${b}: abgeschnitten ${l.abgeschnitten.join(', ')}`);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.click('.tabbar button:has-text("Start")');
    if (teile.length) throw new Error(teile.join(' | '));
    return 'Start, Vorrat, Essen: alle Texte ≥ WCAG AA, nichts abgeschnitten';
  });
  await pruefe('Dunkelmodus: Start ohne Überlauf, Hintergrund dunkel', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    const grund = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.screenshot({ path: 'live-check-dunkel.png', fullPage: true });
    const fehler = await layoutFehler();
    await page.emulateMedia({ colorScheme: 'light' });
    const [r, g, b] = (grund.match(/\d+/g) ?? []).map(Number);
    if (r + g + b > 150) throw new Error(`Hintergrund zu hell: ${grund}`);
    if (fehler.length) throw new Error(fehler.join(' | '));
    return `Hintergrund ${grund}`;
  });

  await pruefe('Vorrat: Lagerorte und alle Sorten', async () => {
    await page.click('.tabbar button:has-text("Vorrat")');
    await page.waitForTimeout(300);
    const orte = await page.locator('.ort-karte').allInnerTexts();
    await page.click('.alle-knopf');
    await page.waitForSelector('.ort-ansicht .vorrat-zeile');
    const zeilen = await page.locator('.ort-ansicht .vorrat-zeile').count();
    if (zeilen !== bestand.length) throw new Error(`${zeilen} Zeilen statt ${bestand.length}`);
    return `${orte.map((o) => o.replace(/\s+/g, ' ')).join(' | ')}; ${zeilen} Sorten`;
  });

  if (sorte && sorte.anzahl > 0) {
    await pruefe(`Detail ${sorte.name}: Anzeigen ändert nichts, Chargen unter „Details“`, async () => {
      const exakt = new RegExp(`^${sorte.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
      await page.locator('.ort-ansicht .vorrat-zeile').filter({ has: page.locator('.zeile-titel', { hasText: exakt }) }).locator('.zeile-knopf').click();
      await page.waitForSelector('.blatt');
      if (!page.url().includes(`sorte=${sorte.id}`)) throw new Error(`Adresse ohne Sorte: ${page.url()}`);
      await page.click('.blatt details.mehr-infos summary');
      await page.waitForSelector('.chargen li', { timeout: 10000 });
      const nachher = (await ladeBestand()).find((s) => s.id === sorte.id);
      if (nachher.anzahl !== sorte.anzahl) throw new Error(`Bestand ${sorte.anzahl} → ${nachher.anzahl}`);
      return `${await page.locator('.chargen li').count()} Charge(n)`;
    });
    await pruefe('Überentnahme in der App: verständliche Meldung, nichts ändert sich', async () => {
      await page.fill('input[aria-label="Andere Anzahl"]', String(sorte.anzahl + 1000));
      await page.click('.eigene-anzahl button');
      await page.waitForSelector('.meldung.fehler', { timeout: 10000 });
      const text = await page.textContent('.meldung.fehler span');
      const nachher = (await ladeBestand()).find((s) => s.id === sorte.id);
      if (nachher.anzahl !== sorte.anzahl) throw new Error(`Bestand ${sorte.anzahl} → ${nachher.anzahl}`);
      return `„${text}“`;
    });
  }

  await pruefe('Adresse und Zurück: #/vorrat/gefrierfach', async () => {
    await page.goto(`${APP_URL.replace(/#.*$/, '')}#/vorrat/gefrierfach`);
    await page.waitForSelector('.ort-kopf h2');
    const titel = await page.textContent('.ort-kopf h2');
    if (titel !== 'Gefrierfach') throw new Error(`Titel „${titel}“`);
    await page.click('.zurueck-knopf');
    await page.waitForSelector('.ort-karte');
    return `geöffnet über die Adresse, zurück zu den Lagerorten (${page.url().split('#')[1]})`;
  });

  await pruefe('Einbuchen-Dialog: Sorte → Menge (ohne zu buchen)', async () => {
    await page.click('.kopf .kopf-aktion');
    await page.click('.blatt .zeile:has-text("Einbuchen")');
    const sorten = await page.locator('.sorte-knopf').count();
    await page.locator('.sorte-knopf').first().click();
    const zahlen = await page.locator('.zahl').count();
    await page.keyboard.press('Escape');
    if (zahlen < 7) throw new Error(`nur ${zahlen} Mengenknöpfe`);
    return `${sorten} Sorten zur Auswahl, ${zahlen} Mengenknöpfe`;
  });

  await pruefe('Neue Sorte: leeres Formular wird abgelehnt', async () => {
    await page.click('.kopf .kopf-aktion');
    await page.click('.blatt .zeile:has-text("Neue Sorte")');
    await page.click('.formular button[type=submit]');
    const text = await page.textContent('.fehlertext');
    await page.keyboard.press('Escape');
    if (text !== 'Bitte einen Namen eingeben.') throw new Error(`Meldung: ${text}`);
    return 'nichts gespeichert';
  });

  await pruefe('Zustand bleibt beim Wechsel zwischen den Bereichen', async () => {
    // Vorrat: „Alle Sorten“ offen; Essen: Text im Feld „Reste“ (nur im Browser, nicht in der DB)
    await page.click('.alle-knopf');
    await page.click('.tabbar button:has-text("Essen")');
    await page.fill('.essen textarea', 'Live-Check Rest');
    for (const b of ['Start', 'Produktion', 'Einkauf', 'Vorrat', 'Essen']) await page.click(`.tabbar button:has-text("${b}")`);
    const text = await page.inputValue('.essen textarea');
    await page.fill('.essen textarea', '');
    await page.click('.tabbar button:has-text("Vorrat")');
    const offen = await page.isVisible('.ort-ansicht');
    if (text !== 'Live-Check Rest') throw new Error(`Essen-Feld: „${text}“`);
    if (!offen) throw new Error('Vorrat: „Alle Sorten“ wurde geschlossen');
    await page.click('.zurueck-knopf');
    return 'Essen-Feld und geöffnete Vorratsansicht erhalten';
  });

  await pruefe('Essen: KI-Status und „Testen“ in den Einstellungen', async () => {
    await page.click('.tabbar button:has-text("Essen")');
    const umschalter = page.locator('main > div:not([hidden]) .einstellungen button.link', { hasText: 'Ändern' });
    await umschalter.click();
    const status = page.locator('main > div:not([hidden]) .ki-status');
    await status.waitFor();
    await page.waitForFunction(() => !document.querySelector('.ki-status')?.textContent?.includes('Prüfe die KI-Verbindung'), null, { timeout: 30000 });
    const zeile = (await status.locator('.ki-status-text small').first().innerText()).trim();
    const knopf = status.locator('button', { hasText: 'Testen' });
    const aktuell = health && health.version === ENGINE_VERSION;
    let ergebnis;
    if (!(await knopf.count())) {
      // Ehrlich: ohne Health-Check (alte Function) oder ohne KI-Key gibt es nichts zu testen.
      if (aktuell && health.ki.eingerichtet) throw new Error(`Function aktuell und KI eingerichtet, aber kein „Testen“: „${zeile}“`);
      ergebnis = `ℹ kein „Testen“ – ${zeile}`;
    } else {
      if (!health) throw new Error(`„Testen“ angezeigt, obwohl die Function keinen Health-Check hat: „${zeile}“`);
      await knopf.click();
      const antwort = status.locator('.status-ok, .status-achtung');
      await antwort.waitFor({ timeout: 90000 });
      const text = (await antwort.innerText()).trim();
      if (!text.startsWith('Live getestet')) throw new Error(`Test in der App: ${text}`);
      ergebnis = `${zeile} → ${text}`;
    }
    await page.locator('main > div:not([hidden]) .einstellungen button.link', { hasText: 'Fertig' }).click();
    return ergebnis;
  });

  await pruefe('Start: Kochansicht öffnen bucht nichts', async () => {
    await page.click('.tabbar button:has-text("Start")');
    const knopf = page.locator('main > div:not([hidden]) .rezept-kompakt .rk-kochen').first();
    if (!(await knopf.count())) return 'kein Vorschlag aus dem Vorrat';
    // Schreibende Anfragen der App in diesem Zeitfenster (Bild-Cache ausgenommen – kein Bestand)
    const geschrieben = [];
    const mitschreiben = (r) => {
      const pfad = new URL(r.url()).pathname;
      if (r.method() !== 'GET' && r.method() !== 'HEAD' && pfad.includes('/rest/v1/') && !pfad.endsWith('/rest/v1/bild')) geschrieben.push(`${r.method()} ${pfad.split('/rest/v1/')[1]}`);
    };
    const vorher = await bestandsStand();
    const name = await page.locator('main > div:not([hidden]) .rezept-kompakt h3').first().textContent();
    page.on('request', mitschreiben);
    await knopf.click();
    await page.waitForSelector('.kochen');
    await page.waitForTimeout(300);
    const meta = (await page.innerText('.kochen-kopf .meta-icons')).replace(/\s+/g, ' ');
    await page.click('.kochen [aria-label="Zurück"]');
    await page.waitForTimeout(300);
    page.off('request', mitschreiben);
    if (geschrieben.length) throw new Error(`App hat geschrieben: ${geschrieben.join(', ')}`);
    const aenderung = await bestandsAenderung(vorher, await bestandsStand());
    // Die App hat nichts geschrieben – eine Änderung kam von außen (z. B. jemand nutzt die App gleichzeitig).
    if (aenderung) return `${name}: ${meta} · ℹ Bestand wurde gleichzeitig von außerhalb geändert (${aenderung}) – die App selbst hat nichts geschrieben`;
    return `${name}: ${meta}`;
  });

  await pruefe('Produktion: Empfehlungen (speichert nichts)', async () => {
    const vorher = (await ladeBestand()).length;
    await page.click('.tabbar button:has-text("Produktion")');
    if (!planung) return (await page.textContent('main > div:not([hidden]) .leer-zustand p')) ?? '';
    await page.waitForSelector('.produktion section[aria-label="Empfohlen"]');
    await page.waitForFunction(() => !document.querySelector('.produktion section[aria-label="Empfohlen"]')?.textContent?.includes('rechnet'));
    const ideen = await page.locator('.produktion section[aria-label="Empfohlen"] .empf-text strong').allTextContents();
    if ((await ladeBestand()).length !== vorher) throw new Error('Sorten wurden angelegt!');
    return ideen.join(', ') || 'keine';
  });

  await pruefe('Einkauf', async () => {
    await page.click('.tabbar button:has-text("Einkauf")');
    if (planung) {
      await page.waitForSelector('.einkauf-kopf');
      return (await page.innerText('.einkauf-kopf')).replace(/\s+/g, ' ');
    }
    return (await page.textContent('main > div:not([hidden]) .leer-zustand p')) ?? '';
  });

  await pruefe('Keine JavaScript-Fehler', async () => {
    if (jsFehler.length) throw new Error(jsFehler.join(' | '));
  });
  await browser.close();
}

console.log(fehlgeschlagen ? `\n${fehlgeschlagen} Prüfung(en) fehlgeschlagen.` : '\nAlles in Ordnung.');
process.exit(fehlgeschlagen ? 1 : 0);
