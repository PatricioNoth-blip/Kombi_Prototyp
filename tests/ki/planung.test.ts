// Wochenplanung ohne Doppelreservierung, Resteverwertung, Auftauen, Batch-Cooking.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { erzeugeVorschlaege, erzeugeWoche } from '../../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { auftragAlsText } from '../../supabase/functions/_shared/kombi/anbieter/prompt.ts';
import { berechneLeitplanken } from '../../supabase/functions/_shared/kombi/praeferenz.ts';
import { pruefeGericht } from '../../supabase/functions/_shared/kombi/validierung.ts';
import {
  auftauVorschlaege, bedarfAusGericht, heuteAuftauen, reservierungVon, restSnapshot, type AuftauEintrag,
} from '../../supabase/functions/_shared/kombi/planung.ts';
import { verteile, type VorratSorte } from '../../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { batchEmpfehlungen, oftVerwendet, type BatchSorte } from '../../supabase/functions/_shared/kombi/batch.ts';
import { anfrage, festerAnbieter, ids, OPTIONEN, SEED, snapshot, zeile } from './fixtures.ts';

describe('Geplante Mahlzeiten', () => {
  test('Bedarf eines Gerichts: Vorrat mit voller Menge + Fehlendes mit Menge', () => {
    const p = pruefeGericht({
      name: 'Linsen-Wrap', zutaten: [{ id: 'b3', portionen: 2 }, { id: 'b9', portionen: 6 }, { id: 'g-salz' }],
      fehlt: [{ name: 'Avocado', menge: 2, einheit: 'stueck' }, { name: 'Koriander' }],
    }, snapshot(), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.deepEqual(bedarfAusGericht(p.wert), [
      { name: 'Linsen gekocht', block_typ_id: 3, menge: 2, einheit: 'portion' },
      { name: 'Wrap', block_typ_id: 9, menge: 6, einheit: 'portion' }, // 4 da + 2 zu wenig = voller Bedarf
      { name: 'Avocado', block_typ_id: null, menge: 2, einheit: 'stueck' },
      { name: 'Koriander', block_typ_id: null, menge: null, einheit: null },
    ]);
  });

  test('Woche planen: keine Portion wird doppelt verplant', async () => {
    const e = await erzeugeWoche(regelbasiert(), anfrage({ anzahl: 5, aufgabe: 'woche' }), { id: ids() });
    assert.equal(e.gerichte.length, 5);
    const summe = new Map<number, number>();
    for (const g of e.gerichte) for (const [id, m] of reservierungVon(g)) summe.set(id, (summe.get(id) ?? 0) + m);
    for (const [id, m] of summe) {
      const vorrat = SEED.find((s) => s.id === id)!.anzahl;
      assert.ok(m <= vorrat, `Sorte ${id}: ${m} verplant, ${vorrat} da`);
    }
    assert.equal(new Set(e.gerichte.map((g) => g.name)).size, 5, 'fünf verschiedene Gerichte');
  });

  test('Woche planen berücksichtigt bestehende Reservierungen (Rest-Snapshot)', async () => {
    const wenig = SEED.filter((s) => ['Linsen gekocht', 'Tomatensoße', 'Wrap', 'Brötchen', 'TK-Gemüsemix'].includes(s.name));
    const snap = snapshot(wenig);
    // Linsen und Wraps sind komplett für andere Mahlzeiten reserviert
    const rest = restSnapshot(snap, new Map([[3, 6], [9, 4]]));
    assert.equal(rest.zutaten.some((z) => z.name === 'Linsen gekocht' || z.name === 'Wrap'), false);
    const e = await erzeugeWoche(regelbasiert(), anfrage({ snapshot: rest, anzahl: 3, aufgabe: 'woche' }), { id: ids() });
    assert.ok(e.gerichte.every((g) => g.zutaten.every((z) => z.name !== 'Linsen gekocht' && z.name !== 'Wrap')));
  });

  test('zu wenig Vorrat für die gewünschte Anzahl → ehrlicher Hinweis statt Wiederholungen', async () => {
    const snap = snapshot(SEED.filter((s) => ['Linsen gekocht', 'Tomatensoße', 'Brötchen'].includes(s.name)).map((s) => ({ ...s, anzahl: 2 })));
    const e = await erzeugeWoche(regelbasiert(), anfrage({ snapshot: snap, anzahl: 7, aufgabe: 'woche' }), { id: ids() });
    assert.ok(e.gerichte.length < 7);
    assert.match(e.hinweis ?? '', /passen \d+ unterschiedliche Mahlzeiten/);
  });
});

describe('Resteverwertung', () => {
  test('nichts Dringendes → ehrlich sagen, KI wird gar nicht gefragt', async () => {
    const ki = festerAnbieter({ vorschlaege: [] });
    const e = await erzeugeVorschlaege(ki, anfrage({ modus: { art: 'reste' } }), { id: ids() });
    assert.equal(ki.auftraege.length, 0);
    assert.deepEqual(e.gerichte, []);
    assert.match(e.hinweis ?? '', /nichts dringend weg/);
  });

  test('nur Gerichte, die etwas retten – und die Reste stehen vorne', async () => {
    const bald = snapshot(SEED.map((s) => (s.name === 'TK-Spinat' ? { ...s, bald_ablaufen: true } : s)));
    const e = await erzeugeVorschlaege(regelbasiert(), anfrage({ snapshot: bald, modus: { art: 'reste' } }), { id: ids() });
    assert.ok(e.gerichte.length > 0);
    assert.ok(e.gerichte.every((g) => g.rettet.length > 0), 'jedes Gericht rettet etwas');
    assert.ok(e.gerichte.some((g) => g.rettet.includes('TK-Spinat')));
  });

  test('kein sinnvoller Vorschlag → Hinweis, nichts erzwungen', async () => {
    const bald = snapshot(SEED.map((s) => (s.name === 'TK-Spinat' ? { ...s, bald_ablaufen: true } : s)));
    const ki = festerAnbieter({ vorschlaege: [{ name: 'Linsen-Wrap', zutaten: [{ id: 'b3', portionen: 1 }, { id: 'b9', portionen: 2 }] }] });
    const e = await erzeugeVorschlaege(ki, anfrage({ snapshot: bald, modus: { art: 'reste' } }), { id: ids() });
    assert.deepEqual(e.gerichte, []);
    assert.equal(e.verworfen[0].grund, 'verwertet keine Reste');
    assert.match(e.hinweis ?? '', /kein sinnvolles Gericht/);
  });

  test('Prompt: Resteverwertung ohne Zwang', () => {
    const a = { ...anfrage({ modus: { art: 'reste' } }), leitplanken: berechneLeitplanken([], { art: 'normal' }), notfall: false };
    assert.match(auftragAlsText(a), /Nicht jedes Lebensmittel muss hinein – nichts zwanghaft kombinieren/);
  });

  test('aufgetaute Portionen gelten als dringend', () => {
    const s = snapshot(SEED.map((x) => (x.name === 'Lasagne-Portion' ? { ...x, aufgetaut: 2 } : x)));
    const p = pruefeGericht({ name: 'Lasagne-Abend', zutaten: [{ id: 'b15', portionen: 2 }] }, s, OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.deepEqual(p.wert.rettet, ['Lasagne-Portion']);
    assert.equal(p.wert.warum_jetzt[0], 'Lasagne-Portion ist aufgetaut – heute verbrauchen.');
  });
});

describe('Auftauen', () => {
  const vorrat = (): VorratSorte[] => [
    { id: 15, name: 'Lasagne-Portion', farbe: 'blau', art: 'komplettgericht', einheit: 'portion', portion_menge: 1, groesse_g: 350, anzahl: 6, abgelaufen: 0, kosten_cent: 85, kosten_menge: 1, mindestbestand: 2, lagerort: 'gefrierfach' },
    { id: 30, name: 'Reis', farbe: 'gelb', art: 'zutat', einheit: 'g', portion_menge: 75, groesse_g: 75, anzahl: 500, abgelaufen: 0, kosten_cent: null, kosten_menge: 1, mindestbestand: 0, lagerort: 'vorrat' },
  ];
  const plan = (id: string, datum: string) => ({
    id, art: 'mahlzeit' as const, titel: 'Lasagne-Abend', datum, erstellt_am: '2026-09-27T10:00:00Z',
    bedarf: [{ name: 'Lasagne-Portion', block_typ_id: 15, menge: 2, einheit: 'portion' as const }, { name: 'Reis', block_typ_id: 30, menge: 150, einheit: 'g' as const }],
  });

  test('für morgen geplant → heute 2 Portionen Lasagne zum Auftauen vorschlagen (nur Gefrierfach)', () => {
    const v = auftauVorschlaege([plan('p1', '2026-09-29')], vorrat(), [], '2026-09-28');
    assert.deepEqual(v.map((x) => [x.name, x.menge, x.auftauen_am]), [['Lasagne-Portion', 2, '2026-09-28']]);
  });

  test('schon vorgemerkt oder erst nächste Woche → kein Vorschlag', () => {
    const vorgemerkt: AuftauEintrag[] = [{ id: 1, block_typ_id: 15, menge: 2, auftauen_am: '2026-09-28', plan_id: 'p1', status: 'geplant' }];
    assert.deepEqual(auftauVorschlaege([plan('p1', '2026-09-29')], vorrat(), vorgemerkt, '2026-09-28'), []);
    assert.deepEqual(auftauVorschlaege([plan('p2', '2026-10-05')], vorrat(), [], '2026-09-28'), []);
  });

  test('„Für heute auftauen“: fällige Vormerkungen, nicht schon aufgetaute', () => {
    const a: AuftauEintrag[] = [
      { id: 1, block_typ_id: 15, menge: 2, auftauen_am: '2026-09-28', plan_id: null, status: 'geplant' },
      { id: 2, block_typ_id: 15, menge: 1, auftauen_am: '2026-09-30', plan_id: null, status: 'geplant' },
      { id: 3, block_typ_id: 15, menge: 1, auftauen_am: '2026-09-27', plan_id: null, status: 'aufgetaut' },
    ];
    assert.deepEqual(heuteAuftauen(a, '2026-09-28').map((x) => x.id), [1]);
  });

  test('Auftauen reserviert nicht doppelt: zwei Pläne teilen sich 3 Portionen', () => {
    const drei = vorrat().map((s) => (s.id === 15 ? { ...s, anzahl: 3 } : s));
    const v = verteile([plan('p1', '2026-09-29'), plan('p2', '2026-09-29')], drei);
    assert.equal(v.reserviert.get(15), 3);
  });
});

describe('Batch-Cooking – nur aus echter Nutzung', () => {
  const sorten: BatchSorte[] = [
    { id: 1, name: 'Tomaten-Basis', art: 'komponente', herkunft: 'selbstgemacht', einheit: 'portion', haltbar_tage: 90, lagerort: 'gefrierfach' },
    { id: 2, name: 'Pasta', art: 'zutat', herkunft: 'gekauft', einheit: 'g', haltbar_tage: 365, lagerort: 'vorrat' },
    { id: 3, name: 'Linsen gekocht', art: 'komponente', herkunft: null, einheit: 'portion', haltbar_tage: 90, lagerort: 'gefrierfach' },
  ];
  const n = (id: number, verbrauch: number, herst: number, mittel: number) =>
    ({ block_typ_id: id, verbrauch_28: verbrauch, verbrauchstage_28: 5, herstellungen_56: herst, mittlere_menge: mittel, letzte_herstellung: '2026-09-20' });

  test('oft gekocht, schnell verbraucht → größere Charge empfehlen (mit Begründung aus Daten)', () => {
    const e = batchEmpfehlungen(sorten, [n(1, 12, 3, 3)]);
    assert.equal(e.length, 1);
    assert.deepEqual([e[0].name, e[0].bisher, e[0].neu], ['Tomaten-Basis', 3, 6]);
    assert.match(e[0].gruende.join(' '), /3× hergestellt.*12 Portionen verbraucht/);
  });

  test('zu wenig Daten, Zutaten und Gekauftes → keine Empfehlung', () => {
    assert.deepEqual(batchEmpfehlungen(sorten, [n(1, 3, 1, 3), n(2, 2000, 5, 500)]), []);
    assert.deepEqual(batchEmpfehlungen(sorten, []), []);
  });

  test('nicht mehr, als innerhalb der Haltbarkeit verbraucht wird', () => {
    const kurz = sorten.map((s) => (s.id === 1 ? { ...s, haltbar_tage: 7 } : s));
    // 12 in 4 Wochen = 3/Woche → in 7 Tagen nur 3 → keine größere Charge als 3 sinnvoll
    assert.deepEqual(batchEmpfehlungen(kurz, [n(1, 12, 3, 3)]), []);
  });

  test('„wurde oft verwendet“ nur mit echter Nutzung', () => {
    assert.deepEqual(oftVerwendet(sorten, [n(1, 12, 3, 3), n(3, 2, 1, 6)]).map((x) => x.name), ['Tomaten-Basis']);
  });
});

describe('Rest-Snapshot', () => {
  test('reservierte Mengen verschwinden aus den Vorschlägen', () => {
    const s = restSnapshot(snapshot(SEED), new Map([[13, 4], [3, 2]]));
    assert.equal(s.zutaten.some((z) => z.name === 'Pizza'), false, 'alle 4 Pizzen verplant');
    assert.equal(s.zutaten.find((z) => z.name === 'Linsen gekocht')?.anzahl, 4);
  });

  test('eine zusätzliche Sorte mit Menge taucht im Rest auf', () => {
    const s = restSnapshot(snapshot([zeile(40, 'Reis', 'gelb', 75, 149, 500, { einheit: 'g', portion_menge: 75 })]), new Map([[40, 150]]));
    assert.equal(s.zutaten.find((z) => z.name === 'Reis')?.anzahl, 350);
  });
});
