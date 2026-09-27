// Oberfläche ohne Browser: Navigation (Zustand beim Wechsel), Vorrat-Übersicht, Eingaben.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ladeNav, navigiere, speichereNav, START, type NavZustand } from '../../src/navigation.ts';
import { freieTage, fuellstand, heuteWichtig, ortKacheln, sortenFuer, tagName, vorratswert, zustand } from '../../src/dashboard.ts';
import type { Sorte } from '../../src/api.ts';
import { leseEingabe } from '../../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { reserviertAusser } from '../../supabase/functions/_shared/kombi/planung.ts';

const HEUTE = '2026-09-27';

function sorte(id: number, name: string, teil: Partial<Sorte> = {}): Sorte {
  return {
    id, name, farbe: 'rot', anzahl: 4, mindestbestand: 0, nachkochen: false, aelteste: null, bald_ablaufen: false,
    haltbar_tage: 90, groesse_g: 150, kosten_cent: null, lagerort: 'gefrierfach', art: 'komponente', einheit: 'portion',
    portion_menge: 1, kosten_menge: 1, abgelaufen: 0, geoeffnet: 0, ...teil,
  };
}

describe('UI-Zustand beim Wechsel zwischen Essen, Vorrat, Komponenten und Einkauf', () => {
  test('geöffneter Lagerort und Filter bleiben erhalten, Scrollposition wird je Bereich gemerkt', () => {
    let z: NavZustand = START;
    z = navigiere(z, { typ: 'vorrat', teil: { ort: 'gefrierfach' } });
    z = navigiere(z, { typ: 'vorrat', teil: { art: 'komponente' } });
    z = navigiere(z, { typ: 'wechsle', bereich: 'essen', scroll: 420 });
    assert.equal(z.bereich, 'essen');
    z = navigiere(z, { typ: 'essen', teil: { ansicht: 'woche' } });
    z = navigiere(z, { typ: 'wechsle', bereich: 'komponenten', scroll: 90 });
    z = navigiere(z, { typ: 'wechsle', bereich: 'vorrat', scroll: 0 });
    assert.equal(z.vorrat.ort, 'gefrierfach');
    assert.equal(z.vorrat.art, 'komponente');
    assert.equal(z.scroll.vorrat, 420, 'Vorrat kommt an der alten Stelle zurück');
    assert.equal(z.scroll.essen, 90);
    assert.equal(z.essen.ansicht, 'woche', 'Woche bleibt offen');
  });

  test('nochmal auf den aktiven Reiter → zurück zur Übersicht und nach oben', () => {
    let z = navigiere(START, { typ: 'vorrat', teil: { ort: 'kuehlschrank', suche: 'jog' } });
    z = navigiere(z, { typ: 'wechsle', bereich: 'vorrat', scroll: 300 });
    assert.equal(z.vorrat.ort, null);
    assert.equal(z.vorrat.suche, '');
    assert.equal(z.scroll.vorrat, 0);
  });

  test('neuer Lagerort setzt den Art-Filter zurück', () => {
    let z = navigiere(START, { typ: 'vorrat', teil: { ort: 'gefrierfach', art: 'zutat' } });
    z = navigiere(z, { typ: 'vorrat', teil: { ort: 'vorrat' } });
    assert.equal(z.vorrat.art, null);
  });

  test('gemerkt wird ohne Suche; alte gespeicherte Werte und Unsinn sind kein Problem', () => {
    let z = navigiere(START, { typ: 'vorrat', teil: { ort: 'alle', suche: 'pizza' } });
    z = navigiere(z, { typ: 'einkauf', teil: { filter: 'geplant', sortierung: 'name' } });
    const wieder = ladeNav(speichereNav(z));
    assert.equal(wieder.vorrat.ort, 'alle');
    assert.equal(wieder.vorrat.suche, '');
    assert.deepEqual(wieder.einkauf, { filter: 'geplant', sortierung: 'name' });
    assert.equal(ladeNav('bestand').bereich, 'vorrat');
    assert.equal(ladeNav('sorten').bereich, 'vorrat');
    assert.equal(ladeNav('essen').bereich, 'essen');
    assert.deepEqual(ladeNav('{kaputt'), START);
    assert.deepEqual(ladeNav(null), START);
    const unsinn = ladeNav(JSON.stringify({ bereich: 'admin', vorrat: { ort: 'keller', art: 'x' }, einkauf: { filter: 1 } }));
    assert.equal(unsinn.bereich, 'vorrat');
    assert.equal(unsinn.vorrat.ort, null);
    assert.equal(unsinn.einkauf.filter, 'alle');
  });
});

