// Kalorien und Nährwerte: nur aus hinterlegten Daten, unbekannt bleibt unbekannt. Produktion skalieren.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kcalText, naehrwertAus, naehrwerteFuerGericht, summiereNaehrwerte, type Naehrwert,
} from '../../supabase/functions/_shared/kombi/naehrwerte.ts';
import { pruefeGericht } from '../../supabase/functions/_shared/kombi/validierung.ts';
import { pruefeAnfrage } from '../../supabase/functions/_shared/kombi/anfrage.ts';
import { bereiteProduktionVor, pruefeKomponente, skaliereMenge } from '../../supabase/functions/_shared/kombi/komponenten.ts';
import type { VorratSorte } from '../../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { OPTIONEN, SEED, snapshot, zeile } from './fixtures.ts';

const nw = (kcal: number | null, menge = 100, rest: Partial<Naehrwert> = {}): Naehrwert =>
  ({ kcal, protein_g: null, kohlenhydrate_g: null, fett_g: null, menge, ...rest });

describe('Kalorien berechnen', () => {
  test('100 g A (150 kcal) + 200 g B (150 kcal/100 g) = 450 kcal, 2 Portionen → 225 kcal / Portion', () => {
    const n = summiereNaehrwerte([
      { name: 'A', menge: 100, naehrwert: nw(150) },
      { name: 'B', menge: 200, naehrwert: nw(150) },
    ], 2);
    assert.equal(n.status, 'berechnet');
    assert.equal(n.kcal_gesamt, 450);
    assert.equal(n.kcal_portion, 225);
    assert.equal(kcalText(n), '225 kcal / Portion');
  });

  test('pro Portion (Bezug „1 Portion“) und Makros nur, wenn für alle Zutaten bekannt', () => {
    const voll = summiereNaehrwerte([
      { name: 'Tomaten-Basis', menge: 2, naehrwert: nw(120, 1, { protein_g: 3, kohlenhydrate_g: 15, fett_g: 4 }) },
      { name: 'Pasta', menge: 250, naehrwert: nw(359, 100, { protein_g: 12, kohlenhydrate_g: 71, fett_g: 1.5 }) },
    ], 2);
    assert.equal(voll.kcal_gesamt, 1138); // 240 + 897,5
    assert.equal(voll.kcal_portion, 569);
    assert.equal(voll.protein_g, 18); // (6 + 30) / 2
    const ohneFett = summiereNaehrwerte([
      { name: 'Tomaten-Basis', menge: 2, naehrwert: nw(120, 1, { protein_g: 3 }) },
      { name: 'Pasta', menge: 250, naehrwert: nw(359, 100, { protein_g: 12, fett_g: 1.5 }) },
    ], 2);
    assert.equal(ohneFett.fett_g, null, 'kein Fettwert erfunden');
    assert.equal(ohneFett.protein_g, 18);
  });

  test('unbekannt bleibt unbekannt: teilweise = nur die bekannte Summe, nie eine Schätzung', () => {
    const teil = summiereNaehrwerte([
      { name: 'Reis', menge: 150, naehrwert: nw(350) },
      { name: 'Pizza', menge: 2, naehrwert: null },
    ], 2);
    assert.equal(teil.status, 'teilweise');
    assert.equal(teil.kcal_gesamt, 525);
    assert.deepEqual(teil.unbekannt, ['Pizza']);
    assert.equal(kcalText(teil), 'ab 263 kcal / Portion');
    const nichts = summiereNaehrwerte([{ name: 'Pizza', menge: 2, naehrwert: null }], 2);
    assert.equal(nichts.status, 'unbekannt');
    assert.equal(nichts.kcal_gesamt, null, 'unbekannt ist nicht 0');
    assert.equal(kcalText(nichts), 'kcal unbekannt');
  });

  test('0 kcal ist ein echter Wert; Wasser, Salz, Pfeffer zählen nicht, Öl ohne Menge ist unbekannt', () => {
    const null_kcal = summiereNaehrwerte([{ name: 'Kräutertee', menge: 1, naehrwert: nw(0, 1) }], 1);
    assert.equal(null_kcal.status, 'berechnet');
    assert.equal(null_kcal.kcal_portion, 0);
    const grund = summiereNaehrwerte([
      { name: 'Reis', menge: 100, naehrwert: nw(350) },
      { name: 'Salz', menge: null, naehrwert: null },
      { name: 'Wasser', menge: null, naehrwert: null },
      { name: 'Öl', menge: null, naehrwert: null },
    ], 1);
    assert.equal(grund.status, 'teilweise');
    assert.deepEqual(grund.unbekannt, ['Öl']);
  });

  test('Datenbankwerte: Zahlen als Text, NULL bleibt NULL, Bezug 100 g bzw. 1 Portion', () => {
    assert.deepEqual(naehrwertAus({ kcal: '359.0', protein_g: '12.5', naehrwert_menge: null }, 'g'),
      { kcal: 359, protein_g: 12.5, kohlenhydrate_g: null, fett_g: null, menge: 100 });
    assert.equal(naehrwertAus({ kcal: 120 }, 'portion')!.menge, 1);
    assert.equal(naehrwertAus({ kcal: null, protein_g: 5 }, 'g'), null, 'ohne kcal kein Nährwert');
  });
});

