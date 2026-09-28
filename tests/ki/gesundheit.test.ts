// KI-Verbindung nachvollziehbar prüfen: Konfiguration ohne Keys, Probelauf mit Messwerten.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_VERSION, gesundheit, kiProbe, PROBE_ANFRAGE } from '../../supabase/functions/_shared/kombi/gesundheit.ts';
import { kiKonfiguration } from '../../supabase/functions/_shared/kombi/anbieter/konfiguration.ts';
import { KiFehler } from '../../supabase/functions/_shared/kombi/anbieter/openai_kompatibel.ts';
import { festerAnbieter } from './fixtures.ts';

const env = (werte: Record<string, string>) => (k: string) => werte[k];

describe('Health-Check', () => {
  test('ohne Key: nicht eingerichtet – Anbieter und Modell trotzdem sichtbar, Key nie', () => {
    assert.deepEqual(kiKonfiguration(env({})), { eingerichtet: false, anbieter: 'groq', modell: 'openai/gpt-oss-120b', host: 'api.groq.com' });
    const g = gesundheit(env({ KI_API_KEY: 'geheim', KI_ANBIETER: 'gemini' }), null, false);
    assert.equal(g.version, ENGINE_VERSION);
    assert.deepEqual([g.ki.eingerichtet, g.ki.anbieter, g.ki.modell], [true, 'gemini', 'gemini-2.5-flash']);
    assert.ok(!JSON.stringify(g).includes('geheim'));
    assert.equal(g.bilder.generierung.eingerichtet, false);
    assert.equal(gesundheit(env({ BILD_SUCHE: 'aus' }), null, false).bilder.suche, 'aus');
  });

  test('Probelauf: gültige Antwort → JSON/Schema gültig, geprüfte Gerichte, Bildanforderungen gezählt', async () => {
    const ki = festerAnbieter({
      vorschlaege: [
        { name: 'Rote Samt-Pasta', zutaten: [{ id: 'b1', portionen: 1 }, { id: 'b3', portionen: 2 }], eigenschaften: { gerichtstyp: 'pasta' },
          image_request: { needed: true, query: 'pasta tomato sauce', aspect_ratio: '4:3' } },
        { name: 'Lachs-Traum', zutaten: [{ name: 'Lachs' }] },
      ],
    });
    let t = 1000;
    const p = await kiProbe(ki, () => (t += 250));
    assert.deepEqual([p.ok, p.json_gueltig, p.schema_gueltig, p.vorschlaege_roh, p.gerichte, p.bildanforderungen, p.bildanforderungen_ok],
      [true, true, true, 2, 1, 1, 1]);
    assert.equal(p.ms, 250);
    assert.equal(p.verworfen[0].name, 'Lachs-Traum', 'erfundene Zutat → verworfen');
    assert.deepEqual(p.namen, ['Rote Samt-Pasta']);
    assert.equal(ki.auftraege[0].snapshot, PROBE_ANFRAGE.snapshot, 'fester Probe-Haushalt, keine echten Daten');
  });

  test('Probelauf: kein JSON → json_gueltig false, verständlicher Fehler', async () => {
    const ki = { name: 'x', async vorschlagen() { throw new KiFehler('Die KI hat kein JSON geliefert.'); } };
    const p = await kiProbe(ki);
    assert.deepEqual([p.ok, p.json_gueltig, p.schema_gueltig], [false, false, false]);
    assert.match(p.fehler!, /kein JSON/);
  });

  test('Probelauf: nur Halluzinationen → nicht ok (kein Modell gewinnt durch Erfundenes)', async () => {
    const p = await kiProbe(festerAnbieter({ vorschlaege: [{ name: 'Steak-Traum', zutaten: [{ name: 'Rindersteak' }, { name: 'Pommes' }] }] }));
    assert.equal(p.ok, false);
    assert.equal(p.gerichte, 0);
    assert.equal(p.schema_gueltig, true);
  });
});
