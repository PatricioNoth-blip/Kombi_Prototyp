// Baukasten-Datenmodell: Zutat / Komponente / Komplettgericht, Einheiten, Ablauf, geöffnet,
// „Heute kochen“ für Komplettgerichte und Rezepte, strukturiert gespeicherte Rezepte.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { baueSnapshot, type BestandZeile } from '../../supabase/functions/_shared/kombi/snapshot.ts';
import { pruefeGericht } from '../../supabase/functions/_shared/kombi/validierung.ts';
import { erzeugeVorschlaege } from '../../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import {
  entnahmePlan, postenText, pruefeEntnahme, rezeptDatensatz,
} from '../../supabase/functions/_shared/kombi/aktionen.ts';
import type { Gericht } from '../../supabase/functions/_shared/kombi/typen.ts';
import { anfrage, ids, OPTIONEN, SEED, snapshot, zeile } from './fixtures.ts';

const DATUM = '2026-09-28';

const HAUSHALT: BestandZeile[] = [
  zeile(30, 'TK-Pizza Margherita', 'blau', 350, 200, 4, { art: 'komplettgericht', herkunft: 'gekauft', kosten_menge: 4, zusammensetzung: ['Tomatensoße', 'Mozzarella'] }),
  zeile(31, 'Suppe', 'blau', 300, null, 3, { art: 'komplettgericht', herkunft: 'selbstgemacht' }),
  zeile(32, 'Spaghetti', 'gelb', 125, 129, 380, { art: 'zutat', einheit: 'g', portion_menge: 125, kosten_menge: 500, lagerort: 'vorrat', geoeffnet: 380 }),
  zeile(33, 'Linsen-Bolognese', 'rot', 150, 90, 4, { art: 'komponente', kosten_menge: 3, naechster_ablauf: '2026-09-30', bald_ablaufen: true }),
  zeile(34, 'Joghurt', 'weiss', 150, 99, 2, { art: 'zutat', lagerort: 'kuehlschrank', abgelaufen: 2 }),
  zeile(35, 'Brötchen', 'gelb', 80, 25, 6, { art: 'zutat', einheit: 'stueck', portion_menge: 2 }),
];

describe('Snapshot: zwei Ebenen – physischer Bestand und bekannte Bedeutung', () => {
  const s = baueSnapshot(HAUSHALT, 'halbe Zucchini', DATUM);
  const z = (name: string) => s.zutaten.find((x) => x.name === name)!;

  test('Art, Herkunft, Einheit, Portionsgröße und Preisbezug kommen aus den Daten', () => {
    assert.deepEqual(
      [z('TK-Pizza Margherita').art, z('TK-Pizza Margherita').herkunft, z('TK-Pizza Margherita').kosten_menge],
      ['komplettgericht', 'gekauft', 4],
    );
    assert.deepEqual([z('Spaghetti').einheit, z('Spaghetti').anzahl, z('Spaghetti').portion_menge], ['g', 380, 125]);
    assert.deepEqual([z('Brötchen').einheit, z('Brötchen').portion_menge], ['stueck', 2]);
  });

  test('Zusammensetzung: bekannt bleibt bekannt, unbekannt bleibt null', () => {
    assert.deepEqual(z('TK-Pizza Margherita').zusammensetzung, ['Tomatensoße', 'Mozzarella']);
    assert.equal(z('Suppe').zusammensetzung, null);
    assert.equal(z('halbe Zucchini').zusammensetzung, null);
    assert.equal(z('halbe Zucchini').art, null, 'Kühlschrank-Angabe: Art unbekannt');
  });

  test('geöffnet, Rest, Ablauf in Tagen', () => {
    assert.equal(z('Spaghetti').geoeffnet, true);
    assert.equal(z('Spaghetti').rest, false, '380 g sind mehr als zwei Portionen');
    assert.equal(z('Linsen-Bolognese').tage_bis_ablauf, 2);
    assert.equal(z('Linsen-Bolognese').bald_verbrauchen, true);
  });

  test('Abgelaufenes wird nicht eingeplant, aber gemeldet', () => {
    assert.equal(s.zutaten.some((x) => x.name === 'Joghurt'), false);
    assert.deepEqual(s.abgelaufen, [{ name: 'Joghurt', menge: 2, einheit: 'portion' }]);
  });

  test('ohne Baukasten-Migration: Einordnung wie in der Migration, Standardwerte', () => {
    const alt = snapshot(SEED);
    const a = (name: string) => alt.zutaten.find((x) => x.name === name)!;
    assert.equal(a('Pizza').art, 'komplettgericht');
    assert.equal(a('TK-Spinat').art, 'zutat');
    assert.equal(a('Tomatensoße').art, 'komponente');
    assert.deepEqual([a('Tomatensoße').einheit, a('Tomatensoße').portion_menge, a('Tomatensoße').kosten_menge], ['portion', 1, 1]);
    assert.equal(a('Pizza').zusammensetzung, null);
  });

  test('ein kleiner Rest in Gramm wird erkannt', () => {
    const rest = baueSnapshot([zeile(40, 'Reis', 'gelb', 100, 99, 90, { einheit: 'g', portion_menge: 75, lagerort: 'vorrat' })], '', DATUM);
    assert.equal(rest.zutaten[0].rest, true);
  });
});

