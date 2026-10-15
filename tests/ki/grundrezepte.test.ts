// Grundbausteine und Grundrezepte des Food-Baukastens: Erkennen im Vorrat, Mengen, „fehlt“,
// zusätzlich genannte Zutaten, korrektes Abbuchen, Reihenfolge – und nichts Erfundenes.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { baueSnapshot, type BestandZeile } from '../../supabase/functions/_shared/kombi/snapshot.ts';
import { bausteineFuerName, GRUNDBAUSTEINE, KATEGORIE_INFO } from '../../supabase/functions/_shared/kombi/grundbausteine.ts';
import {
  GRUNDREZEPTE, grundrezeptAnbieter, grundrezepteFuer, kochbareGrundrezepte, ordneGrundrezepte,
} from '../../supabase/functions/_shared/kombi/grundrezepte.ts';
import { entnahmePlan } from '../../supabase/functions/_shared/kombi/aktionen.ts';
import { erzeugeWoche } from '../../supabase/functions/_shared/kombi/engine.ts';
import { erwaehnteZutaten } from '../../supabase/functions/_shared/kombi/wahrheit.ts';
import { normalisiere } from '../../supabase/functions/_shared/kombi/text.ts';
import { anfrage, ids, OPTIONEN, SEED } from './fixtures.ts';

const DATUM = '2026-10-15';
let naechste = 100;
const sorte = (name: string, farbe: BestandZeile['farbe'], einheit: 'g' | 'ml' | 'stueck' | 'portion', anzahl: number, extra: Partial<BestandZeile> = {}): BestandZeile => ({
  id: naechste++, name, farbe, anzahl, einheit, portion_menge: einheit === 'g' ? 100 : 1, groesse_g: 100,
  bald_ablaufen: false, lagerort: 'vorrat', art: 'zutat', ...extra,
});

/** Der Grundvorrat aus dem Food-Baukasten (Vorratsschrank, Gefrierschrank, vorbereitete Basen). */
const GRUNDVORRAT = (): BestandZeile[] => [
  sorte('Nudeln', 'gelb', 'g', 1000), sorte('Reis', 'gelb', 'g', 1000), sorte('Lasagneplatten', 'gelb', 'g', 500),
  sorte('Haferflocken', 'gelb', 'g', 500), sorte('Mehl', 'gelb', 'g', 1000), sorte('Kartoffeln', 'gelb', 'g', 2000),
  sorte('Rote Linsen, trocken', 'gelb', 'g', 500), sorte('Braune Linsen, trocken', 'gelb', 'g', 500),
  sorte('Kichererbsen, trocken', 'gelb', 'g', 500), sorte('Kidneybohnen, trocken', 'gelb', 'g', 500), sorte('Sojagranulat', 'braun', 'g', 200),
  sorte('Passierte Tomaten', 'rot', 'stueck', 3), sorte('Gehackte Tomaten', 'rot', 'stueck', 3), sorte('Tomatenmark', 'rot', 'stueck', 1),
  sorte('Mais', 'gruen', 'stueck', 2), sorte('Kokosmilch', 'rot', 'stueck', 2),
  sorte('Brot', 'gelb', 'stueck', 10, { lagerort: 'gefrierfach' }), sorte('Brötchen', 'gelb', 'stueck', 6, { lagerort: 'gefrierfach' }),
  sorte('Margherita-Pizza', 'blau', 'stueck', 3, { art: 'komplettgericht', lagerort: 'gefrierfach', groesse_g: 350 }),
  sorte('Tomaten-Gemüse-Basis', 'rot', 'portion', 4, { art: 'komponente', groesse_g: 250, lagerort: 'gefrierfach' }),
  sorte('Linsen-Bolognese-Basis', 'rot', 'portion', 4, { art: 'komponente', groesse_g: 250, lagerort: 'gefrierfach' }),
  sorte('Neutrale Gemüse-Basis', 'gruen', 'portion', 4, { art: 'komponente', groesse_g: 200, lagerort: 'gefrierfach' }),
  sorte('Gekochte Kichererbsen', 'braun', 'portion', 4, { art: 'komponente', groesse_g: 240, lagerort: 'gefrierfach' }),
  sorte('Gekochte Kidneybohnen', 'braun', 'portion', 4, { art: 'komponente', groesse_g: 250, lagerort: 'gefrierfach' }),
  sorte('Gekochte Linsen', 'braun', 'portion', 4, { art: 'komponente', groesse_g: 250, lagerort: 'gefrierfach' }),
  sorte('TK-Gemüse', 'gruen', 'g', 1000, { lagerort: 'gefrierfach' }),
];

