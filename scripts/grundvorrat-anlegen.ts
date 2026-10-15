// Legt den Grundvorrat als Sorten in der echten Datenbank an – Menge 0, Mengen bucht man in der App ein.
// Schon Vorhandenes (gleicher Name oder derselbe Grundbaustein) wird übersprungen; mehrfach ausführen
// schadet nicht. Nutzt dieselben Rechte wie die App (Publishable key aus .env) – löscht und bucht nichts.
//
//   node scripts/grundvorrat-anlegen.ts               Vorschau: zeigt nur, was angelegt würde
//   node scripts/grundvorrat-anlegen.ts --ausfuehren  legt an
// Auf GitHub: Actions → „Grundvorrat anlegen“ → Run workflow.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { planeGrundvorrat, type Vorhanden } from './grundvorrat.ts';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z && !z.startsWith('#') && z.includes('='))
    .map((z) => [z.slice(0, z.indexOf('=')).trim(), z.slice(z.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const ausfuehren = process.argv.includes('--ausfuehren');
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY, { auth: { persistSession: false } });

const { data, error } = await db.from('block_typ').select('id, name, farbe');
if (error) {
  console.error(`Sorten lesen fehlgeschlagen: ${error.message}`);
  process.exit(1);
}
const plan = planeGrundvorrat(data as Vorhanden[]);

console.log(`Vorhanden: ${data.length} Sorten.`);
for (const { sorte, als } of plan.schonDa) console.log(`• ${sorte.name}: schon da als „${als}“ – übersprungen`);
for (const s of plan.anlegen) console.log(`${ausfuehren ? '+' : '○'} ${s.name} (${s.farbe}, ${s.art}, ${s.einheit}, ${s.lagerort})`);

if (!ausfuehren) {
  console.log(`Vorschau: ${plan.anlegen.length} Sorten würden angelegt. Mit --ausfuehren anlegen.`);
  process.exit(0);
}
let angelegt = 0;
for (const s of plan.anlegen) {
  const { error: fehler } = await db.from('block_typ').insert({ ...s, mindestbestand: 0 });
  if (fehler) {
    console.error(`✗ ${s.name}: ${fehler.message}`);
    process.exitCode = 1;
  } else angelegt++;
}
console.log(`${angelegt} von ${plan.anlegen.length} Sorten angelegt (Menge 0). ${plan.schonDa.length} waren schon da.`);
