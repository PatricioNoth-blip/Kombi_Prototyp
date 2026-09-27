// Produktion: Chargen-Reihenfolge, FIFO-Kostenvorschau, Bestandsprüfung, Kostenkette, Empfehlungen.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bestandsWert, entnahmeReihenfolge, kostenAusTeilen, simuliereEntnahme, type ChargeInfo,
} from '../../supabase/functions/_shared/kombi/chargen.ts';
import {
  empfehlungenNachEinkauf, fehlendeAufEinkaufsliste, kostenHerkunft, letztesRezept, produktionsEmpfehlungen, pruefeProduktion,
  skaliere, type ProduktionEintrag, type ProduktSorte,
} from '../../supabase/functions/_shared/kombi/produktion.ts';

const sorte = (id: number, name: string, einheit: ProduktSorte['einheit'], anzahl: number, extra: Partial<ProduktSorte> = {}): ProduktSorte => ({
  id, name, einheit, anzahl, art: 'zutat', portion_menge: 1, abgelaufen: 0, haltbar_tage: 90, mindestbestand: 0,
  bald_ablaufen: false, geoeffnet: 0, zusammensetzung: null, farbe: 'gruen', ...extra,
});

let naechsteId = 1;
const charge = (block_typ_id: number, menge: number, kosten: [number, number] | null, extra: Partial<ChargeInfo> = {}): ChargeInfo => ({
  id: naechsteId++, block_typ_id, menge_aktuell: menge, eingefroren_am: '2026-09-27', ablauf_am: null, geoeffnet_am: null,
  kosten_cent: kosten ? kosten[0] : null, kosten_menge: kosten ? kosten[1] : null, kosten_status: kosten ? 'berechnet' : 'unbekannt',
  kosten_quelle: kosten ? 'bon' : null, quelle: 'bon', lagerort: null, ...extra,
});

// Bestand nach dem Einkauf (wie im Datenbank-Test)
const TOMATEN = 1, ZWIEBELN = 2, KNOBLAUCH = 3, MEHL = 4, KAESE = 5, LINSEN = 6, BASIS = 10, PIZZA = 11, SUPPE = 12;
const SORTEN: ProduktSorte[] = [
  sorte(TOMATEN, 'Tomaten', 'g', 1500),
  sorte(ZWIEBELN, 'Zwiebeln', 'g', 1000),
  sorte(KNOBLAUCH, 'Knoblauch', 'g', 100),
  sorte(MEHL, 'Mehl', 'g', 1000, { farbe: 'gelb' }),
  sorte(KAESE, 'Käse', 'g', 500, { farbe: 'schwarz' }),
  sorte(LINSEN, 'Linsen', 'g', 500, { farbe: 'braun' }),
  sorte(BASIS, 'Tomaten-Basis', 'portion', 0, { art: 'komponente', mindestbestand: 4, farbe: 'rot', zusammensetzung: ['Tomaten', 'Zwiebeln', 'Knoblauch'] }),
  sorte(PIZZA, 'TK-Pizza', 'portion', 0, { art: 'komplettgericht', farbe: 'blau' }),
  sorte(SUPPE, 'Linsensuppe', 'portion', 0, { art: 'komplettgericht', farbe: 'blau', zusammensetzung: ['Linsen', 'Tomaten', 'Sellerie'] }),
];
const CHARGEN: ChargeInfo[] = [
  charge(TOMATEN, 1000, [149, 1000], { eingefroren_am: '2026-09-26' }),   // neu: 1,49 €/kg
  charge(TOMATEN, 500, [60, 500], { eingefroren_am: '2026-09-17' }),      // alt: 1,20 €/kg
  charge(ZWIEBELN, 1000, [99, 1000]),
  charge(KNOBLAUCH, 100, [59, 100]),
  charge(MEHL, 1000, [79, 1000], { kosten_quelle: 'sortenpreis' }),
  charge(KAESE, 500, null),
  charge(LINSEN, 500, [129, 500]),
];
const BASIS_REZEPT = [{ block_typ_id: TOMATEN, menge: 700 }, { block_typ_id: ZWIEBELN, menge: 150 }, { block_typ_id: KNOBLAUCH, menge: 20 }];
const nah = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 0.001, `${a} ≈ ${b}`);