describe('Vorrat als Übersicht', () => {
  test('„Heute wichtig“: jede Sorte einmal, dringendster Zustand zuerst', () => {
    const bestand = [
      sorte(1, 'Joghurt', { abgelaufen: 1, geoeffnet: 1, lagerort: 'kuehlschrank', art: 'zutat' }),
      sorte(2, 'Lasagne', { aufgetaut: 2, farbe: 'blau', art: 'komplettgericht' }),
      sorte(3, 'Spaghetti', { geoeffnet: 1, lagerort: 'vorrat', art: 'zutat', einheit: 'g', anzahl: 380 }),
      sorte(4, 'Linsen-Bolognese', { bald_ablaufen: true, naechster_ablauf: '2026-09-29' }),
      sorte(5, 'Tomatensoße', { nachkochen: true, anzahl: 1, mindestbestand: 3 }),
      sorte(6, 'Reis', { anzahl: 0, nachkochen: true, mindestbestand: 1, art: 'zutat' }),
      sorte(7, 'Pizza', {}),
    ];
    const w = heuteWichtig(bestand, HEUTE);
    assert.deepEqual(w.map((x) => [x.sorte.name, x.art]), [
      ['Joghurt', 'abgelaufen'], ['Lasagne', 'aufgetaut'], ['Spaghetti', 'geoeffnet'], ['Linsen-Bolognese', 'bald'],
      ['Reis', 'niedrig'], ['Tomatensoße', 'niedrig'],
    ]);
    assert.equal(w[3].text, 'noch 2 Tage');
    assert.equal(zustand(bestand[5], HEUTE)!.text, 'leer · nachkaufen');
    assert.equal(zustand(bestand[4], HEUTE)!.text, 'nur 1 Portion · nachkochen');
    assert.equal(zustand(bestand[6], HEUTE), null);
  });

  test('Lagerort-Kacheln: Gefrierfach in Portionen, sonst Artikel; Farbanteile summieren sich zu 1', () => {
    const bestand = [
      sorte(1, 'Pizza', { farbe: 'blau', anzahl: 4 }),
      sorte(2, 'Linsen', { farbe: 'braun', anzahl: 6 }),
      sorte(3, 'Erbsen', { farbe: 'gruen', einheit: 'g', portion_menge: 150, anzahl: 750 }),
      sorte(4, 'Wrap', { anzahl: 0 }),
      sorte(5, 'Joghurt', { lagerort: 'kuehlschrank', anzahl: 2, bald_ablaufen: true }),
      sorte(6, 'Spaghetti', { lagerort: 'vorrat', einheit: 'g', anzahl: 380 }),
      sorte(7, 'Reis', { lagerort: 'vorrat', anzahl: 0 }),
    ];
    const [gf, ks, vr] = ortKacheln(bestand, HEUTE);
    assert.deepEqual([gf.zahl, gf.einheit, gf.sorten, gf.leer], [15, 'Portionen', 4, 1]); // 4 + 6 + 5
    assert.deepEqual([ks.zahl, ks.einheit, ks.achtung], [1, 'Artikel', 1]);
    assert.deepEqual([vr.zahl, vr.leer], [1, 1]);
    assert.ok(Math.abs(gf.farben.reduce((a, f) => a + f.anteil, 0) - 1) < 1e-9);
    assert.deepEqual(gf.farben.map((f) => f.farbe), ['braun', 'gruen', 'blau']);
  });

  test('Füllstand „6 / 8 Portionen“ aus der Startmenge; ohne Bezug kein erfundener Balken', () => {
    assert.deepEqual(fuellstand(sorte(1, 'A', { anzahl: 6, start_menge: 8 })), { anteil: 0.75, text: '6 / 8 Portionen' });
    assert.equal(fuellstand(sorte(2, 'B', { einheit: 'g', anzahl: 375, start_menge: 500 }))!.text, '375 / 500 g');
    assert.equal(fuellstand(sorte(3, 'C', { anzahl: 1, mindestbestand: 2 }))!.anteil, 0.25);
    assert.equal(fuellstand(sorte(4, 'D', { anzahl: 3 })), null);
  });

  test('Vorratswert nur aus bekannten Preisen; Abgelaufenes zählt nicht', () => {
    const w = vorratswert([
      sorte(1, 'Pizza', { anzahl: 4, kosten_cent: 200, kosten_menge: 4 }),
      sorte(2, 'Spaghetti', { einheit: 'g', anzahl: 250, kosten_cent: 129, kosten_menge: 500 }),
      sorte(3, 'Joghurt', { anzahl: 2, abgelaufen: 2, kosten_cent: 45 }),
      sorte(4, 'Linsen', { anzahl: 3 }),
    ]);
    assert.deepEqual(w, { cent: 265, ohne_preis: 1 }); // 200 + 64,5 → 265
  });

  test('Lagerort-Ansicht: Filter nach Art und Suche (auch in der Zusammensetzung), Vorhandenes zuerst', () => {
    const bestand = [
      sorte(1, 'Burrito', { farbe: 'blau', art: 'komplettgericht', zusammensetzung: ['Tortilla', 'Kidneybohnen'] }),
      sorte(2, 'Bohnen', { art: 'zutat', anzahl: 0 }),
      sorte(3, 'Äpfel', { art: 'zutat', lagerort: 'kuehlschrank' }),
      sorte(4, 'Chili', { art: 'komponente', bald_ablaufen: true }),
    ];
    assert.deepEqual(sortenFuer(bestand, { ort: 'gefrierfach', art: null, suche: '' }, HEUTE).map((s) => s.name), ['Chili', 'Burrito', 'Bohnen']);
    assert.deepEqual(sortenFuer(bestand, { ort: 'alle', art: null, suche: 'bohne' }, HEUTE).map((s) => s.name), ['Burrito', 'Bohnen']);
    assert.deepEqual(sortenFuer(bestand, { ort: 'alle', art: 'zutat', suche: 'apfel' }, HEUTE).map((s) => s.name), ['Äpfel']);
  });
});

