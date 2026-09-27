// Edge Function „bon-lesen“: KI nur als OCR – Konfiguration, Anfrage, Fehler, Prüfung der Antwort.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { bonLeserAusUmgebung, leseBon, pruefeDateien, type BonLeserKonfig } from '../../supabase/functions/_shared/kombi/bon/leser.ts';
import { KiFehler } from '../../supabase/functions/_shared/kombi/anbieter/openai_kompatibel.ts';

const BILD = { mime: 'image/jpeg', daten: 'A'.repeat(400) };
const env = (werte: Record<string, string>) => (name: string) => werte[name];

function attrappe(antworten: { status: number; body: unknown }[]) {
  const anfragen: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    anfragen.push({ url, body: JSON.parse(String(init.body)) });
    const a = antworten[Math.min(anfragen.length - 1, antworten.length - 1)];
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status });
  }) as unknown as typeof fetch;
  return { f, anfragen };
}
const kiText = (inhalt: string) => ({ choices: [{ message: { content: inhalt } }] });

describe('Bon lesen per KI (Edge Function)', () => {
  test('ohne API-Key nicht eingerichtet; Standard-Modelle mit Bildverständnis, KI_BON_MODELL überschreibt', () => {
    assert.equal(bonLeserAusUmgebung(env({})), null);
    assert.equal(bonLeserAusUmgebung(env({ KI_API_KEY: 'x' }))?.modell, 'meta-llama/llama-4-scout-17b-16e-instruct');
    assert.equal(bonLeserAusUmgebung(env({ KI_API_KEY: 'x', KI_ANBIETER: 'gemini' }))?.modell, 'gemini-2.5-flash');
    assert.equal(bonLeserAusUmgebung(env({ KI_API_KEY: 'x', KI_BON_MODELL: 'mein-modell' }))?.modell, 'mein-modell');
  });

  test('Anfrage: Bilder als image_url, Temperatur 0, JSON-Modus – Antwort wird geprüft', async () => {
    const { f, anfragen } = attrappe([{ status: 200, body: kiText('{"seiten":[{"zeilen":["REWE","TOMATEN 1KG 1,49 B"]}],"namen":{"TOMATEN 1KG":"Tomaten"}}') }]);
    const k = { ...bonLeserAusUmgebung(env({ KI_API_KEY: 'x' }))!, fetch: f };
    const l = await leseBon(k, [BILD, BILD]);
    assert.deepEqual(l, { seiten: [['REWE', 'TOMATEN 1KG 1,49 B']], namen: { 'TOMATEN 1KG': 'Tomaten' } });
    const body = anfragen[0].body as { temperature: number; response_format: unknown; messages: { content: unknown }[] };
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    const teile = body.messages[1].content as { type: string; image_url?: { url: string } }[];
    assert.equal(teile.filter((t) => t.type === 'image_url').length, 2);
    assert.match(teile[1].image_url!.url, /^data:image\/jpeg;base64,A+$/);
  });

  test('Modell ohne JSON-Modus → zweiter Versuch ohne; Denk-Text und ```json werden entfernt', async () => {
    const { f, anfragen } = attrappe([
      { status: 400, body: 'response_format json_object not supported' },
      { status: 200, body: kiText('<think>…</think>```json\n{"seiten":[["SUMME 1,49"]]}\n```') },
    ]);
    const l = await leseBon({ ...bonLeserAusUmgebung(env({ KI_API_KEY: 'x' }))!, fetch: f }, [BILD]);
    assert.deepEqual(l.seiten, [['SUMME 1,49']]);
    assert.equal(anfragen[1].body.response_format, undefined);
  });

  test('Fehler verständlich: Modell fehlt, Kontingent, nichts lesbar, PDF beim falschen Anbieter', async () => {
    const k = (body: unknown, status: number): BonLeserKonfig => ({ ...bonLeserAusUmgebung(env({ KI_API_KEY: 'x' }))!, fetch: attrappe([{ status, body }]).f });
    await assert.rejects(leseBon(k('model not found', 404), [BILD]), /KI_BON_MODELL/);
    await assert.rejects(leseBon(k('rate limit', 429), [BILD]), (e: KiFehler) => e.status === 429);
    await assert.rejects(leseBon(k(kiText('{"seiten":[]}'), 200), [BILD]), (e: KiFehler) => e.status === 422);
    await assert.rejects(leseBon(k(kiText('{}'), 200), [{ mime: 'application/pdf', daten: 'A'.repeat(400) }]), /keine PDFs/);
  });

  test('Anfrage der App wird geprüft: 1–6 Dateien, nur Bilder/PDF, Base64', () => {
    assert.deepEqual(pruefeDateien({ dateien: [BILD] }), [BILD]);
    assert.throws(() => pruefeDateien({ dateien: [] }), /1 bis 6/);
    assert.throws(() => pruefeDateien({ dateien: Array(7).fill(BILD) }), /1 bis 6/);
    assert.throws(() => pruefeDateien({ dateien: [{ mime: 'text/html', daten: 'A'.repeat(400) }] }), /Nur Fotos/);
    assert.throws(() => pruefeDateien({ dateien: [{ mime: 'image/png', daten: '<script>'.repeat(50) }] }), /Nur Fotos/);
  });
});
