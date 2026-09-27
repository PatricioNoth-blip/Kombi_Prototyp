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

  test('nur POST', async () => {
    const r = await handler(new Request('http://x', { method: 'GET' }));
    assert.equal(r.status, 405);
  });
});