describe('Chargen: Reihenfolge und Kosten wie in der Datenbank', () => {
  test('geöffnet → frühester Ablauf → älteste → zuerst angelegt', () => {
    const c = [
      charge(1, 1, null, { id: 101, eingefroren_am: '2026-09-01' }),
      charge(1, 1, null, { id: 102, eingefroren_am: '2026-09-10', ablauf_am: '2026-09-20' }),
      charge(1, 1, null, { id: 103, eingefroren_am: '2026-09-15', geoeffnet_am: '2026-09-25' }),
      charge(1, 1, null, { id: 104, eingefroren_am: '2026-09-01' }),
    ];
    assert.deepEqual(entnahmeReihenfolge(c, 90).map((x) => x.id), [103, 102, 101, 104]);
  });

  test('FIFO: 700 g aus [500 g alt à 0,12 ct, 1000 g neu à 0,149 ct] = 0,898 €', () => {
    const sim = simuliereEntnahme(CHARGEN.filter((c) => c.block_typ_id === TOMATEN), 90, 700);
    assert.deepEqual(sim.teile.map((t) => t.menge), [500, 200]);
    nah(kostenAusTeilen(sim.teile).cent, 89.8);
    assert.equal(sim.fehlt, 0);
  });

  test('Kostenstatus: berechnet / teilweise / unbekannt', () => {
    assert.equal(kostenAusTeilen([{ wert_cent: 10, kosten_status: 'berechnet' }]).status, 'berechnet');
    assert.equal(kostenAusTeilen([{ wert_cent: 10, kosten_status: 'berechnet' }, { wert_cent: null, kosten_status: 'unbekannt' }]).status, 'teilweise');
    assert.equal(kostenAusTeilen([{ wert_cent: 10, kosten_status: 'teilweise' }]).status, 'teilweise');
    assert.deepEqual(kostenAusTeilen([]), { cent: null, status: 'unbekannt' });
  });

  test('Bestandswert einer Sorte aus ihren Chargen', () => {
    nah(bestandsWert(CHARGEN.filter((c) => c.block_typ_id === TOMATEN)).cent, 209);
  });
});

describe('Komponente produzieren', () => {
  test('Tomaten-Basis: alle Zutaten da, Kosten aus den Chargen, die entnommen würden', () => {
    const p = pruefeProduktion(BASIS_REZEPT, 6, SORTEN, CHARGEN);
    assert.equal(p.alles_da, true);
    assert.equal(p.kosten.status, 'berechnet');
    nah(p.kosten.cent, 116.45); // 89,8 + 14,85 + 11,8
    nah(p.kosten.pro_einheit_cent, 116.45 / 6);
    assert.deepEqual(p.kosten.herkunft.map((h) => h.name), ['Tomaten', 'Zwiebeln', 'Knoblauch']);
  });

  for (const [name, rezept, menge, erwartet] of [
    ['Falafel-Masse', [{ block_typ_id: LINSEN, menge: 250 }, { block_typ_id: ZWIEBELN, menge: 100 }, { block_typ_id: KNOBLAUCH, menge: 10 }], 8, 64.5 + 9.9 + 5.9],
    ['Ofengemüse', [{ block_typ_id: TOMATEN, menge: 400 }, { block_typ_id: ZWIEBELN, menge: 300 }], 4, 48 + 29.7],
  ] as const) {
    test(`${name}: Kosten aus Chargen (FIFO), pro Portion`, () => {
      const p = pruefeProduktion([...rezept], menge, SORTEN, CHARGEN);
      assert.equal(p.alles_da, true);
      nah(p.kosten.cent, erwartet);
      nah(p.kosten.pro_einheit_cent, erwartet / menge);
    });
  }

  test('zu wenig im Bestand → fehlt, direkt als Einträge für die Einkaufsliste', () => {
    const p = pruefeProduktion([{ block_typ_id: KNOBLAUCH, menge: 250 }, { block_typ_id: TOMATEN, menge: 100 }], 6, SORTEN, CHARGEN);
    assert.equal(p.alles_da, false);
    assert.deepEqual(p.fehlend, [{ block_typ_id: KNOBLAUCH, name: 'Knoblauch', menge: 150, einheit: 'g' }]);
    assert.equal(p.kosten.status, 'teilweise', 'fehlender Teil hat keinen Preis');
    const e = fehlendeAufEinkaufsliste(p, 'Tomaten-Basis', SORTEN);
    assert.deepEqual(e, [{ name: 'Knoblauch', schluessel: 'knoblauch', menge: 150, einheit: 'g', kategorie: 'gruen', quelle: 'komponente', grund: 'Für Tomaten-Basis', block_typ_id: KNOBLAUCH }]);
  });

  test('Abgelaufenes wird nicht eingeplant', () => {
    const sorten = SORTEN.map((s) => (s.id === KNOBLAUCH ? { ...s, abgelaufen: 100 } : s));
    const p = pruefeProduktion([{ block_typ_id: KNOBLAUCH, menge: 20 }], 1, sorten, CHARGEN);
    assert.equal(p.eingaenge[0].status, 'leer');
  });
});