const snap = (bestand: BestandZeile[], genannt = '', optionen = {}) => baueSnapshot(bestand, genannt, DATUM, optionen);
const rezept = (bestand: BestandZeile[], id: string, genannt = '', personen = 2) =>
  grundrezepteFuer(snap(bestand, genannt), { ...OPTIONEN, personen }, ids()).find((s) => s.rezept.id === id);
const ids1 = (n: string, farbe: BestandZeile['farbe'] | null = null) => bausteineFuerName(n, farbe).map((b) => b.id);

describe('Grundbausteine', () => {
  test('vier Kategorien wie im Kombi-Farbsystem – plus fertige Gerichte und Extras', () => {
    for (const k of ['rot', 'braun', 'gruen', 'gelb'] as const) {
      assert.ok(GRUNDBAUSTEINE.filter((b) => b.kategorie === k).length >= 3, k);
      assert.equal(KATEGORIE_INFO[k].farbe, k);
    }
    assert.equal(new Set(GRUNDBAUSTEINE.map((b) => b.id)).size, GRUNDBAUSTEINE.length, 'ids eindeutig');
  });

  test('der Grundvorrat wird erkannt – trocken (Gelb) und gekocht (Braun) getrennt', () => {
    assert.deepEqual(ids1('Nudeln'), ['nudeln']);
    assert.deepEqual(ids1('Spaghetti'), ['nudeln']);
    assert.deepEqual(ids1('Rote Linsen, trocken', 'gelb'), ['rote_linsen']);
    assert.deepEqual(ids1('Rote Linsen', 'gelb'), ['rote_linsen']);
    assert.deepEqual(ids1('Gekochte Linsen', 'braun'), ['gekochte_linsen']);
    assert.deepEqual(ids1('Linsen gekocht', 'braun'), ['gekochte_linsen']);
    assert.deepEqual(ids1('Linsenhack', 'braun'), ['gekochte_linsen']);
    assert.deepEqual(ids1('Kichererbsen, trocken', 'gelb'), ['kichererbsen_trocken']);
    assert.deepEqual(ids1('Kichererbsen', 'braun'), ['gekochte_kichererbsen']);
    assert.deepEqual(ids1('Kidneybohnen (Dose)'), ['gekochte_kidneybohnen']);
    assert.deepEqual(ids1('Passierte Tomaten', 'rot'), ['passierte_tomaten']);
    assert.deepEqual(ids1('Gehackte Tomaten (Dose)', 'rot'), ['gehackte_tomaten']);
    assert.deepEqual(ids1('Tomaten-Gemüse-Basis', 'rot'), ['tomaten_gemuese_basis']);
    assert.deepEqual(ids1('Linsen-Bolognese-Basis', 'rot'), ['linsen_bolognese_basis']);
    assert.deepEqual(ids1('TK-Gemüsemix', 'gruen'), ['tk_gemuese']);
    assert.deepEqual(ids1('Sojagranulat', 'braun'), ['sojagranulat']);
    assert.deepEqual(ids1('Brötchen', 'gelb'), ['broetchen']);
    assert.deepEqual(ids1('Kartoffeln festkochend', 'gelb'), ['kartoffeln']);
  });

  test('vegetarisch: Fleisch und Fisch sind nie ein Grundbaustein', () => {
    for (const n of ['Hähnchenbrust', 'Hackfleisch', 'Thunfisch (Dose)', 'Salami-Pizza']) assert.deepEqual(ids1(n), [], n);
  });
});

