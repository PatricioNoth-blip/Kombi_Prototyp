// Einkaufsliste: Zusammenführen, Vorrat einmal anrechnen, Reservierungen, Packungspreise, Einkauf → Vorrat.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  berechneEinkaufsliste, mangelVorschlaege, packungspreis, produktSchluessel, verteile,
  type ListenEintrag, type PlanBedarf, type VorratSorte,
} from '../../supabase/functions/_shared/kombi/einkaufsliste.ts';

const sorte = (id: number, name: string, teil: Partial<VorratSorte> = {}): VorratSorte => ({
  id, name, farbe: 'gruen', art: 'zutat', einheit: 'g', portion_menge: 100, groesse_g: 100, anzahl: 0, abgelaufen: 0,
  kosten_cent: null, kosten_menge: 1, mindestbestand: 0, lagerort: 'vorrat', ...teil,
});
const plan = (id: string, titel: string, bedarf: PlanBedarf['bedarf'], teil: Partial<PlanBedarf> = {}): PlanBedarf => ({
  id, art: 'mahlzeit', titel, datum: null, erstellt_am: `2026-09-28T10:0${id.length}:00Z`, bedarf, ...teil,
});
const zwiebeln = (menge: number) => ({ name: 'Zwiebeln', block_typ_id: null, menge, einheit: 'g' as const });

describe('Zusammenführen und Vorrat verrechnen', () => {
  test('150 g + 200 g + 300 g Zwiebeln, 200 g im Vorrat → EINE Zeile „450 g“', () => {
    const sorten = [sorte(1, 'Zwiebeln', { anzahl: 200 })];
    const plaene = [
      plan('a', 'Gericht A', [zwiebeln(150)]),
      plan('b', 'Gericht B', [zwiebeln(200)]),
      plan('k', 'Tomaten-Basis', [zwiebeln(300)], { art: 'komponente' }),
    ];
    const l = berechneEinkaufsliste({ sorten, plaene, eintraege: [], status: [] });
    assert.equal(l.zeilen.length, 1);
    const z = l.zeilen[0];
    assert.deepEqual([z.name, z.menge, z.einheit, z.bedarf_plaene, z.vom_vorrat], ['Zwiebeln', 450, 'g', 650, 200]);
    assert.deepEqual(z.quellen.map((q) => [q.art, q.titel]), [['mahlzeit', 'Gericht B'], ['komponente', 'Tomaten-Basis']]);
  });

  test('Produktnamen werden erkannt: Zwiebel/Zwiebeln, „(Dose)“, TK-', () => {
    assert.equal(produktSchluessel('Zwiebeln'), produktSchluessel('Zwiebel'));
    assert.equal(produktSchluessel('Kichererbsen (Dose)'), produktSchluessel('Kichererbsen'));
    assert.equal(produktSchluessel('TK-Spinat'), produktSchluessel('Spinat'));
    assert.equal(produktSchluessel('Wraps'), produktSchluessel('Wrap'));
    assert.notEqual(produktSchluessel('Rote Linsen'), produktSchluessel('Linsen gekocht'));
    assert.equal(produktSchluessel('Reis'), 'reis');
  });

  test('abgelaufene Mengen zählen nicht, geöffnete schon', () => {
    const sorten = [sorte(1, 'Joghurt', { anzahl: 500, abgelaufen: 300, einheit: 'g' })];
    const l = berechneEinkaufsliste({ sorten, plaene: [plan('a', 'Bowl', [{ name: 'Joghurt', block_typ_id: 1, menge: 400, einheit: 'g' }])], eintraege: [], status: [] });
    assert.equal(l.zeilen[0].menge, 200, '500 − 300 abgelaufen = 200 verwendbar → 200 fehlen');
  });

  test('Einheiten werden umgerechnet: 2 Portionen à 125 g = 250 g', () => {
    const sorten = [sorte(1, 'Spaghetti', { anzahl: 100, portion_menge: 125, farbe: 'gelb' })];
    const l = berechneEinkaufsliste({ sorten, plaene: [plan('a', 'Pasta', [{ name: 'Spaghetti', block_typ_id: 1, menge: 2, einheit: 'portion' }])], eintraege: [], status: [] });
    assert.deepEqual([l.zeilen[0].menge, l.zeilen[0].einheit, l.zeilen[0].kategorie], [150, 'g', 'gelb']);
  });

  test('Menge unbekannt: gedeckt, wenn etwas da ist – sonst „Menge offen“', () => {
    const sorten = [sorte(1, 'Käse', { anzahl: 200 })];
    const l = berechneEinkaufsliste({
      sorten,
      plaene: [plan('a', 'Toast', [{ name: 'Käse', block_typ_id: null, menge: null, einheit: null }, { name: 'Basilikum', block_typ_id: null, menge: null, einheit: null }])],
      eintraege: [], status: [],
    });
    assert.deepEqual(l.zeilen.map((z) => [z.name, z.menge, z.menge_offen]), [['Basilikum', null, true]]);
    assert.equal(l.kosten.status, 'unbekannt');
  });
});

