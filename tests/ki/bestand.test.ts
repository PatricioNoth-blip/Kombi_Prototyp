// Bestand als Grundlage: Snapshot, Kühlschrank, keine erfundenen Zutaten, Fehlendes, Mengen, Portionen.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { baueSnapshot, kuehlschrankEintraege } from '../../supabase/functions/_shared/kombi/snapshot.ts';
import { pruefeGericht } from '../../supabase/functions/_shared/kombi/validierung.ts';
import { erzeugeVorschlaege } from '../../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { anfrage, festerAnbieter, ids, OPTIONEN, SEED, snapshot } from './fixtures.ts';

describe('Rezept aus vorhandenem Bestand', () => {
  test('alle Zutaten stammen aus dem Snapshot, nichts fehlt', async () => {
    const snap = snapshot();
    const e = await erzeugeVorschlaege(regelbasiert(), anfrage({ snapshot: snap }), { id: ids() });
    assert.equal(e.gerichte.length, 3);
    const idsImSnapshot = new Set(snap.zutaten.map((z) => z.id));
    for (const g of e.gerichte) {
      assert.ok(g.zutaten.some((z) => z.quelle === 'bestand'), g.name);
      for (const z of g.zutaten) assert.ok(idsImSnapshot.has(z.id), `${z.name} ist im Snapshot`);
      assert.deepEqual(g.fehlt, [], `${g.name}: nichts fehlt`);
      assert.ok(g.warum_jetzt.includes('Du hast alles zuhause.'));
    }
    assert.equal(e.notfall, false);
    assert.equal(e.einkauf, null, 'kein Einkauf, wenn der Bestand reicht');
  });

  test('leere Sorten (Anzahl 0) gelten nicht als vorhanden', () => {
    const snap = baueSnapshot([{ ...SEED[0], anzahl: 0 }, SEED[2]], '', '2026-09-28');
    assert.equal(snap.zutaten.some((z) => z.name === 'Tomatensoße'), false);
  });
});