describe('Komplettgerichte haben eine eigene Rolle', () => {
  const s = baueSnapshot(HAUSHALT, 'halbe Zucchini', DATUM);

  test('pur → „komplett“, mit Beilage → „komplett_plus“, sonst „rezept“', () => {
    const pur = pruefeGericht({ name: 'Pizza-Abend', zutaten: [{ id: 'b30', portionen: 2 }] }, s, OPTIONEN, 'a');
    const plus = pruefeGericht({ name: 'Suppe mit Brötchen', zutaten: [{ id: 'b31', portionen: 2 }, { id: 'b35', portionen: 2 }] }, s, OPTIONEN, 'b');
    const rezept = pruefeGericht({ name: 'Spaghetti Bolognese', zutaten: [{ id: 'b32', portionen: 2 }, { id: 'b33', portionen: 2 }] }, s, OPTIONEN, 'c');
    assert.ok(pur.ok && plus.ok && rezept.ok);
    assert.equal(pur.wert.gerichtsart, 'komplett');
    assert.equal(plus.wert.gerichtsart, 'komplett_plus');
    assert.equal(rezept.wert.gerichtsart, 'rezept');
  });

  test('„Heute kochen“ beim Komplettgericht: genau ein Posten „2 Portionen …“', () => {
    const p = pruefeGericht({ name: 'Pizza-Abend', zutaten: [{ id: 'b30', portionen: 2 }] }, s, OPTIONEN, 'a');
    assert.ok(p.ok);
    const plan = entnahmePlan(p.wert);
    assert.deepEqual(plan, [{ block_typ_id: 30, name: 'TK-Pizza Margherita', menge: 2, einheit: 'portion', art: 'komplettgericht' }]);
    assert.equal(postenText(plan[0]), '2 Portionen TK-Pizza Margherita');
  });

  test('„Heute kochen“ beim Rezept: mehrere Posten in ihren Einheiten', () => {
    const p = pruefeGericht({ name: 'Spaghetti Bolognese', zutaten: [{ id: 'b32', portionen: 2 }, { id: 'b33', portionen: 2 }, { id: 'k1' }, { id: 'g-salz' }] }, s, OPTIONEN, 'c');
    assert.ok(p.ok);
    const plan = entnahmePlan(p.wert);
    assert.deepEqual(plan.map(postenText), ['250 g Spaghetti', '2 Portionen Linsen-Bolognese']);
  });

  test('Stück: 2 Portionen à 2 Brötchen = 4 Stück', () => {
    const p = pruefeGericht({ name: 'Suppe mit Brötchen', zutaten: [{ id: 'b31', portionen: 2 }, { id: 'b35', portionen: 2 }] }, s, OPTIONEN, 'b');
    assert.ok(p.ok);
    assert.equal(p.wert.zutaten.find((z) => z.name === 'Brötchen')?.menge, 4);
  });

  test('der Demo-Anbieter schlägt Komplettgerichte als eigene Option vor', async () => {
    const e = await erzeugeVorschlaege(regelbasiert(), anfrage({ anzahl: 5 }), { id: ids() });
    assert.ok(e.gerichte.some((g) => g.gerichtsart !== 'rezept'), e.gerichte.map((g) => g.name).join(', '));
    assert.ok(e.gerichte.some((g) => g.gerichtsart === 'rezept'));
  });
});

