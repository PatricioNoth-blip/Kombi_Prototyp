// Zentrale Kostenfunktion: deterministisch, proportional, unbekannt bleibt unbekannt.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  einheitspreis, euroText, kostenText, portionspreis, rundeCent, summiereKosten, verbrauchswert,
} from '../../supabase/functions/_shared/kombi/kosten.ts';
import { bezugText, mengeAusPortionen, mengeText } from '../../supabase/functions/_shared/kombi/mengen.ts';
import { pruefeGericht } from '../../supabase/functions/_shared/kombi/validierung.ts';
import { erzeugeVorschlaege } from '../../supabase/functions/_shared/kombi/engine.ts';
import { anfrage, festerAnbieter, ids, OPTIONEN, SEED, snapshot, zeile } from './fixtures.ts';

describe('Kostenfunktion', () => {
  test('2,00 € für 4 Portionen → 0,50 € pro Portion; 2 Portionen verbraucht → 1,00 €', () => {
    const pizza = { kosten_cent: 200, kosten_menge: 4, portion_menge: 1 };
    assert.equal(einheitspreis(pizza), 50);
    assert.equal(portionspreis(pizza), 50);
    assert.equal(verbrauchswert(2, pizza), 100);
  });

  test('Gramm, ml und Stück werden proportional berechnet', () => {
    // 1,29 € für 500 g → 125 g = 32,25 ct
    assert.equal(verbrauchswert(125, { kosten_cent: 129, kosten_menge: 500 }), 32.25);
    // 0,99 € für 1 l → 250 ml = 24,75 ct
    assert.equal(verbrauchswert(250, { kosten_cent: 99, kosten_menge: 1000 }), 24.75);
    // 1,50 € für 6 Stück → 2 Stück = 50 ct
    assert.equal(verbrauchswert(2, { kosten_cent: 150, kosten_menge: 6 }), 50);
    // Portion à 125 g bei 1,29 €/500 g
    assert.equal(portionspreis({ kosten_cent: 129, kosten_menge: 500, portion_menge: 125 }), 32.25);
  });

  test('unbekannter Preis bleibt null – nie 0, nie geschätzt', () => {
    assert.equal(einheitspreis({ kosten_cent: null, kosten_menge: 1 }), null);
    assert.equal(verbrauchswert(3, { kosten_cent: null, kosten_menge: 4 }), null);
    const k = summiereKosten([{ name: 'Pizza', cent: null }], 2);
    assert.deepEqual(k, {
      status: 'unbekannt', gesamt_cent: null, pro_portion_cent: null, personen: 2,
      unbekannt: ['Pizza'], einkauf_cent: null, einkauf_unbekannt: [],
    });
    assert.equal(kostenText(k), 'Preis unbekannt');
  });

  test('teils bekannt → „teilweise“: Summe der bekannten, Rest wird benannt', () => {
    const k = summiereKosten([{ name: 'Linsen', cent: 16 }, { name: 'halbe Paprika', cent: null }], 2);
    assert.equal(k.status, 'teilweise');
    assert.equal(k.gesamt_cent, 16);
    assert.equal(k.pro_portion_cent, 8);
    assert.deepEqual(k.unbekannt, ['halbe Paprika']);
    assert.equal(kostenText(k), 'ab 0,08 € / Portion');
  });

  test('gerundet wird erst am Ende', () => {
    // 3 × ein Drittel von 1,00 € = 1,00 € (nicht 3 × 33 ct = 0,99 €)
    const drittel = verbrauchswert(1, { kosten_cent: 100, kosten_menge: 3 }) as number;
    const k = summiereKosten([{ name: 'a', cent: drittel }, { name: 'b', cent: drittel }, { name: 'c', cent: drittel }], 1);
    assert.equal(k.gesamt_cent, 100);
    assert.equal(rundeCent(49.999999999), 50);
    assert.equal(kostenText(k), 'ca. 1,00 € / Portion');
    assert.equal(euroText(124), '1,24 €');
  });

  test('Mengen und Bezüge verständlich', () => {
    assert.equal(mengeAusPortionen(2, 'g', 125), 250);
    assert.equal(mengeAusPortionen(1.5, 'portion', 1), 2, 'halbe Blöcke werden aufgerundet');
    assert.equal(mengeAusPortionen(1.5, 'stueck', 2), 3);
    assert.equal(mengeText(1500, 'g'), '1,5 kg');
    assert.equal(mengeText(1, 'portion'), '1 Portion');
    assert.equal(bezugText(4, 'portion'), 'für 4 Portionen');
    assert.equal(bezugText(500, 'g'), 'für 500 g');
    assert.equal(bezugText(1, 'portion'), 'pro Portion');
  });
});

