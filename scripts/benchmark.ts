// KI-Benchmark für Kombi – 30 reproduzierbare Szenarien, automatische Kombi-Prüfungen.
//
//   npm run benchmark                          nur regelbasiert (ohne KI, ohne Kosten)
//   npm run benchmark -- --attrappe            + absichtlich halluzinierende Attrappe (zeigt die Strafen)
//   GROQ_API_KEY=… GEMINI_API_KEY=… BENCH_ANBIETER=groq,gemini npm run benchmark
//   KI_ANBIETER=openrouter KI_API_KEY=… npm run benchmark      (wie in der Edge Function)
//
// Optionen: --szenarien=frisch-bowl,curry (oder BENCH_SZENARIEN)  --json=ergebnis.json  BENCH_PAUSE_MS=1500 (Pause gegen Rate-Limits)
// Modelle: BENCH_MODELL_GROQ=… usw. (sonst Standard des Anbieters). Keys werden nie ausgegeben.
import { writeFileSync } from 'node:fs';
import type { KiAnbieter } from '../supabase/functions/_shared/kombi/typen.ts';
import { anbieterAusUmgebung } from '../supabase/functions/_shared/kombi/anbieter/konfiguration.ts';
import { regelbasiert } from '../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { SZENARIEN } from './benchmark/szenarien.ts';
import { fasseZusammen, halluzinierer, messe, type Messung } from './benchmark/messung.ts';

const args = process.argv.slice(2);
const option = (name: string) => args.find((a: string) => a.startsWith(`--${name}=`))?.split('=')[1] ?? null;
const env = process.env as Record<string, string | undefined>;

const KEYS: Record<string, string> = { groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY', openrouter: 'OPENROUTER_API_KEY', ollama: '', eigen: 'EIGEN_API_KEY' };

function anbieter(): KiAnbieter[] {
  const liste: KiAnbieter[] = [regelbasiert()];
  if (args.includes('--attrappe')) liste.push(halluzinierer());
  for (const name of (env.BENCH_ANBIETER ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    const a = anbieterAusUmgebung((k) => ({
      KI_ANBIETER: name,
      KI_API_KEY: KEYS[name] ? env[KEYS[name]] : undefined,
      KI_MODELL: env[`BENCH_MODELL_${name.toUpperCase()}`],
      KI_BASIS_URL: env[`BENCH_BASIS_URL_${name.toUpperCase()}`],
    } as Record<string, string | undefined>)[k]);
    if (a) liste.push(a);
    else console.log(`– ${name}: nicht eingerichtet (${KEYS[name] || 'Basis-URL'} fehlt) – übersprungen`);
  }
  // wie in der Edge Function konfiguriert
  if (env.KI_API_KEY || env.KI_ANBIETER === 'ollama') {
    const a = anbieterAusUmgebung((k) => env[k]);
    if (a && !liste.some((x) => x.name === a.name)) liste.push(a);
  }
  return liste;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const zahl = (x: number | null) => (x === null ? '–' : x.toFixed(2));

const auswahl = (option('szenarien') ?? env.BENCH_SZENARIEN ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const szenarien = auswahl.length ? SZENARIEN.filter((s) => auswahl.includes(s.id)) : SZENARIEN;
const messungen: Messung[] = [];

for (const a of anbieter()) {
  console.log(`\n### ${a.name}`);
  for (const s of szenarien) {
    const m = await messe(a, s);
    messungen.push(m);
    const h = m.erfundene_zutaten + m.erfundene_mengen + m.erfundene_preise + m.erfundene_naehrwerte + m.bestandsbehauptungen + m.erfundene_bildquellen;
    console.log(`${m.punkte.toString().padStart(3)} P  ${s.id.padEnd(17)} ${String(m.ms).padStart(6)} ms  ${m.bestanden}/${m.roh} bestanden` +
      `  Halluz. ${h}  vorh. ${zahl(m.anteil_vorhanden)}  Vielfalt ${zahl(m.vielfalt)}  Bild ${m.bildanforderungen_plausibel}/${m.bildanforderungen}` +
      `${m.fehler ? `  FEHLER: ${m.fehler}` : ''}  ${m.namen.slice(0, 3).join(' | ')}`);
    if (!a.name.startsWith('regelbasiert') && !a.name.startsWith('attrappe')) await pause(Number(env.BENCH_PAUSE_MS ?? 1500));
  }
}

console.log('\n| Anbieter · Modell | Ø Punkte | Median ms | JSON ok | Format ok | bestanden/roh | Halluzinationen | generische Namen | Bild passend |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const z of fasseZusammen(messungen)) {
  console.log(`| ${z.anbieter} | ${z.punkte} | ${z.ms_median} | ${z.json_gueltig}/${z.szenarien} | ${z.schema_gueltig}/${z.szenarien} | ${z.bestanden}/${z.roh} | ${z.halluzinationen} | ${z.generische_namen} | ${z.bildanforderungen_plausibel} |`);
}
console.log('\nPunkte: nur geprüfte Vorschläge zählen; jede erfundene Tatsache (Zutat, Menge, Preis, kcal, Bestandsmenge, Bild-URL) kostet 5 Punkte.');

const ziel = option('json');
if (ziel) {
  writeFileSync(ziel, JSON.stringify({ stand: new Date().toISOString(), messungen, zusammenfassung: fasseZusammen(messungen) }, null, 2));
  console.log(`Gespeichert: ${ziel}`);
}