describe('Geöffnetes, Ablaufendes und Reste werden gerettet – und begründet', () => {
  const s = baueSnapshot(HAUSHALT, 'halbe Zucchini', DATUM);
  const p = pruefeGericht({ name: 'Spaghetti Bolognese mit Zucchini', zutaten: [{ id: 'b32', portionen: 2 }, { id: 'b33', portionen: 2 }, { id: 'k1' }] }, s, OPTIONEN, 'c');

  test('rettet: geöffnete Spaghetti, bald ablaufende Bolognese, Kühlschrank-Rest', () => {
    assert.ok(p.ok);
    assert.deepEqual(p.wert.rettet, ['Spaghetti', 'Linsen-Bolognese', 'halbe Zucchini']);
  });

  test('warum jetzt: konkret statt allgemein', () => {
    assert.ok(p.ok);
    assert.deepEqual(p.wert.warum_jetzt, [
      'Spaghetti ist angebrochen – jetzt verbrauchen.',
      'Linsen-Bolognese läuft in 2 Tagen ab.',
      'Verwertet deine Reste: halbe Zucchini.',
      'Du hast alles zuhause.',
    ]);
  });

  test('Kosten: bekannte Preise proportional, Kühlschrank-Rest ehrlich unbekannt', () => {
    assert.ok(p.ok);
    // Spaghetti 250 g × 1,29 €/500 g = 64,5 ct; Bolognese 2 × 0,90 €/3 = 60 ct → 124,5 ct
    assert.equal(p.wert.kosten.gesamt_cent, 125);
    assert.equal(p.wert.kosten.pro_portion_cent, 62);
    assert.equal(p.wert.kosten.status, 'teilweise');
    assert.deepEqual(p.wert.kosten.unbekannt, ['halbe Zucchini']);
  });
});

describe('Validierung vor dem Kochen', () => {
  test('aktueller Bestand: genug, zu wenig, schon verbraucht, Sorte gelöscht', () => {
    const plan = [
      { block_typ_id: 1, name: 'A', menge: 2, einheit: 'portion' as const, art: 'komponente' as const },
      { block_typ_id: 2, name: 'B', menge: 3, einheit: 'portion' as const, art: 'komponente' as const },
      { block_typ_id: 3, name: 'C', menge: 1, einheit: 'portion' as const, art: 'komponente' as const },
      { block_typ_id: 4, name: 'D', menge: 1, einheit: 'portion' as const, art: 'komponente' as const },
    ];
    const status = pruefeEntnahme(plan, [{ id: 1, anzahl: 5 }, { id: 2, anzahl: 1 }, { id: 3, anzahl: 0 }]);
    assert.deepEqual(status.map((x) => [x.status, x.verfuegbar]), [['ok', 5], ['zu_wenig', 1], ['leer', 0], ['unbekannt', 0]]);
  });

  test('ältere gespeicherte Rezepte (mit „bloecke“) lassen sich weiter kochen', () => {
    const alt = {
      zutaten: [
        { id: 'b3', name: 'Linsen gekocht', quelle: 'bestand', farbe: 'braun', bloecke: 2, block_typ_id: 3 },
        { id: 'k1', name: 'Paprika', quelle: 'kuehlschrank', farbe: null, bloecke: null, block_typ_id: null },
      ],
    } as unknown as Gericht;
    assert.deepEqual(entnahmePlan(alt), [{ block_typ_id: 3, name: 'Linsen gekocht', menge: 2, einheit: 'portion', art: null }]);
  });
});

describe('Rezepte strukturiert speichern', () => {
  test('Gerichtstyp, Zutaten mit Mengen, Portionen, Schritte, Bestandsarten, Tags, Kosten, Feedback', () => {
    const s = baueSnapshot(HAUSHALT, '', DATUM);
    const p = pruefeGericht({
      name: 'Spaghetti Bolognese', zutaten: [{ id: 'b32', portionen: 2 }, { id: 'b33', portionen: 2 }, { id: 'g-salz' }],
      fehlt: [{ name: 'Parmesan' }], zeit_min: 15, schritte: ['Spaghetti kochen.', 'Mit Bolognese mischen.'],
      eigenschaften: { gerichtstyp: 'pasta', gewuerzrichtung: 'italienisch' },
    }, s, OPTIONEN, 'x');
    assert.ok(p.ok);
    const r = rezeptDatensatz(p.wert, ['like', 'save', 'like']);
    assert.equal(r.gerichtstyp, 'pasta');
    assert.equal(r.portionen, 2);
    assert.deepEqual(r.zutaten, [
      { name: 'Spaghetti', menge: 250, einheit: 'g', art: 'zutat', sorte_id: 32, fehlt: false },
      { name: 'Linsen-Bolognese', menge: 2, einheit: 'portion', art: 'komponente', sorte_id: 33, fehlt: false },
      { name: 'Parmesan', menge: null, einheit: null, art: null, sorte_id: null, fehlt: true },
    ]);
    assert.deepEqual(r.schritte, ['Spaghetti kochen.', 'Mit Bolognese mischen.']);
    assert.deepEqual(r.bestandsarten.sort(), ['komponente', 'zutat']);
    assert.deepEqual(r.tags, ['schnell', 'rettet lebensmittel', 'italienisch']);
    assert.equal(r.kosten_pro_portion_cent, 62);
    assert.equal(r.kosten_status, 'berechnet');
    assert.deepEqual(r.feedback, ['like', 'save']);
    assert.equal(r.daten, p.wert, 'vollständiger Vorschlag bleibt erhalten');
  });
});