describe('Komplettgericht produzieren – Kostenkette ohne Doppelzählung', () => {
  // Nach der Basis-Produktion: 6 Portionen Tomaten-Basis für 116,45 ct
  const nachBasis = {
    sorten: SORTEN.map((s) => (s.id === BASIS ? { ...s, anzahl: 6 } : s.id === TOMATEN ? { ...s, anzahl: 800 } : s)),
    chargen: [...CHARGEN, charge(BASIS, 6, [116.45, 6], { kosten_quelle: 'produktion', quelle: 'produktion' })],
  };

  test('TK-Pizza aus Tomaten-Basis: nur der Wert der entnommenen Basis zählt, keine Tomaten', () => {
    const p = pruefeProduktion([{ block_typ_id: BASIS, menge: 2 }, { block_typ_id: MEHL, menge: 300 }, { block_typ_id: KAESE, menge: 200 }], 4, nachBasis.sorten, nachBasis.chargen);
    assert.equal(p.alles_da, true);
    assert.equal(p.kosten.status, 'teilweise', 'Käse ohne Preis');
    nah(p.kosten.cent, (116.45 * 2) / 6 + 23.7);
    assert.ok(!p.eingaenge.some((e) => e.block_typ_id === TOMATEN), 'Tomaten tauchen nicht noch einmal auf');
  });

  for (const [name, rezept, menge] of [
    ['Lasagne', [{ block_typ_id: BASIS, menge: 3 }, { block_typ_id: MEHL, menge: 250 }, { block_typ_id: KAESE, menge: 150 }], 6],
    ['Chili', [{ block_typ_id: BASIS, menge: 2 }, { block_typ_id: LINSEN, menge: 300 }, { block_typ_id: ZWIEBELN, menge: 100 }], 6],
  ] as const) {
    test(`${name}: Bestand geprüft, Kosten nur aus den verwendeten Chargen`, () => {
      const p = pruefeProduktion([...rezept], menge, nachBasis.sorten, nachBasis.chargen);
      assert.equal(p.alles_da, true);
      const erwartet = p.eingaenge.reduce((s, e) => s + (e.wert_cent ?? 0), 0);
      nah(p.kosten.cent, erwartet);
      assert.ok(p.eingaenge.some((e) => e.block_typ_id === BASIS));
    });
  }

  test('Suppe: tatsächlich 7 statt 8 Portionen → Kosten pro Portion aus der tatsächlichen Menge', () => {
    const rezept = [{ block_typ_id: LINSEN, menge: 500 }, { block_typ_id: TOMATEN, menge: 100 }];
    const geplant = pruefeProduktion(rezept, 8, SORTEN, CHARGEN);
    const tatsaechlich = pruefeProduktion(rezept, 7, SORTEN, CHARGEN);
    nah(geplant.kosten.cent, 129 + 12); // FIFO: 100 g aus der alten Tomaten-Charge (0,12 ct/g)
    nah(tatsaechlich.kosten.pro_einheit_cent, 141 / 7);
  });

  test('Kostenherkunft einer abgeschlossenen Produktion (aus produktion_eingang)', () => {
    const h = kostenHerkunft(
      [
        { block_typ_id: BASIS, menge: 2, wert_cent: '38.8167', kosten_status: 'berechnet' },
        { block_typ_id: MEHL, menge: 300, wert_cent: 23.7, kosten_status: 'berechnet' },
        { block_typ_id: KAESE, menge: 200, wert_cent: null, kosten_status: 'unbekannt' },
      ],
      4,
      SORTEN,
    );
    assert.deepEqual(h.posten.map((p) => [p.name, p.status]), [['Tomaten-Basis', 'berechnet'], ['Mehl', 'berechnet'], ['Käse', 'unbekannt']]);
    assert.equal(h.gesamt.status, 'teilweise');
    nah(h.pro_einheit_cent, 62.5167 / 4);
  });
});

