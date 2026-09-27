// Supabase Edge Function „was-essen“: KI-Vorschläge für Abendessen.
//
// • Hält den API-Key der KI (Umgebungsvariablen, siehe _shared/kombi/anbieter/konfiguration.ts).
// • Bekommt von der App einen kontrollierten Snapshot + Session-Kontext, fragt die KI,
//   prüft die Antwort mit der Kombi-Engine und gibt nur geprüfte Vorschläge zurück.
// • Hat keinen Datenbankzugriff: Sie kann den Bestand weder lesen noch verändern.
//
// Antwortcodes: 200 Ergebnis · 400 ungültige Anfrage · 429 Kontingent erschöpft ·
//               503 KI nicht eingerichtet (die App nutzt dann den Demo-Modus) · 502 KI-Fehler
import { erzeugeVorschlaege } from '../_shared/kombi/engine.ts';
import { pruefeAnfrage, AnfrageFehler } from '../_shared/kombi/anfrage.ts';
import { anbieterAusUmgebung } from '../_shared/kombi/anbieter/konfiguration.ts';
import { KiFehler } from '../_shared/kombi/anbieter/openai_kompatibel.ts';

const MAX_BYTES = 200_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(daten: unknown, status = 200): Response {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ fehler: 'Nur POST.' }, 405);

  const anbieter = anbieterAusUmgebung((name) => Deno.env.get(name));
  if (!anbieter) return json({ fehler: 'KI ist noch nicht eingerichtet (KI_API_KEY fehlt).' }, 503);

  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ fehler: 'Anfrage zu groß.' }, 400);

  try {
    const anfrage = pruefeAnfrage(JSON.parse(text));
    const ergebnis = await erzeugeVorschlaege(anbieter, anfrage);
    return json(ergebnis);
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof AnfrageFehler) return json({ fehler: 'Ungültige Anfrage.' }, 400);
    if (e instanceof KiFehler) return json({ fehler: e.message }, e.status);
    console.error(e);
    return json({ fehler: 'Unerwarteter Fehler.' }, 500);
  }
});
