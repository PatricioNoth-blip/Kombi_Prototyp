// Supabase Edge Function „bon-lesen“: Kassenbon-Fotos (und bei Gemini auch PDFs) abschreiben lassen.
//
// • Hält den API-Key der KI (Umgebungsvariablen, siehe _shared/kombi/bon/leser.ts).
// • Gibt NUR geprüften Text zurück ({ seiten: string[][], namen: {…} }). Mengen, Preise und
//   Zuordnung bestimmt die App mit dem deterministischen Parser – nie die KI.
// • Hat keinen Datenbankzugriff: Sie kann den Bestand weder lesen noch verändern.
//
// Antwortcodes: 200 Text · 400 ungültige Anfrage · 422 nichts lesbar · 429 Kontingent erschöpft ·
//               503 KI nicht eingerichtet (die App bietet dann „Text einfügen“ an) · 502 KI-Fehler
import { bonLeserAusUmgebung, leseBon, pruefeDateien } from '../_shared/kombi/bon/leser.ts';
import { KiFehler } from '../_shared/kombi/anbieter/openai_kompatibel.ts';

const MAX_BYTES = 9_000_000;

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

  const leser = bonLeserAusUmgebung((name) => Deno.env.get(name));
  if (!leser) return json({ fehler: 'KI ist noch nicht eingerichtet (KI_API_KEY fehlt).' }, 503);

  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ fehler: 'Die Fotos sind zu groß – bitte weniger oder kleinere Fotos.' }, 400);

  try {
    const lesung = await leseBon(leser, pruefeDateien(JSON.parse(text)));
    return json({ ...lesung, anbieter: `${leser.name}:${leser.modell}` });
  } catch (e) {
    if (e instanceof SyntaxError) return json({ fehler: 'Ungültige Anfrage.' }, 400);
    if (e instanceof KiFehler) return json({ fehler: e.message }, e.status);
    console.error(e);
    return json({ fehler: 'Unerwarteter Fehler.' }, 500);
  }
});