describe('Kalorien im Gericht', () => {
  const mitNaehrwerten = SEED.map((z) =>
    z.id === 3 ? { ...z, kcal: 116, protein_g: 9, kohlenhydrate_g: 20, fett_g: 0.4, naehrwert_menge: 1 }
    : z.id === 9 ? { ...z, kcal: 180, protein_g: 5, kohlenhydrate_g: 30, fett_g: 4, naehrwert_menge: 1 } : z);

  test('berechnet aus hinterlegten Werten und tatsächlichen Mengen; Angaben der KI werden ignoriert', () => {
    const p = pruefeGericht({
      name: 'Linsen-Wrap', zutaten: [{ id: 'b3', portionen: 2 }, { id: 'b9', portionen: 2 }],
      ...({ kcal: 999, naehrwerte: { kcal_portion: 1 } } as object),
    }, snapshot(mitNaehrwerten), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.equal(p.wert.naehrwerte.status, 'berechnet');
    assert.equal(p.wert.naehrwerte.kcal_gesamt, 592); // 2 × 116 + 2 × 180
    assert.equal(p.wert.naehrwerte.kcal_portion, 296);
    assert.equal(p.wert.naehrwerte.protein_g, 14);
  });

  test('fehlende Zutat oder Sorte ohne Daten → „teilweise“ mit Namen', () => {
    const p = pruefeGericht({
      name: 'Linsen-Wrap', zutaten: [{ id: 'b3', portionen: 2 }, { id: 'b9', portionen: 2 }, { id: 'b7', portionen: 1 }],
      fehlt: [{ name: 'Avocado', menge: 1, einheit: 'stueck' }],
    }, snapshot(mitNaehrwerten), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.equal(p.wert.naehrwerte.status, 'teilweise');
    assert.deepEqual(p.wert.naehrwerte.unbekannt.sort(), ['Avocado', 'TK-Spinat']);
    assert.equal(p.wert.naehrwerte.protein_g, null);
  });

  test('ohne hinterlegte Nährwerte: „kcal unbekannt“ statt einer Zahl', () => {
    const p = pruefeGericht({ name: 'Pizza-Abend', zutaten: [{ id: 'b13', portionen: 2 }] }, snapshot(), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.equal(p.wert.naehrwerte.status, 'unbekannt');
    assert.equal(kcalText(p.wert.naehrwerte), 'kcal unbekannt');
  });

  test('ältere gespeicherte Gerichte: aus dem aktuellen Vorrat neu berechnet', () => {
    const n = naehrwerteFuerGericht({
      zutaten: [{ name: 'Wrap', quelle: 'bestand', menge: 2, block_typ_id: 9 }, { name: 'Salz', quelle: 'grundausstattung', menge: null, block_typ_id: null }],
      fehlt: [], portionen: 2,
    }, (id) => (id === 9 ? nw(180, 1) : null));
    assert.equal(kcalText(n), '180 kcal / Portion');
  });

  test('Anfrage an die Edge Function: Nährwerte kommen an, Unsinn wird verworfen', () => {
    const snap = snapshot(mitNaehrwerten);
    const a = pruefeAnfrage({ snapshot: snap, optionen: OPTIONEN, gesehen: [], feedback: [], modus: { art: 'normal' }, anzahl: 3 });
    assert.deepEqual(a.snapshot.zutaten.find((z) => z.block_typ_id === 3)!.naehrwert,
      { kcal: 116, protein_g: 9, kohlenhydrate_g: 20, fett_g: 0.4, menge: 1 });
    const kaputt = structuredClone(snap);
    kaputt.zutaten[0].naehrwert = { kcal: -5, protein_g: null, kohlenhydrate_g: null, fett_g: null, menge: 1 };
    const b = pruefeAnfrage({ snapshot: kaputt, optionen: OPTIONEN, gesehen: [], feedback: [], modus: { art: 'normal' }, anzahl: 3 });
    assert.equal(b.snapshot.zutaten[0].naehrwert, null);
  });
});

describe('Produktion: Menge wählen, skalieren, gegen den Vorrat prüfen', () => {
  const sorte = (id: number, name: string, anzahl: number, teil: Partial<VorratSorte> = {}): VorratSorte => ({
    id, name, farbe: 'gruen', art: 'zutat', einheit: 'g', portion_menge: 100, groesse_g: 100, anzahl, abgelaufen: 0,
    kosten_cent: null, kosten_menge: 1, mindestbestand: 0, lagerort: 'vorrat', ...teil,
  });
  const komponente = {
    portionen: 6,
    zutaten: [
      { name: 'Gehackte Tomaten', block_typ_id: 20, menge: 500, einheit: 'g' as const, quelle: 'bestand' as const, kosten_cent: null, dringend: false },
      { name: 'Gehackte Tomaten', block_typ_id: 20, menge: 300, einheit: 'g' as const, quelle: 'einkauf' as const, kosten_cent: null, dringend: false },
      { name: 'Zwiebeln', block_typ_id: null, menge: 150, einheit: 'g' as const, quelle: 'einkauf' as const, kosten_cent: null, dringend: false },
      { name: 'Öl', block_typ_id: null, menge: null, einheit: null, quelle: 'grundausstattung' as const, kosten_cent: null, dringend: false },
    ],
  };

  test('Mengen skalieren: g gerundet, Portionen/Stück aufgerundet', () => {
    assert.equal(skaliereMenge(800, 'g', 6, 8), 1067);
    assert.equal(skaliereMenge(1, 'stueck', 6, 8), 2);
    assert.equal(skaliereMenge(3, 'portion', 6, 3), 2);
  });

  test('8 statt 6 Portionen: benötigt 1067 g, 500 g da → entnommen werden 500 g, 567 g fehlen', () => {
    const p = bereiteProduktionVor(komponente, 8, [sorte(20, 'Gehackte Tomaten', 500)], 99);
    const tom = p.zeilen.find((z) => z.name === 'Gehackte Tomaten')!;
    assert.deepEqual([tom.benoetigt, tom.vorhanden, tom.fehlt, tom.status], [1067, 500, 567, 'teilweise']);
    assert.deepEqual(p.posten, [{ block_typ_id: 20, name: 'Gehackte Tomaten', menge: 500, einheit: 'g', art: 'zutat' }]);
    assert.deepEqual(p.nicht_erfasst, ['Zwiebeln'], 'nicht geführte Zutat: wird nicht gebucht, Kosten unbekannt');
    assert.deepEqual(p.fehlt.map((f) => [f.name, f.menge]), [['Gehackte Tomaten', 567], ['Zwiebeln', 200]]);
    assert.equal(p.zeilen.find((z) => z.name === 'Öl')!.status, 'immer_da');
  });

  test('alles da → nichts fehlt; das Produkt selbst wird nie als Zutat entnommen', () => {
    const p = bereiteProduktionVor(komponente, 6, [sorte(20, 'Gehackte Tomaten', 2000), sorte(21, 'Zwiebeln', 1000)], 21);
    assert.deepEqual(p.posten.map((x) => [x.name, x.menge]), [['Gehackte Tomaten', 800]]);
    assert.deepEqual(p.nicht_erfasst, ['Zwiebeln'], 'Zwiebeln sind hier das Ziel und werden nicht entnommen');
    const q = bereiteProduktionVor(komponente, 6, [sorte(20, 'Gehackte Tomaten', 2000), sorte(21, 'Zwiebeln', 1000)], 99);
    assert.deepEqual(q.posten.map((x) => [x.name, x.menge]), [['Gehackte Tomaten', 800], ['Zwiebeln', 150]]);
    assert.deepEqual(q.fehlt, []);
  });

  test('Komponenten-Idee: kcal je Portion der Komponente, fehlende Zutaten ohne Daten → teilweise', () => {
    const snap = snapshot([...SEED.map((z) => (z.id === 3 ? { ...z, kcal: 116, naehrwert_menge: 1 } : z))]);
    const k = pruefeKomponente({
      name: 'Linsen-Basis', rolle: 'braun', portionen: 3, lagerort: 'gefrierfach',
      zutaten: [{ id: 'b3', portionen: 3 }, { name: 'Zwiebeln', menge: 100, einheit: 'g' }],
    }, snap, 'k1');
    assert.ok(k);
    assert.equal(k.naehrwerte.status, 'teilweise');
    assert.equal(k.naehrwerte.kcal_portion, 116);
    assert.deepEqual(k.naehrwerte.unbekannt, ['Zwiebeln']);
  });
});

describe('Seed ohne Nährwerte', () => {
  test('frische Daten ohne Angaben: nirgends eine Kalorienzahl', () => {
    const snap = snapshot([zeile(1, 'Tomatensoße', 'rot', 100, 17, 6)]);
    assert.equal(snap.zutaten[0].naehrwert, null);
  });
});

describe('Komponenten-Nährwerte aus der tatsächlichen Produktion', () => {
  const tomaten = { kcal: 18, protein_g: 0.9, kohlenhydrate_g: 3.9, fett_g: 0.2, menge: 100 };
  const zwiebeln = { kcal: 40, protein_g: 1.1, kohlenhydrate_g: 9.3, fett_g: 0.1, menge: 100 };
  test('800 g Tomaten + 150 g Zwiebeln → 6 Portionen Tomaten-Basis: 204 kcal für 6 Portionen (34 / Portion)', async () => {
    const { naehrwerteAusProduktion } = await import('../../supabase/functions/_shared/kombi/naehrwerte.ts');
    const n = naehrwerteAusProduktion([{ name: 'Tomaten', menge: 800, naehrwert: tomaten }, { name: 'Zwiebeln', menge: 150, naehrwert: zwiebeln }], ['Salz', 'Pfeffer'], 6)!;
    assert.deepEqual([n.kcal, n.naehrwert_menge], [204, 6]);
    assert.equal(n.protein_g, 8.9);
  });
  test('unbekannt bleibt unbekannt: Öl ohne Menge, nicht erfasste Zutat oder fehlende Nährwerte → nichts gelernt', async () => {
    const { naehrwerteAusProduktion } = await import('../../supabase/functions/_shared/kombi/naehrwerte.ts');
    const posten = [{ name: 'Tomaten', menge: 800, naehrwert: tomaten }];
    assert.equal(naehrwerteAusProduktion(posten, ['Öl'], 6), null, 'Öl hat Kalorien, Menge unbekannt');
    assert.equal(naehrwerteAusProduktion(posten, ['Knoblauch'], 6), null, 'nicht im Vorrat erfasst');
    assert.equal(naehrwerteAusProduktion([...posten, { name: 'Soße', menge: 200, naehrwert: null }], [], 6), null);
    assert.equal(naehrwerteAusProduktion([], [], 6), null);
    assert.ok(naehrwerteAusProduktion(posten, ['Wasser', 'Salz'], 6), 'Wasser und Salz haben 0 kcal');
  });
});