describe('Eingaben und Reservierungen für die Oberfläche', () => {
  test('Tage: „Heute“, „Morgen“, Wochentag; Woche planen überspringt belegte Tage', () => {
    assert.equal(tagName(HEUTE, '2026-09-27'), 'Heute');
    assert.equal(tagName(HEUTE, '2026-09-28'), 'Morgen');
    assert.equal(tagName(HEUTE, '2026-09-30'), 'Mi 30.09.');
    assert.equal(tagName(HEUTE, '2026-10-02'), 'Fr 02.10.');
    assert.deepEqual(freieTage(HEUTE, ['2026-09-28', null, '2026-09-30'], 3), ['2026-09-27', '2026-09-29', '2026-10-01']);
  });

  test('Einkauf von Hand: „500 g Zwiebeln“, „1,5 kg“, „2 Paprika“, „Basilikum“', () => {
    assert.deepEqual(leseEingabe('500 g Zwiebeln'), { name: 'Zwiebeln', menge: 500, einheit: 'g' });
    assert.deepEqual(leseEingabe('1,5 kg Kartoffeln'), { name: 'Kartoffeln', menge: 1500, einheit: 'g' });
    assert.deepEqual(leseEingabe('0.5 l Milch'), { name: 'Milch', menge: 500, einheit: 'ml' });
    assert.deepEqual(leseEingabe('2 Paprika'), { name: 'Paprika', menge: 2, einheit: 'stueck' });
    assert.deepEqual(leseEingabe('3 Portionen Tomatensoße'), { name: 'Tomatensoße', menge: 3, einheit: 'portion' });
    assert.deepEqual(leseEingabe('  Basilikum '), { name: 'Basilikum', menge: null, einheit: null });
  });

  test('Kochansicht: nur was ANDERE Pläne reserviert haben, mit ihren Namen', () => {
    const proPlan = new Map([
      ['a', [{ block_typ_id: 1, reserviert: 2 }, { block_typ_id: null, reserviert: 0 }]],
      ['b', [{ block_typ_id: 1, reserviert: 1 }, { block_typ_id: 2, reserviert: 0 }]],
    ]);
    const plaene = [{ id: 'a', titel: 'Lasagne' }, { id: 'b', titel: 'Wraps' }];
    assert.deepEqual([...reserviertAusser(proPlan, plaene, null)], [[1, { menge: 3, plaene: ['Lasagne', 'Wraps'] }]]);
    assert.deepEqual([...reserviertAusser(proPlan, plaene, 'a')], [[1, { menge: 1, plaene: ['Wraps'] }]]);
  });
});