describe('keine erfundenen Bestände', () => {
  test('unbekannte IDs und Namen landen unter „fehlt“, nie unter den Zutaten', () => {
    const p = pruefeGericht(
      {
        name: 'Lachs-Linsen-Pfanne',
        zutaten: [{ id: 'b3', bloecke: 1 }, { id: 'b999', name: 'Lachs' }, { name: 'Parmesan' }],
      },
      snapshot(), OPTIONEN, 'x',
    );
    assert.ok(p.ok);
    const namen = p.wert.zutaten.map((z) => z.name);
    assert.deepEqual(namen, ['Linsen gekocht']);
    assert.deepEqual(p.wert.fehlt.map((f) => f.name).sort(), ['Lachs', 'Parmesan']);
    assert.ok(p.wert.fehlt.every((f) => f.grund === 'nicht_im_bestand'));
  });

  test('Gericht nur aus erfundenen Zutaten wird verworfen', async () => {
    const ki = festerAnbieter({
      vorschlaege: [{ name: 'Sushi', zutaten: [{ name: 'Lachs' }, { name: 'Sushireis' }, { id: 'g-salz' }] }],
    });
    const e = await erzeugeVorschlaege(ki, anfrage(), { id: ids() });
    assert.equal(e.gerichte.length, 0);
    assert.match(e.verworfen[0].grund, /keine vorhandenen Zutaten/);
  });

  test('Namen ohne ID werden nur bei exakter Übereinstimmung als vorhanden erkannt', () => {
    const p = pruefeGericht({ name: 'Test', zutaten: [{ name: 'tomatensoße', bloecke: 1 }, { name: 'Tomaten' }] }, snapshot(), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.deepEqual(p.wert.zutaten.map((z) => z.name), ['Tomatensoße']);
    assert.deepEqual(p.wert.fehlt.map((f) => f.name), ['Tomaten']);
  });
});

describe('fehlende Zutaten erkennen', () => {
  test('mehr als vorhanden → genau der Rest fehlt, eingeplant wird nur der Bestand', () => {
    const p = pruefeGericht({ name: 'Riesen-Wrap', zutaten: [{ id: 'b9', portionen: 10 }, { id: 'b3', portionen: 1 }] }, snapshot(), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.equal(p.wert.zutaten.find((z) => z.name === 'Wrap')?.menge, 4);
    assert.deepEqual(p.wert.fehlt, [
      { name: 'Wrap', grund: 'zu_wenig', menge: 6, einheit: 'portion' },
    ]);
  });

  test('„fehlt“ der KI wird übernommen – aber nicht, wenn wir es haben', () => {
    const p = pruefeGericht(
      { name: 'Curry', zutaten: [{ id: 'b2', bloecke: 1 }], fehlt: [{ name: 'Kokosmilch' }, { name: 'Wrap' }] },
      snapshot(), OPTIONEN, 'x',
    );
    assert.ok(p.ok);
    assert.deepEqual(p.wert.fehlt.map((f) => f.name), ['Kokosmilch']);
    assert.deepEqual(p.wert.warum_jetzt[0], 'Du hast fast alles zuhause.');
  });

  test('zu viele fehlende Zutaten → kein „Essen aus dem Vorrat“', () => {
    const p = pruefeGericht(
      { name: 'Paella', zutaten: [{ id: 'b6', bloecke: 1 }], fehlt: [{ name: 'Safran' }, { name: 'Garnelen' }, { name: 'Muscheln' }, { name: 'Paellareis' }] },
      snapshot(), OPTIONEN, 'x',
    );
    assert.equal(p.ok, false);
  });
});

describe('Mengen aus dem Bestand', () => {
  test('Portionen je Zutat (ältere Angabe „bloecke“ geht weiter), ohne Kosten', () => {
    const p = pruefeGericht(
      { name: 'Linsen-Wrap', zutaten: [{ id: 'b3', portionen: 2 }, { id: 'b1', bloecke: 1 }, { id: 'b9', portionen: 2 }, { id: 'g-salz' }] },
      snapshot(), OPTIONEN, 'x',
    );
    assert.ok(p.ok);
    assert.deepEqual(p.wert.zutaten.map((z) => [z.name, z.menge]), [['Linsen gekocht', 2], ['Tomatensoße', 1], ['Wrap', 2], ['Salz', null]]);
    assert.equal('kosten' in p.wert, false);
  });

  test('Kühlschrank-Reste haben keine Menge → werden genutzt, aber nie erfunden abgebucht', () => {
    const p = pruefeGericht(
      { name: 'Paprika-Linsen-Pfanne', zutaten: [{ id: 'b3', portionen: 2 }, { id: 'k1' }] },
      snapshot(SEED, 'halbe Paprika'), OPTIONEN, 'x',
    );
    assert.ok(p.ok);
    assert.deepEqual(p.wert.zutaten.map((z) => [z.name, z.quelle, z.menge]), [['Linsen gekocht', 'bestand', 2], ['halbe Paprika', 'kuehlschrank', null]]);
  });

  test('fehlende Zutaten ohne bekannte Menge bleiben ohne Menge', () => {
    const leererWrap = SEED.map((z) => (z.name === 'Wrap' ? { ...z, anzahl: 0 } : z));
    const p = pruefeGericht(
      { name: 'Linsen-Wrap', zutaten: [{ id: 'b3', bloecke: 1 }], fehlt: [{ name: 'Wrap' }, { name: 'Avocado' }] },
      snapshot(leererWrap), OPTIONEN, 'x',
    );
    assert.ok(p.ok);
    assert.deepEqual(p.wert.fehlt.map((f) => [f.name, f.menge]), [['Wrap', null], ['Avocado', null]]);
  });
});

describe('Portionen korrekt berechnen', () => {
  test('mehr Personen → mehr Portionen', async () => {
    const zwei = await erzeugeVorschlaege(regelbasiert(), anfrage(), { id: ids() });
    const vier = await erzeugeVorschlaege(regelbasiert(), anfrage({ optionen: { ...OPTIONEN, personen: 4 } }), { id: ids() });
    const menge = (g: typeof zwei.gerichte[number]) => g.zutaten.reduce((s, z) => s + (z.menge ?? 0), 0);
    assert.ok(menge(vier.gerichte[0]) > menge(zwei.gerichte[0]));
    for (const g of vier.gerichte) {
      assert.equal(g.portionen, 4);
    }
  });

  test('Portionen-Blöcke werden auf ganze Zahlen ≥ 1 gebracht (halbe Blöcke gibt es nicht)', () => {
    const p = pruefeGericht({ name: 'Test', zutaten: [{ id: 'b3', portionen: 0 }, { id: 'b1', portionen: 1.6 }] }, snapshot(), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.deepEqual(p.wert.zutaten.map((z) => z.menge), [1, 2]);
  });
});

describe('Kühlschrank-Zusatzangaben', () => {
  test('Freitext wird in einzelne Einträge zerlegt', () => {
    assert.deepEqual(
      kuehlschrankEintraege('Ich habe noch eine halbe Paprika, etwas Frischkäse und eine angebrochene Packung Mais.'),
      ['eine halbe Paprika', 'etwas Frischkäse', 'eine angebrochene Packung Mais'],
    );
    assert.deepEqual(kuehlschrankEintraege('Mais; mais\nZucchini'), ['Mais', 'Zucchini']);
    assert.deepEqual(kuehlschrankEintraege('   '), []);
  });

  test('Einträge kommen in den Snapshot (ohne Menge, bald verbrauchen) und werden genutzt', async () => {
    const snap = snapshot(SEED, 'halbe Paprika, Frischkäse');
    const k = snap.zutaten.filter((z) => z.quelle === 'kuehlschrank');
    assert.deepEqual(k.map((z) => [z.id, z.name, z.anzahl, z.bald_verbrauchen]), [
      ['k1', 'halbe Paprika', null, true],
      ['k2', 'Frischkäse', null, true],
    ]);
    const e = await erzeugeVorschlaege(regelbasiert(), anfrage({ snapshot: snap }), { id: ids() });
    assert.ok(e.gerichte.some((g) => g.zutaten.some((z) => z.quelle === 'kuehlschrank')));
    assert.ok(e.gerichte.some((g) => g.warum_jetzt.some((w) => w.startsWith('Verwertet deine Reste'))));
  });

  test('Grundausstattung ist immer da, alles andere nicht', () => {
    const snap = snapshot([], '');
    assert.deepEqual(snap.zutaten.map((z) => z.name), ['Wasser', 'Salz', 'Pfeffer', 'Öl']);
  });
});