describe('Grundrezepte', () => {
  test('25 feste Rezepte: die 15 aus der Rezeptsammlung, dann 10 aus dem übrigen Grundvorrat', () => {
    assert.equal(GRUNDREZEPTE.length, 25);
    assert.deepEqual(GRUNDREZEPTE.map((r) => r.nr), Array.from({ length: 25 }, (_, i) => i + 1));
    assert.equal(new Set(GRUNDREZEPTE.map((r) => r.id)).size, 25);
    assert.deepEqual(GRUNDREZEPTE.slice(0, 15).map((r) => r.name), [
      'Nudeln mit Tomatensoße', 'Linsen-Bolognese mit Nudeln', 'Tomaten-Linsen-Eintopf', 'Reis mit Kichererbsen und Tomate',
      'Kidneybohnen-Tomaten-Topf', 'Chili sin Carne mit Reis', 'Soja-Tomaten-Pfanne mit Reis', 'Tomatenreis', 'Linsen-Reis-Topf',
      'Kartoffel-Linsen-Eintopf', 'Kartoffel-Tomaten-Topf', 'Nudeln mit Kichererbsen-Tomatensoße', 'Linsen-Lasagne',
      'Herzhafte Haferflocken-Linsen-Suppe', 'Kartoffel-Kichererbsen-Topf',
    ]);
  });

  test('mit dem vollen Grundvorrat ist jedes Rezept direkt kochbar – geprüft wie jeder Vorschlag', () => {
    const stand = grundrezepteFuer(snap(GRUNDVORRAT()), OPTIONEN, ids());
    assert.equal(stand.length, 25);
    for (const s of stand) {
      assert.ok(s.kochbar, `${s.rezept.id}: ${s.gericht.fehlt.map((f) => f.name).join(', ')}`);
      assert.equal(s.gericht.grundrezept, s.rezept.id);
      assert.ok(s.gericht.schritte.length >= 2, s.rezept.id);
      // nichts Erfundenes: jede genannte Zutat steckt im Gericht oder ist immer da
      const text = [s.gericht.name, s.gericht.beschreibung, ...s.gericht.schritte].join(' ');
      assert.deepEqual(erwaehnteZutaten(text).filter((x) => /Hähnchen|Rind|Schwein|Hackfleisch|Speck|Schinken|Salami|Wurst|Thunfisch|Lachs|Garnelen|Fisch/.test(x.name)), [], s.rezept.id);
    }
  });

  test('Mengen aus der Rezeptsammlung, für die Personenzahl umgerechnet – in der Einheit der Sorte', () => {
    const zwei = rezept(GRUNDVORRAT(), 'nudeln-tomatensosse')!;
    assert.deepEqual(zwei.gericht.zutaten.filter((z) => z.quelle === 'bestand').map((z) => [z.name, z.menge, z.einheit]),
      [['Nudeln', 225, 'g'], ['Passierte Tomaten', 1, 'stueck']], '225 g Nudeln, 1 Packung passierte Tomaten');
    const vier = rezept(GRUNDVORRAT(), 'nudeln-tomatensosse', '', 4)!;
    assert.deepEqual(vier.gericht.zutaten.filter((z) => z.quelle === 'bestand').map((z) => z.menge), [450, 2]);
    assert.ok(vier.gericht.schritte.some((s) => s.startsWith('1 Zwiebel')), '½ Zwiebel für 2 → 1 Zwiebel für 4');
  });

  test('Zwiebeln, Möhren, Knoblauch sind immer da – nie „fehlt“, nie abgebucht', () => {
    const s = rezept(GRUNDVORRAT(), 'kartoffel-moehren-suppe')!;
    assert.ok(s.kochbar);
    assert.deepEqual(s.gericht.zutaten.filter((z) => z.quelle === 'grundausstattung').map((z) => z.name).slice(0, 3), ['Zwiebeln', 'Möhren', 'Knoblauch']);
    assert.ok(entnahmePlan(s.gericht).every((p) => !['Zwiebeln', 'Möhren', 'Knoblauch'].includes(p.name)));
  });

  test('was fehlt, steht mit Menge da – das Rezept bleibt sichtbar, ist aber nicht direkt kochbar', () => {
    const ohneReis = GRUNDVORRAT().filter((z) => z.name !== 'Reis');
    const s = rezept(ohneReis, 'tomatenreis')!;
    assert.equal(s.kochbar, false);
    assert.deepEqual(s.gericht.fehlt, [{ name: 'Reis', grund: 'nicht_im_bestand', menge: 150, einheit: 'g' }]);
    const wenig = rezept([...ohneReis, sorte('Reis', 'gelb', 'g', 100)], 'tomatenreis')!;
    assert.deepEqual(wenig.gericht.fehlt, [{ name: 'Reis', grund: 'zu_wenig', menge: 50, einheit: 'g' }], 'nur der Rest fehlt');
  });

  test('zu viel fehlt (mehr als drei Zutaten) → kein Grundrezept „aus dem Vorrat“', () => {
    const stand = grundrezepteFuer(snap([sorte('Nudeln', 'gelb', 'g', 500)]), OPTIONEN, ids());
    assert.ok(stand.every((s) => s.gericht.fehlt.length <= 3));
    assert.equal(stand.some((s) => s.rezept.id === 'linsen-lasagne'), false);
  });

  test('zusätzlich genannte Zutaten zählen als vorhanden – werden aber nie abgebucht', () => {
    const ohneReis = GRUNDVORRAT().filter((z) => z.name !== 'Reis');
    const s = rezept(ohneReis, 'tomatenreis', 'Reis')!;
    assert.ok(s.kochbar);
    const reis = s.gericht.zutaten.find((z) => z.name === 'Reis')!;
    assert.deepEqual([reis.quelle, reis.menge], ['kuehlschrank', null]);
    assert.ok(!entnahmePlan(s.gericht).some((p) => p.name === 'Reis'), 'nicht abgebucht');
    assert.ok(s.gericht.warum_jetzt.includes('Nutzt, was du zusätzlich da hast: Reis.'));
  });

  test('vorbereitete Basis: Linsen-Bolognese-Basis ersetzt Linsen UND Tomaten', () => {
    const bestand = [sorte('Spaghetti', 'gelb', 'g', 500), sorte('Linsen-Bolognese-Basis', 'rot', 'portion', 3, { art: 'komponente', groesse_g: 250 })];
    const s = rezept(bestand, 'linsen-bolognese')!;
    assert.ok(s.kochbar, s.gericht.fehlt.map((f) => f.name).join(', '));
    assert.deepEqual(entnahmePlan(s.gericht).map((p) => [p.name, p.menge, p.einheit]), [['Spaghetti', 200, 'g'], ['Linsen-Bolognese-Basis', 3, 'portion']]);
    assert.ok(s.gericht.schritte.some((t) => t.includes('Linsen-Bolognese-Basis in einem Topf erhitzen')));
  });

  test('Gemüse: lieber etwas weniger als „fehlt“ – ab der Hälfte reicht es', () => {
    const bestand = [sorte('Nudeln', 'gelb', 'g', 500), sorte('TK-Gemüse', 'gruen', 'g', 250)];
    const s = rezept(bestand, 'gemuese-nudel-pfanne')!;
    assert.ok(s.kochbar);
    assert.equal(s.gericht.zutaten.find((z) => z.name === 'TK-Gemüse')?.menge, 250);
    assert.equal(rezept([sorte('Nudeln', 'gelb', 'g', 500), sorte('TK-Gemüse', 'gruen', 'g', 100)], 'gemuese-nudel-pfanne')!.kochbar, false);
  });

  test('Extras wie Käse ergänzen nur, wenn sie da sind – sie fehlen nie', () => {
    const mit = rezept([...GRUNDVORRAT(), sorte('Parmesan', 'schwarz', 'g', 100, { lagerort: 'kuehlschrank' })], 'linsen-lasagne')!;
    assert.ok(mit.gericht.zutaten.some((z) => z.name === 'Parmesan'));
    const ohne = rezept(GRUNDVORRAT(), 'linsen-lasagne')!;
    assert.ok(ohne.kochbar);
    assert.ok(!ohne.gericht.fehlt.some((f) => f.name === 'Käse'));
  });

  test('Pizza nur, wenn eine im Gefrierfach ist – sie „fehlt“ nicht', () => {
    assert.ok(rezept(GRUNDVORRAT(), 'pizza-aus-dem-ofen')?.kochbar);
    assert.equal(rezept([sorte('Nudeln', 'gelb', 'g', 500)], 'pizza-aus-dem-ofen'), undefined);
  });
});