describe('Kosten im Gericht', () => {
  const BAUKASTEN = [
    zeile(20, 'Spaghetti', 'gelb', 125, 129, 500, { einheit: 'g', portion_menge: 125, kosten_menge: 500, art: 'zutat', lagerort: 'vorrat' }),
    zeile(21, 'TK-Pizza', 'blau', 350, 200, 4, { kosten_menge: 4, art: 'komplettgericht' }),
    zeile(22, 'Bolognese', 'rot', 150, null, 3, { art: 'komponente' }),
  ];

  test('Gramm-Zutat: 2 Portionen à 125 g aus 1,29 €/500 g → 250 g = 64,5 ct', () => {
    const p = pruefeGericht({ name: 'Spaghetti Bolognese', zutaten: [{ id: 'b20', portionen: 2 }, { id: 'b22', portionen: 2 }] }, snapshot(BAUKASTEN), OPTIONEN, 'x');
    assert.ok(p.ok, !p.ok ? p.grund : '');
    const spaghetti = p.wert.zutaten.find((z) => z.name === 'Spaghetti')!;
    assert.equal(spaghetti.menge, 250);
    assert.equal(spaghetti.einheit, 'g');
    assert.equal(spaghetti.portionen, 2);
    assert.equal(spaghetti.kosten_cent, 64.5);
    // Bolognese ohne Preis → teilweise, nicht erfunden
    assert.equal(p.wert.kosten.status, 'teilweise');
    assert.deepEqual(p.wert.kosten.unbekannt, ['Bolognese']);
    assert.equal(p.wert.kosten.gesamt_cent, 65);
  });

  test('Komplettgericht: 2 von 4 Portionen TK-Pizza à 2,00 € → 1,00 €, 0,50 € pro Person', () => {
    const p = pruefeGericht({ name: 'Pizza-Abend', zutaten: [{ id: 'b21', portionen: 2 }] }, snapshot(BAUKASTEN), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.equal(p.wert.kosten.status, 'berechnet');
    assert.equal(p.wert.kosten.gesamt_cent, 100);
    assert.equal(p.wert.kosten.pro_portion_cent, 50);
    assert.equal(kostenText(p.wert.kosten), 'ca. 0,50 € / Portion');
  });

  test('die KI kann keine Preise setzen: Preisfelder werden ignoriert, Preissätze entfernt', async () => {
    const ki = festerAnbieter({
      vorschlaege: [{
        name: 'Linsen-Wrap', zutaten: [{ id: 'b3', portionen: 2 }, { id: 'b9', portionen: 2 }],
        beschreibung: 'Würzige Linsen im knusprigen Wrap. Kostet nur 0,20 € pro Portion!',
        begruendung: 'Für 12 Cent satt werden.',
        kosten: { gesamt_cent: 1, pro_portion_cent: 1 },
      } as never],
    });
    const e = await erzeugeVorschlaege(ki, anfrage(), { id: ids() });
    const g = e.gerichte[0];
    // Linsen 2 × 8 + Wrap 2 × 6 = 28 ct
    assert.equal(g.kosten.gesamt_cent, 28);
    assert.equal(g.kosten.pro_portion_cent, 14);
    assert.equal(g.beschreibung, 'Würzige Linsen im knusprigen Wrap.');
    assert.equal(g.begruendung, '');
    assert.doesNotMatch(JSON.stringify([g.name, g.beschreibung, g.begruendung, g.schritte]), /€|Cent/);
  });

  test('Seed-Preise pro Block laufen unverändert weiter (Preis pro 1 Portion)', () => {
    const s = snapshot(SEED);
    const linsen = s.zutaten.find((z) => z.name === 'Linsen gekocht')!;
    assert.equal(linsen.kosten_menge, 1);
    assert.equal(portionspreis(linsen), 8);
  });
});
