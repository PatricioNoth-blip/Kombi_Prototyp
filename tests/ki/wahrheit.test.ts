// Kreativität ja, Halluzination nein: Namen und Texte gegen das prüfen, was wirklich bekannt ist.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeGericht } from '../../supabase/functions/_shared/kombi/validierung.ts';
import { bereinigeText, deckungstext, erwaehnteZutaten, namensQualitaet, pruefeName } from '../../supabase/functions/_shared/kombi/wahrheit.ts';
import { OPTIONEN, SEED, snapshot } from './fixtures.ts';

const mitPizza = (zusammensetzung: string[] | null) =>
  snapshot(SEED.map((z) => (z.name === 'Pizza' ? { ...z, zusammensetzung } : z)));

describe('Unbekannte Zusammensetzung wird nicht erfunden', () => {
  test('„Salami-Pizza“ aus einer Pizza mit unbekanntem Belag → verworfen', () => {
    const p = pruefeGericht({ name: 'Salami-Pizza', zutaten: [{ id: 'b13', portionen: 2 }] }, mitPizza(null), OPTIONEN, 'x');
    assert.equal(p.ok, false);
    assert.match(!p.ok ? p.grund : '', /Salami/);
  });

  test('ist der Belag bekannt, darf der Name ihn nennen', () => {
    const p = pruefeGericht({ name: 'Salami-Pizza', zutaten: [{ id: 'b13', portionen: 2 }] }, mitPizza(['Tomatensoße', 'Salami', 'Käse']), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.deepEqual(p.wert.hinweise, [], 'Zusammensetzung bekannt → kein Hinweis');
  });

  test('Beschreibung mit erfundenem Inhalt → Satz fällt weg, ehrlicher Ersatz; Hinweis „unbekannt“', () => {
    const p = pruefeGericht({
      name: 'Pizza-Abend', zutaten: [{ id: 'b13', portionen: 2 }],
      beschreibung: 'Knusprige Pizza mit geschmolzenem Mozzarella und frischem Basilikum.',
    }, mitPizza(null), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.doesNotMatch(p.wert.beschreibung, /Mozzarella|Basilikum/);
    assert.ok(p.wert.beschreibung.length > 0);
    assert.deepEqual(p.wert.hinweise, ['Zusammensetzung von Pizza unbekannt']);
  });

  test('der Name darf keine Zutat versprechen, die nur woanders im Haushalt liegt', () => {
    // TK-Spinat ist da, steckt aber nicht in diesem Gericht
    const p = pruefeGericht({ name: 'Spinat-Linsen-Pfanne', zutaten: [{ id: 'b3', portionen: 1 }, { id: 'b1', portionen: 1 }] }, snapshot(), OPTIONEN, 'x');
    assert.equal(p.ok, false);
  });
});

describe('Zubereitung: Fehlendes wird ehrlich benannt', () => {
  test('„Käse darüberstreuen“ ohne Käse im Haushalt → Käse steht unter „fehlt“', () => {
    const p = pruefeGericht({
      name: 'Überbackener Linsen-Toast',
      zutaten: [{ id: 'b3', portionen: 1 }, { id: 'b8', portionen: 2 }, { id: 'b1', portionen: 1 }],
      schritte: ['Brötchen halbieren.', 'Linsen und Tomatensoße darauf verteilen, Käse darüberstreuen.', 'Im Ofen 8 Minuten backen.'],
    }, snapshot(), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.deepEqual(p.wert.fehlt.map((f) => f.name), ['Käse']);
    assert.equal(p.wert.schritte.length, 3, 'Schritt bleibt – die Zutat ist ja als fehlend markiert');
  });

  test('Zutaten aus dem Haushalt in den Schritten sind in Ordnung', () => {
    const p = pruefeGericht({
      name: 'Linsen-Wrap', zutaten: [{ id: 'b3', portionen: 1 }, { id: 'b9', portionen: 2 }],
      schritte: ['Wrap mit Linsen füllen.', 'Mit etwas Öl, Salz und Pfeffer abschmecken.'],
    }, snapshot(), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.deepEqual(p.wert.fehlt, []);
  });
});

describe('Keine erfundenen Behauptungen', () => {
  test('Diät-Wörter werden aus dem Namen gestrichen, Sätze damit entfernt', () => {
    const p = pruefeGericht({
      name: 'Vegane Linsen-Bowl', zutaten: [{ id: 'b3', portionen: 1 }, { id: 'b6', portionen: 1 }],
      beschreibung: 'Linsen und Gemüse, warm serviert. Komplett vegan und glutenfrei.',
    }, snapshot(), OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.equal(p.wert.name, 'Linsen-Bowl');
    assert.equal(p.wert.beschreibung, 'Linsen und Gemüse, warm serviert.');
  });

  test('„hausgemacht“ nur, wenn eine verwendete Sorte als selbstgemacht bekannt ist', () => {
    const roh = {
      name: 'Hausgemachte Tomaten-Linsen', zutaten: [{ id: 'b1', portionen: 1 }, { id: 'b3', portionen: 1 }],
      beschreibung: 'Linsen in Tomatensoße. Alles hausgemacht.',
    };
    const unbekannt = pruefeGericht(roh, snapshot(), OPTIONEN, 'x');
    assert.ok(unbekannt.ok);
    assert.equal(unbekannt.wert.name, 'Tomaten-Linsen');
    assert.equal(unbekannt.wert.beschreibung, 'Linsen in Tomatensoße.');

    const selbst = snapshot(SEED.map((z) => (z.name === 'Tomatensoße' ? { ...z, herkunft: 'selbstgemacht' as const } : z)));
    const p = pruefeGericht(roh, selbst, OPTIONEN, 'x');
    assert.ok(p.ok);
    assert.equal(p.wert.name, 'Hausgemachte Tomaten-Linsen');
    assert.equal(p.wert.beschreibung, 'Linsen in Tomatensoße. Alles hausgemacht.');
  });
});

describe('Keine falschen Alarme bei guten, kreativen Namen', () => {
  const faelle: [string, string[], string?][] = [
    ['Tomatige Linsenpfanne', ['b3', 'b1']],
    ['Knusper-Wrap mit Kichererbsen', ['b4', 'b9', 'b1']],
    ['Cremiges Spinat-Curry', ['b7', 'b2']],
    ['Linsensuppe mit Röstbrötchen', ['b14', 'b8']],
    ['Mexikanischer Bohnen-Burger', ['b5', 'b8', 'b12']],
    ['Pizza-Abend', ['b13']],
    ['Gemüse-Reispfanne mit Chili-Box', ['b17', 'b6']],
    ['Paprika-Linsen-Wrap', ['b3', 'b9', 'k1'], 'halbe Paprika'],
  ];
  for (const [name, idsListe, kuehlschrank] of faelle) {
    test(name, () => {
      const p = pruefeGericht({ name, zutaten: idsListe.map((id) => ({ id, portionen: 1 })), beschreibung: `${name} – schnell gemacht.` },
        snapshot(SEED, kuehlschrank ?? ''), OPTIONEN, 'x');
      assert.ok(p.ok, !p.ok ? p.grund : '');
      assert.equal(p.wert.name, name);
      assert.equal(p.wert.beschreibung, `${name} – schnell gemacht.`);
    });
  }

  test('Lexikon erkennt Zutaten in zusammengesetzten Wörtern, aber keine Fehltreffer', () => {
    const namen = (t: string) => erwaehnteZutaten(t).map((e) => e.name);
    assert.deepEqual(namen('Kichererbsencurry mit Reis'), ['Kichererbsen', 'Reis']);
    assert.deepEqual(namen('Der Preis ist gut, dazu Olivenöl'), [], '„Preis“ ist kein Reis, Olivenöl keine Olive');
    assert.deepEqual(namen('Eine Pfanne voller Farbe'), [], '„Eine“ ist kein Ei');
    assert.deepEqual(namen('Spiegelei auf Toast'), ['Ei']);
  });
});

describe('Namensqualität', () => {
  test('natürliche Namen schlagen mechanische Zutatenketten', () => {
    const bestand = SEED.map((z) => z.name);
    const gut = namensQualitaet('Tomatige Linsenpfanne', bestand);
    assert.equal(gut, 1);
    assert.ok(namensQualitaet('Linsen-Tomaten-Gemüse-Wrap', bestand) < gut);
    assert.ok(namensQualitaet('Linsen gekocht mit TK-Gemüsemix und Curry-Basis Kokos', bestand) <= 0.25);
  });
});

describe('Keine erfundenen Mengen, Nährwerte oder Bildquellen in KI-Texten', () => {
  const deckung = deckungstext(['Tomaten', 'Joghurt', 'Gurke', 'Linsen']);
  const r = { hausgemacht_erlaubt: false };

  test('Bestandsmengen („Du hast 3 Tomaten“) werden entfernt – Zeitangaben bleiben', () => {
    for (const satz of ['Du hast noch 3 Tomaten im Kühlschrank.', 'Im Vorrat sind 2 Dosen Tomaten.', '3 Tomaten sind noch da.', 'Übrig bleiben 2 Portionen Linsen.']) {
      assert.deepEqual(bereinigeText(satz, deckung, r), { text: '', entfernt: ['Bestandsmenge'] }, satz);
    }
    for (const satz of ['Etwa 20 Minuten köcheln lassen.', 'Noch 10 Minuten im Ofen backen.', 'Bei 200 Grad backen.', 'Die Tomaten sind noch da und schmecken frisch.']) {
      assert.equal(bereinigeText(satz, deckung, r).text, satz, satz);
    }
  });

  test('Kalorien- und Nährwertbehauptungen werden entfernt – die rechnet die Software', () => {
    assert.deepEqual(bereinigeText('Die Bowl hat nur 450 kcal. Mit Joghurt und Gurke.', deckung, r),
      { text: 'Mit Joghurt und Gurke.', entfernt: ['Nährwertangabe'] });
    assert.equal(bereinigeText('Ein proteinreiches Abendessen.', deckung, r).text, '');
    assert.equal(bereinigeText('Liefert 30 g Protein.', deckung, r).text, '');
    assert.equal(pruefeName('Proteinreiche Linsen-Bowl', deckung, r).name, 'Linsen-Bowl');
  });

  test('Links und Bild-URLs werden entfernt; ein Name mit Link ist unbrauchbar', () => {
    assert.deepEqual(bereinigeText('Sieht so aus: https://bilder.example/bowl.jpg', deckung, r), { text: '', entfernt: ['Link/Bildquelle'] });
    assert.equal(bereinigeText('Foto unter www.example.com.', deckung, r).text, '');
    assert.ok('fehler' in pruefeName('Bowl www.example.com', deckung, r));
  });
});