describe('Grundrezepte vorschlagen', () => {
  const basis = (bestand: BestandZeile[], teil = {}) => ({ snapshot: snap(bestand), optionen: OPTIONEN, gesehen: [], feedback: [], modus: { art: 'normal' as const }, ...teil });

  test('nur direkt Kochbares, was bald weg muss zuerst, abwechslungsreich', () => {
    const bestand = GRUNDVORRAT().map((z) => (z.name === 'Kartoffeln' ? { ...z, bald_ablaufen: true } : z));
    const g = kochbareGrundrezepte(basis(bestand), ids());
    assert.equal(g.length, 25);
    assert.ok(g[0].zutaten.some((z) => z.name === 'Kartoffeln'), `${g[0].name} sollte die Kartoffeln verbrauchen`);
    assert.ok(new Set(g.slice(0, 3).map((x) => x.eigenschaften.gerichtstyp)).size >= 2, 'nicht dreimal derselbe Gerichtstyp');
  });

  test('Gesehenes und Abgelehntes fällt weg; „Reste“ nur, was etwas rettet', () => {
    const alle = kochbareGrundrezepte(basis(GRUNDVORRAT()), ids());
    const ohne = ordneGrundrezepte(alle, basis(GRUNDVORRAT(), { gesehen: [{ name: 'Tomatenreis', eigenschaften: alle[0].eigenschaften, zutaten: [] }] }));
    assert.ok(!ohne.some((g) => g.name === 'Tomatenreis'));
    assert.deepEqual(ordneGrundrezepte(alle, basis(GRUNDVORRAT(), { modus: { art: 'reste' } })), [], 'nichts muss weg');
  });

  test('mit den Demo-Daten: kochbar ist, was wirklich geht', () => {
    const g = kochbareGrundrezepte(basis(SEED), ids());
    assert.ok(g.length >= 1);
    for (const x of g) assert.equal(x.fehlt.length, 0);
  });

  test('Woche: Grundrezepte gegen den restlichen Vorrat – keine Portion doppelt verplant', async () => {
    const anbieter = grundrezeptAnbieter();
    const bestand = GRUNDVORRAT();
    const e = await erzeugeWoche(anbieter, anfrage({ snapshot: snap(bestand), anzahl: 5, aufgabe: 'woche' }), { id: ids() });
    assert.equal(e.gerichte.length, 5);
    const verplant = new Map<number, number>();
    for (const g of e.gerichte) for (const p of entnahmePlan(g)) verplant.set(p.block_typ_id, (verplant.get(p.block_typ_id) ?? 0) + p.menge);
    for (const z of bestand) assert.ok((verplant.get(z.id) ?? 0) <= z.anzahl, `${z.name}: ${verplant.get(z.id)} > ${z.anzahl}`);
    assert.ok(e.gerichte.every((g) => anbieter.herkunft.has(normalisiere(g.name))), 'Herkunft bekannt');
  });
});
