// Supabase Edge Function „was-essen“: KI-Vorschläge für Abendessen – und Bilder dazu.
//
// • Hält den API-Key der KI (Umgebungsvariablen, siehe _shared/kombi/anbieter/konfiguration.ts).
// • Bekommt von der App einen kontrollierten Snapshot + Session-Kontext, fragt die KI,
//   prüft die Antwort mit der Kombi-Engine und gibt nur geprüfte Vorschläge zurück.
// • Hat keinen Zugriff auf Tabellen: Sie kann den Bestand weder lesen noch verändern.
//   (Nur generierte Bilder legt sie – falls eingerichtet – im öffentlichen Speicher „bilder“ ab.)
//
// GET              Health-Check: Version, Anbieter, Modell, Bild-Einrichtung – ohne Keys.
// GET ?probe=1     zusätzlich ein echter, kleiner Probelauf (Antwortzeit, JSON, Schema, Prüfung).
// POST {aufgabe:"bild", bild:{…}}  Bild suchen (Wikimedia Commons) bzw. generieren.
// POST {snapshot, …}               Vorschläge (gerichte | woche | komponenten).
//
// Antwortcodes: 200 Ergebnis · 400 ungültige Anfrage · 429 Kontingent erschöpft ·
//               503 KI nicht eingerichtet (die App nutzt dann den Demo-Modus) · 502 KI-Fehler
import { bearbeite } from '../_shared/kombi/engine.ts';
import { pruefeAnfrage, AnfrageFehler } from '../_shared/kombi/anfrage.ts';
import { anbieterAusUmgebung } from '../_shared/kombi/anbieter/konfiguration.ts';
import { KiFehler } from '../_shared/kombi/anbieter/openai_kompatibel.ts';
import { ENGINE_VERSION, gesundheit, kiProbe } from '../_shared/kombi/gesundheit.ts';
import { pruefeBildAuftrag } from '../_shared/kombi/bilder.ts';
import { bildGeneratorAusUmgebung, bildSpeicherAusUmgebung, findeBild } from '../_shared/kombi/bild_dienst.ts';

const MAX_BYTES = 200_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(daten: unknown, status = 200): Response {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'x-kombi-version': ENGINE_VERSION },
  });
}

const env = (name: string) => Deno.env.get(name);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const anbieter = anbieterAusUmgebung(env);
  const generator = bildGeneratorAusUmgebung(env);
  const speicher = bildSpeicherAusUmgebung(env);

  if (req.method === 'GET') {
    const info = gesundheit(env, generator, speicher !== null);
    if (new URL(req.url).searchParams.get('probe') === '1' && anbieter) {
      return json({ ...info, probe: await kiProbe(anbieter) });
    }
    return json(info);
  }
  if (req.method !== 'POST') return json({ fehler: 'Nur GET und POST.' }, 405);

  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ fehler: 'Anfrage zu groß.' }, 400);

  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return json({ fehler: 'Ungültige Anfrage.' }, 400);
  }

  // Bilder: funktionieren auch ohne KI-Key (Suche braucht keinen Key)
  if ((roh as { aufgabe?: unknown } | null)?.aufgabe === 'bild') {
    const auftrag = pruefeBildAuftrag((roh as { bild?: unknown }).bild);
    if (!auftrag) return json({ fehler: 'Ungültige Bildanfrage.' }, 400);
    const ergebnis = await findeBild(auftrag, {
      fetch, generator, speicher, jetzt: new Date().toISOString(), suche: env('BILD_SUCHE')?.trim().toLowerCase() !== 'aus',
    });
    return json({ aufgabe: 'bild', schluessel: auftrag.schluessel, ...ergebnis });
  }

  if (!anbieter) return json({ fehler: 'KI ist noch nicht eingerichtet (KI_API_KEY fehlt).' }, 503);
  try {
    const anfrage = pruefeAnfrage(roh);
    const ergebnis = await bearbeite(anbieter, anfrage);
    return json({ ...ergebnis, version: ENGINE_VERSION });
  } catch (e) {
    if (e instanceof AnfrageFehler) return json({ fehler: 'Ungültige Anfrage.' }, 400);
    if (e instanceof KiFehler) return json({ fehler: e.message }, e.status);
    console.error(e instanceof Error ? e.message : 'Unerwarteter Fehler');
    return json({ fehler: 'Unerwarteter Fehler.' }, 500);
  }
});