describe('Reservierungen', () => {
  test('eine Portion wird nie doppelt reserviert – der spätere Plan bekommt nur den Rest', () => {
    const sorten = [sorte(1, 'Lasagne-Portion', { anzahl: 3, einheit: 'portion', portion_menge: 1, art: 'komplettgericht', farbe: 'blau' })];
    const lasagne = (n: number) => ({ name: 'Lasagne-Portion', block_typ_id: 1, menge: n, einheit: 'portion' as const });
    const plaene = [plan('b', 'Freitag', [lasagne(2)], { datum: '2026-10-02' }), plan('a', 'Mittwoch', [lasagne(2)], { datum: '2026-09-30' })];
    const v = verteile(plaene, sorten);
    assert.equal(v.reserviert.get(1), 3, 'nie mehr als vorhanden');
    assert.equal(v.frei.get(1), 0);
    assert.deepEqual(v.pro_plan.get('a')?.map((s) => [s.reserviert, s.fehlt]), [[2, 0]], 'früheres Datum zuerst');
    assert.deepEqual(v.pro_plan.get('b')?.map((s) => [s.reserviert, s.fehlt]), [[1, 1]]);
  });

  test('geplante Mahlzeit entfernen → Reservierung und Einkaufsbedarf werden neu berechnet', () => {
    const sorten = [sorte(1, 'Zwiebeln', { anzahl: 200 })];
    const a = plan('a', 'A', [zwiebeln(150)]);
    const b = plan('b', 'B', [zwiebeln(200)]);
    const mitBeiden = berechneEinkaufsliste({ sorten, plaene: [a, b], eintraege: [], status: [] });
    assert.equal(mitBeiden.zeilen[0].menge, 150);
    const ohneB = berechneEinkaufsliste({ sorten, plaene: [a], eintraege: [], status: [] });
    assert.deepEqual(ohneB.zeilen, [], 'nichts mehr zu kaufen');
    assert.equal(ohneB.verteilung.reserviert.get(1), 150);
    assert.equal(ohneB.verteilung.frei.get(1), 50);
  });
});

describe('Eigene Einträge, Zustand, Einkauf → Vorrat', () => {
  const eintrag = (id: number, name: string, menge: number | null, teil: Partial<ListenEintrag> = {}): ListenEintrag => ({
    id, name, schluessel: produktSchluessel(name), menge, einheit: menge === null ? null : 'g', kategorie: 'sonstiges',
    quelle: 'manuell', grund: null, block_typ_id: null, ...teil,
  });

  test('eigene Einträge werden NICHT gegen den Vorrat gerechnet und mit Plan-Bedarf zusammengeführt', () => {
    const sorten = [sorte(1, 'Zwiebeln', { anzahl: 200 })];
    const l = berechneEinkaufsliste({ sorten, plaene: [plan('a', 'A', [zwiebeln(300)])], eintraege: [eintrag(7, 'Zwiebel', 500)], status: [] });
    assert.equal(l.zeilen.length, 1);
    assert.equal(l.zeilen[0].menge, 100 + 500);
    assert.deepEqual(l.zeilen[0].eintrag_ids, [7]);
    assert.deepEqual(l.zeilen[0].quellen.map((q) => q.art), ['mahlzeit', 'manuell']);
  });

  test('Zustand je Zeile: abgehakt bzw. zurückgestellt', () => {
    const l = berechneEinkaufsliste({
      sorten: [], plaene: [], eintraege: [eintrag(1, 'Tofu', 400), eintrag(2, 'Kreuzkümmel', null, { kategorie: 'weiss' })],
      status: [{ schluessel: 'tofu', einheit: 'g', status: 'gekauft' }, { schluessel: 'kreuzkuemmel', einheit: 'offen', status: 'zurueckgestellt' }],
    });
    assert.deepEqual(l.zeilen.map((z) => [z.name, z.status]), [['Tofu', 'gekauft'], ['Kreuzkümmel', 'zurueckgestellt']]);
  });

  test('nur 300 statt 450 g gekauft und eingebucht → es fehlen weiter 150 g', () => {
    const plaene = [plan('a', 'A', [zwiebeln(650)])];
    const vorher = berechneEinkaufsliste({ sorten: [sorte(1, 'Zwiebeln', { anzahl: 200 })], plaene, eintraege: [], status: [] });
    assert.equal(vorher.zeilen[0].menge, 450);
    // einkauf_buchen() hat 300 g eingebucht → Vorrat jetzt 500 g
    const nachher = berechneEinkaufsliste({ sorten: [sorte(1, 'Zwiebeln', { anzahl: 500 })], plaene, eintraege: [], status: [] });
    assert.equal(nachher.zeilen[0].menge, 150);
  });
});

