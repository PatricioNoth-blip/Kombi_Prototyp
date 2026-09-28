// Live-Check gegen die echte Supabase-Datenbank aus der .env – ändert KEINE Daten.
// Buchungen werden nur mit Werten aufgerufen, die garantiert abgelehnt werden
// (Anzahl 0, Überentnahme, ID −1).
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
  const { data, error } = await db.from('bestand').select('*');
  if (error) throw new Error(fehlerText(error));
  return data;
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

  await pruefe('App startet mit dem Vorrat', async () => {
    await page.goto(APP_URL);
    await page.waitForSelector('.ort-kachel, .fehlerbox, .karte', { timeout: 20000 });
    if (await page.isVisible('.karte')) throw new Error('„Supabase ist noch nicht eingerichtet“ – .env fehlt beim Build');
    if (await page.isVisible('.fehlerbox')) throw new Error(await page.textContent('.fehlerbox'));
    const kacheln = await page.locator('.ort-kachel').allInnerTexts();
    const wichtig = await page.locator('.wichtig-karte .wk-name').allTextContents();
    const hinweis = await page.locator('main > .hinweisbox').allTextContents();
    return `Lagerorte: ${kacheln.map((k) => k.replace(/\s+/g, ' ')).join(' | ')}; Heute wichtig: ${wichtig.join(', ') || '–'}` +
      (hinweis.length ? `; Hinweis: ${hinweis.join(' ')}` : '');
  });
  await page.screenshot({ path: 'live-check-uebersicht.png', fullPage: true });

  await pruefe('Alle Sorten als Karten', async () => {
    await page.click('.alle-knopf');
    await page.waitForSelector('.ort-ansicht .vorrat-karte');
    const karten = await page.locator('.ort-ansicht .vorrat-karte').count();
    if (karten !== bestand.length) throw new Error(`${karten} Karten statt ${bestand.length}`);
    return `${karten} Sorten`;
  });

  if (sorte && sorte.anzahl > 0) {
    await pruefe(`Detail ${sorte.name}: Chargen werden geladen`, async () => {
      const exakt = new RegExp(`^${sorte.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
      await page.locator('.ort-ansicht .vorrat-karte').filter({ has: page.locator('.vk-name', { hasText: exakt }) }).locator('.vk-oeffnen').click();
      await page.waitForSelector('.chargen li', { timeout: 10000 });
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

  await pruefe('Einbuchen-Dialog: Sorte → Menge (ohne zu buchen)', async () => {
    await page.click('.aktion-knopf');
    const sorten = await page.locator('.sorte-knopf').count();
    await page.locator('.sorte-knopf').first().click();
    const zahlen = await page.locator('.zahl').count();
    await page.keyboard.press('Escape');
    if (zahlen < 7) throw new Error(`nur ${zahlen} Mengenknöpfe`);
    return `${sorten} Sorten zur Auswahl, ${zahlen} Mengenknöpfe`;
  });

  await pruefe('Neue Sorte: leeres Formular wird abgelehnt', async () => {
    await page.click('.aktion-knopf');
    await page.click('.neue-sorte-knopf');
    await page.click('.formular button[type=submit]');
    const text = await page.textContent('.fehlertext');
    await page.keyboard.press('Escape');
    if (text !== 'Bitte einen Namen eingeben.') throw new Error(`Meldung: ${text}`);
    return 'nichts gespeichert';
  });

  await pruefe('Zustand bleibt beim Wechsel zwischen Essen, Vorrat, Komponenten, Einkauf', async () => {
    // Vorrat: „Alle Sorten“ ist noch offen; Essen: Text im Feld „Was muss weg?“ (nur im Browser, nicht in der DB)
    await page.click('.tabbar button:has-text("Essen")');
    await page.fill('.essen-start textarea', 'Live-Check Rest');
    for (const b of ['Komponenten', 'Einkauf', 'Vorrat', 'Essen']) await page.click(`.tabbar button:has-text("${b}")`);
    const text = await page.inputValue('.essen-start textarea');
    await page.fill('.essen-start textarea', '');
    await page.click('.tabbar button:has-text("Vorrat")');
    const offen = await page.isVisible('.ort-ansicht');
    if (text !== 'Live-Check Rest') throw new Error(`Essen-Feld: „${text}“`);
    if (!offen) throw new Error('Vorrat: „Alle Sorten“ wurde geschlossen');
    await page.click('.zurueck-knopf');
    return 'Essen-Feld und geöffnete Vorratsansicht erhalten';
  });

  await pruefe('Komponenten: Funktionen und eigene Komponenten', async () => {
    await page.click('.tabbar button:has-text("Komponenten")');
    const rollen = await page.locator('.rollen-kachel').allInnerTexts();
    if (rollen.length !== 4) throw new Error(`${rollen.length} Funktionen statt 4`);
    return rollen.map((r) => r.replace(/\s+/g, ' ')).join(' | ');
  });

  await pruefe('Komponenten entdecken (KI oder Demo, speichert nichts)', async () => {
    const vorher = (await ladeBestand()).length;
    await page.click('.entdecken-start .knopf.haupt');
    await page.waitForSelector('.idee-karte, .komponenten p.leise:not(.laden)', { timeout: 60000 });
    const ideen = await page.locator('.idee-karte .idee-name').allTextContents();
    const quelle = await page.locator('.komponenten .abstand-oben.leise').first().textContent().catch(() => '');
    if ((await ladeBestand()).length !== vorher) throw new Error('Sorten wurden angelegt!');
    return `${ideen.join(', ') || 'keine'} – ${quelle}`;
  });

  await pruefe('Einkauf', async () => {
    await page.click('.tabbar button:has-text("Einkauf")');
    if (planung) {
      await page.waitForSelector('.einkauf-kopf');
      return (await page.textContent('.einkauf-kopf')).replace(/\s+/g, ' ');
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
