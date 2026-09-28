// Edge Function „was-essen“ in Node getestet: Deno.serve und die KI-Schnittstelle werden nachgebildet.
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { anfrage } from './fixtures.ts';

type Handler = (req: Request) => Promise<Response>;
let handler: Handler;
const env: Record<string, string> = {};
const kiAufrufe: { url: string; body: string; auth: string | null }[] = [];

before(async () => {
  (globalThis as unknown as { Deno: unknown }).Deno = {
    serve: (h: Handler) => { handler = h; },
    env: { get: (k: string) => env[k] },
  };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (String(url).startsWith('https://commons.wikimedia.org/')) {
      return new Response(JSON.stringify({ query: { pages: { 1: {
        title: 'File:Falafel.jpg',
        imageinfo: [{
          thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Falafel.jpg/800px-Falafel.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Falafel.jpg', mime: 'image/jpeg',
          extmetadata: { LicenseShortName: { value: 'CC0' }, ImageDescription: { value: 'falafel' } },
        }],
      } } } }), { status: 200 });
    }
    if (String(url).startsWith('https://upload.wikimedia.org/')) return new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    kiAufrufe.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>).authorization ?? null });
    const inhalt = JSON.stringify({
      vorschlaege: [
        { name: 'Linsen-Pizza-Wrap', zutaten: [{ id: 'b3', bloecke: 1 }, { id: 'b9', bloecke: 2 }], eigenschaften: { gerichtstyp: 'wrap' } },
        { name: 'Lachs-Traum', zutaten: [{ name: 'Lachs' }] },
      ],
    });
    return new Response(JSON.stringify({ choices: [{ message: { content: inhalt } }] }), { status: 200 });
  }) as typeof fetch;
  await import('../../supabase/functions/was-essen/index.ts');
});

const post = (body: unknown) =>
  handler(new Request('http://x/was-essen', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));

describe('Edge Function was-essen', () => {
  test('ohne KI-Key: 503, damit die App in den Demo-Modus wechselt – ohne KI-Aufruf', async () => {
    const r = await post(anfrage());
    assert.equal(r.status, 503);
    assert.equal(kiAufrufe.length, 0);
  });

  test('CORS-Vorabanfrage wird beantwortet', async () => {
    const r = await handler(new Request('http://x', { method: 'OPTIONS' }));
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
  });

  test('mit Key: fragt die KI (Key nur im Header) und gibt nur geprüfte Vorschläge zurück', async () => {
    env.KI_API_KEY = 'geheim';
    const r = await post(anfrage());
    assert.equal(r.status, 200);
    const e = await r.json();
    assert.equal(kiAufrufe.length, 1);
    assert.equal(kiAufrufe[0].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(kiAufrufe[0].auth, 'Bearer geheim');
    assert.ok(!kiAufrufe[0].body.includes('geheim'));
    assert.deepEqual(e.gerichte.map((g: { name: string }) => g.name), ['Linsen-Pizza-Wrap']);
    assert.equal(e.verworfen[0].name, 'Lachs-Traum', 'erfundene Zutaten → verworfen');
    assert.equal(e.gerichte[0].kosten.gesamt_cent, 8 + 12, 'Kosten aus Bestandspreisen');
  });

  test('kaputte oder zu große Anfragen → 400', async () => {
    assert.equal((await post('{kaputt')).status, 400);
    assert.equal((await post({ nix: 1 })).status, 400);
    assert.equal((await post('x'.repeat(300_000))).status, 400);
  });

  test('Health-Check (GET): Version, Anbieter, Modell, Bild-Einrichtung – ohne Keys', async () => {
    const r = await handler(new Request('http://x/was-essen', { method: 'GET' }));
    assert.equal(r.status, 200);
    const h = await r.json();
    assert.equal(h.ok, true);
    assert.match(h.version, /^\d{4}-\d{2}-\d{2}/);
    assert.equal(r.headers.get('x-kombi-version'), h.version);
    assert.deepEqual([h.ki.eingerichtet, h.ki.anbieter, h.ki.modell, h.ki.host], [true, 'groq', 'openai/gpt-oss-120b', 'api.groq.com']);
    assert.equal(h.bilder.suche, 'wikimedia-commons');
    assert.equal(h.bilder.generierung.eingerichtet, false);
    assert.equal(h.probe, undefined, 'ohne ?probe=1 kein KI-Aufruf');
    assert.ok(!JSON.stringify(h).includes('geheim'), 'kein Key in der Antwort');
  });

  test('Probelauf (?probe=1): echte Kette KI → JSON → Schema → Prüfung, mit Antwortzeit', async () => {
    const vorher = kiAufrufe.length;
    const h = await (await handler(new Request('http://x/was-essen?probe=1', { method: 'GET' }))).json();
    assert.equal(kiAufrufe.length, vorher + 1);
    assert.equal(h.probe.json_gueltig, true);
    assert.equal(h.probe.schema_gueltig, true);
    assert.equal(h.probe.vorschlaege_roh, 2);
    assert.equal(typeof h.probe.ms, 'number');
    assert.ok(Array.isArray(h.probe.verworfen));
  });

  test('Bild (POST aufgabe=bild): echtes Foto gefunden – auch ohne Bildgenerierung', async () => {
    const { bildAnfrageFuerKomponente } = await import('../../supabase/functions/_shared/kombi/bilder.ts');
    const r = await post({ aufgabe: 'bild', bild: bildAnfrageFuerKomponente({ name: 'Falafel', zutaten: [] })! });
    assert.equal(r.status, 200);
    const e = await r.json();
    assert.equal(e.bild.image_source, 'gefunden');
    assert.match(e.bild.image_url, /^https:\/\/upload\.wikimedia\.org\//);
    assert.equal(e.bild.lizenz, 'CC0');
    assert.equal((await post({ aufgabe: 'bild', bild: { art: 'gericht', prompt: 'irgendwas' } })).status, 400, 'ungültige Bildanfrage');
  });

  test('nur GET und POST', async () => {
    const r = await handler(new Request('http://x', { method: 'PUT' }));
    assert.equal(r.status, 405);
  });
});
