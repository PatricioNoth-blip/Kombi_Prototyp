// Bestand als Grundlage: Snapshot, Kühlschrank, keine erfundenen Zutaten, Fehlendes, Kosten, Portionen.
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
    assert.equal(snap.preise.some((p) => p.name === 'Tomatensoße'), true, 'Preis bleibt für Einkäufe bekannt');
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
  test('mehr als vorhanden → Rest fehlt (mit Preis für genau diese Menge), eingeplant wird nur der Bestand', () => {
    const p = pruefeGericht({ name: 'Riesen-Wrap', zutaten: [{ id: 'b9', portionen: 10 }, { id: 'b3', portionen: 1 }] }, snapshot(), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.equal(p.wert.zutaten.find((z) => z.name === 'Wrap')?.menge, 4);
    assert.deepEqual(p.wert.fehlt, [
      { name: 'Wrap', grund: 'zu_wenig', menge: 6, einheit: 'portion', preis_cent: 36, preis_bezug: 'für 6 Portionen' },
    ]);
    assert.equal(p.wert.kosten.einkauf_cent, 36);
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

describe('Kosten korrekt berechnen', () => {
  test('Portionen × Preis pro Portion, geteilt durch Personen (ältere Angabe „bloecke“ geht weiter)', () => {
    // Linsen 2 × 8 ct + Tomatensoße 1 × 17 ct + Wrap 2 × 6 ct = 45 ct → 2 Personen: 22,5 → 23 ct
    const p = pruefeGericht(
      { name: 'Linsen-Wrap', zutaten: [{ id: 'b3', portionen: 2 }, { id: 'b1', bloecke: 1 }, { id: 'b9', portionen: 2 }, { id: 'g-salz' }] },
      snapshot(), OPTIONEN, 'x',
    );
    assert.ok(p.ok);
    assert.deepEqual(p.wert.kosten, {
      status: 'berechnet', gesamt_cent: 45, pro_portion_cent: 23, personen: 2,
      unbekannt: [], einkauf_cent: null, einkauf_unbekannt: [],
    });
  });

  test('Kühlschrank-Reste haben keinen Preis → Kosten als unvollständig markiert, nicht erfunden', () => {
    const p = pruefeGericht(
      { name: 'Paprika-Linsen-Pfanne', zutaten: [{ id: 'b3', portionen: 2 }, { id: 'k1' }] },
      snapshot(SEED, 'halbe Paprika'), OPTIONEN, 'x',
    );
    assert.ok(p.ok);
    assert.equal(p.wert.kosten.gesamt_cent, 16);
    assert.equal(p.wert.kosten.status, 'teilweise');
    assert.deepEqual(p.wert.kosten.unbekannt, ['halbe Paprika']);
  });

  test('Preis fehlender Zutaten nur aus Bestandsdaten, sonst unbekannt', () => {
    const leererWrap = SEED.map((z) => (z.name === 'Wrap' ? { ...z, anzahl: 0 } : z));
    const p = pruefeGericht(
      { name: 'Linsen-Wrap', zutaten: [{ id: 'b3', bloecke: 1 }], fehlt: [{ name: 'Wrap' }, { name: 'Avocado' }] },
      snapshot(leererWrap), OPTIONEN, 'x',
    );
    assert.ok(p.ok);
    assert.deepEqual(p.wert.fehlt.map((f) => [f.name, f.preis_cent, f.preis_bezug]), [['Wrap', 6, 'pro Portion'], ['Avocado', null, null]]);
    // Wie viel Wrap gekauft werden muss, weiß niemand – also keine erfundene Einkaufssumme.
    assert.equal(p.wert.kosten.einkauf_cent, null);
    assert.deepEqual(p.wert.kosten.einkauf_unbekannt, ['Wrap', 'Avocado']);
  });
});

describe('Portionen korrekt berechnen', () => {
  test('mehr Personen → mehr Portionen, Preis pro Portion teilt durch Personen', async () => {
    const zwei = await erzeugeVorschlaege(regelbasiert(), anfrage(), { id: ids() });
    const vier = await erzeugeVorschlaege(regelbasiert(), anfrage({ optionen: { ...OPTIONEN, personen: 4 } }), { id: ids() });
    const menge = (g: typeof zwei.gerichte[number]) => g.zutaten.reduce((s, z) => s + (z.menge ?? 0), 0);
    assert.ok(menge(vier.gerichte[0]) > menge(zwei.gerichte[0]));
    for (const g of vier.gerichte) {
      assert.equal(g.kosten.personen, 4);
      assert.equal(g.portionen, 4);
      assert.ok(Math.abs((g.kosten.pro_portion_cent as number) - (g.kosten.gesamt_cent as number) / 4) <= 0.5);
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

  test('Einträge kommen in den Snapshot (ohne Menge/Preis, bald verbrauchen) und werden genutzt', async () => {
    const snap = snapshot(SEED, 'halbe Paprika, Frischkäse');
    const k = snap.zutaten.filter((z) => z.quelle === 'kuehlschrank');
    assert.deepEqual(k.map((z) => [z.id, z.name, z.anzahl, z.kosten_cent, z.bald_verbrauchen]), [
      ['k1', 'halbe Paprika', null, null, true],
      ['k2', 'Frischkäse', null, null, true],
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