describe('Einkaufskosten – nur aus echten Preisen, in ganzen Packungen', () => {
  test('450 g Zwiebeln bei „0,99 € für 1 kg“ → eine Packung 0,99 € (kein Fantasiepreis für 450 g)', () => {
    const s = sorte(1, 'Zwiebeln', { kosten_cent: 99, kosten_menge: 1000 });
    assert.deepEqual(packungspreis(450, s), { packungen: 1, cent: 99, text: '1 × 1 kg' });
    assert.deepEqual(packungspreis(1200, s), { packungen: 2, cent: 198, text: '2 × 1 kg' });
    assert.equal(packungspreis(450, sorte(2, 'Paprika')), null, 'Preis unbekannt');
  });

  test('teilweise bekannt: bekannte Summe + Anzahl unbekannter Positionen', () => {
    const sorten = [sorte(1, 'Zwiebeln', { kosten_cent: 99, kosten_menge: 1000 }), sorte(2, 'Pasta', { kosten_cent: 129, kosten_menge: 500, farbe: 'gelb' })];
    const l = berechneEinkaufsliste({
      sorten,
      plaene: [plan('a', 'A', [zwiebeln(450), { name: 'Pasta', block_typ_id: 2, menge: 750, einheit: 'g' }, { name: 'Paprika', block_typ_id: null, menge: 2, einheit: 'stueck' }])],
      eintraege: [], status: [],
    });
    assert.deepEqual(l.kosten, { bekannt_cent: 99 + 2 * 129, unbekannt: 1, status: 'teilweise' });
  });

  test('zurückgestellte Zeilen zählen nicht zur Summe', () => {
    const sorten = [sorte(1, 'Zwiebeln', { kosten_cent: 99, kosten_menge: 1000 })];
    const l = berechneEinkaufsliste({ sorten, plaene: [plan('a', 'A', [zwiebeln(450)])], eintraege: [], status: [{ schluessel: 'zwiebel', einheit: 'g', status: 'zurueckgestellt' }] });
    assert.equal(l.kosten.status, 'leer');
  });
});

describe('Vorratsmangel', () => {
  test('unter Mindestbestand: Zutat → kaufen, Komponente → nachkochen; schon auf der Liste → kein Vorschlag', () => {
    const sorten = [
      sorte(1, 'Reis', { anzahl: 100, mindestbestand: 500, farbe: 'gelb' }),
      sorte(2, 'Tomatensoße', { anzahl: 1, mindestbestand: 4, art: 'komponente', einheit: 'portion', farbe: 'rot' }),
      sorte(3, 'Zwiebeln', { anzahl: 0, mindestbestand: 200 }),
    ];
    const l = berechneEinkaufsliste({ sorten, plaene: [plan('a', 'A', [zwiebeln(300)])], eintraege: [], status: [] });
    assert.deepEqual(mangelVorschlaege(sorten, l.zeilen).map((m) => [m.sorte.name, m.menge, m.aktion]), [
      ['Reis', 400, 'kaufen'], ['Tomatensoße', 3, 'nachkochen'],
    ]);
  });
});