describe('Rezept und Menge', () => {
  test('skalieren: 4 → 8 Portionen (g runden, Stück/Portionen aufrunden)', () => {
    assert.deepEqual(skaliere([{ block_typ_id: MEHL, menge: 250 }, { block_typ_id: BASIS, menge: 1 }], 4, 6, SORTEN), [
      { block_typ_id: MEHL, menge: 375 }, { block_typ_id: BASIS, menge: 2 },
    ]);
  });

  test('„wie beim letzten Mal“: jüngste abgeschlossene Produktion', () => {
    const p: ProduktionEintrag[] = [
      { id: 'a', block_typ_id: BASIS, status: 'abgeschlossen', zutaten: [{ block_typ_id: TOMATEN, menge: 500 }], geplante_menge: 4, menge: 4, geplant_fuer: null, abgeschlossen_am: '2026-09-01T10:00:00Z', erstellt_am: '2026-09-01' },
      { id: 'b', block_typ_id: BASIS, status: 'abgeschlossen', zutaten: BASIS_REZEPT, geplante_menge: 6, menge: 6, geplant_fuer: null, abgeschlossen_am: '2026-09-20T10:00:00Z', erstellt_am: '2026-09-20' },
      { id: 'c', block_typ_id: BASIS, status: 'rueckgaengig', zutaten: [{ block_typ_id: TOMATEN, menge: 1 }], geplante_menge: 1, menge: 1, geplant_fuer: null, abgeschlossen_am: '2026-09-25T10:00:00Z', erstellt_am: '2026-09-25' },
    ];
    assert.deepEqual(letztesRezept(BASIS, p), { eingaenge: BASIS_REZEPT, menge: 6 });
    assert.equal(letztesRezept(PIZZA, p), null);
  });
});

describe('Jetzt sinnvoll – Empfehlungen nur aus echten Daten', () => {
  const produktionen: ProduktionEintrag[] = [
    { id: 'basis-1', block_typ_id: BASIS, status: 'abgeschlossen', zutaten: BASIS_REZEPT, geplante_menge: 6, menge: 6, geplant_fuer: null, abgeschlossen_am: '2026-09-20T10:00:00Z', erstellt_am: '2026-09-20' },
    { id: 'pizza-plan', block_typ_id: PIZZA, status: 'geplant', zutaten: [{ block_typ_id: BASIS, menge: 2 }, { block_typ_id: MEHL, menge: 300 }], geplante_menge: 4, menge: null, geplant_fuer: '2026-09-28', abgeschlossen_am: null, erstellt_am: '2026-09-27' },
  ];

  test('geplant, wie beim letzten Mal, Zusammensetzung – mit ehrlichem Status', () => {
    const e = produktionsEmpfehlungen({ sorten: SORTEN, chargen: CHARGEN, produktionen });
    const basis = e.find((x) => x.block_typ_id === BASIS)!;
    assert.equal(basis.quelle, 'letzte_produktion');
    assert.equal(basis.status, 'alles_da');
    assert.ok(basis.gruende.some((g) => /Mindestbestand/.test(g)));
    const pizza = e.find((x) => x.block_typ_id === PIZZA)!;
    assert.equal(pizza.quelle, 'geplant');
    assert.equal(pizza.status, 'fehlt_etwas', 'Tomaten-Basis ist noch nicht produziert');
    const suppe = e.find((x) => x.block_typ_id === SUPPE)!;
    assert.equal(suppe.status, 'mengen_offen');
    assert.deepEqual(suppe.bestandteile.map((b) => [b.name, b.vorhanden]), [['Linsen', true], ['Tomaten', true], ['Sellerie', false]]);
    assert.ok(e.every((x) => x.art === 'komponente' || x.art === 'komplettgericht'), 'Zutaten werden nicht produziert');
  });

  test('nach dem Einkauf: nur Empfehlungen mit frisch Gekauftem, diese zuerst', () => {
    const e = empfehlungenNachEinkauf({ sorten: SORTEN, chargen: CHARGEN, produktionen, neuGekauft: [TOMATEN, ZWIEBELN] });
    assert.equal(e[0].block_typ_id, BASIS);
    assert.ok(e[0].gruende.some((g) => /frisch gekaufte Tomaten, Zwiebeln/.test(g)));
    assert.ok(!e.some((x) => x.block_typ_id === PIZZA), 'Pizza nutzt nichts frisch Gekauftes');
    assert.deepEqual(empfehlungenNachEinkauf({ sorten: SORTEN, chargen: CHARGEN, produktionen, neuGekauft: [] }), []);
  });

  test('ohne Rezept und ohne Zusammensetzung: keine erfundene Empfehlung', () => {
    const e = produktionsEmpfehlungen({ sorten: SORTEN.map((s) => ({ ...s, zusammensetzung: null })), chargen: CHARGEN, produktionen: [] });
    assert.deepEqual(e, []);
  });
});
