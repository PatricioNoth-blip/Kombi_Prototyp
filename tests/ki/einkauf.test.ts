// Notfall-Einkauf und Multi-Use-Zutaten, Abwägung Kosten vs. Nutzen.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { erzeugeVorschlaege } from '../../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { bewerteMultiUse, MULTI_USE, pruefeEinkauf, waehleMultiUse } from '../../supabase/functions/_shared/kombi/einkauf.ts';
import { kannMahlzeit } from '../../supabase/functions/_shared/kombi/snapshot.ts';
import { pruefeBaustein, pruefeGericht } from '../../supabase/functions/_shared/kombi/validierung.ts';
import { bewerte } from '../../supabase/functions/_shared/kombi/bewertung.ts';
import { berechneLeitplanken } from '../../supabase/functions/_shared/kombi/praeferenz.ts';
import { anfrage, festerAnbieter, ids, OPTIONEN, SEED, snapshot } from './fixtures.ts';

const nurFarben = (...farben: string[]) => SEED.filter((z) => farben.includes(z.farbe));

describe('Notfall-Einkauf', () => {
  test('nichts Sinnvolles im Bestand → Notfall mit genau EINEM Einkaufsvorschlag', async () => {
    const snap = snapshot(nurFarben('weiss'), ''); // nur Gewürzwürfel
    assert.equal(kannMahlzeit(snap), false);
    const e = await erzeugeVorschlaege(regelbasiert(), anfrage({ snapshot: snap }), { id: ids() });
    assert.equal(e.notfall, true);
    assert.ok(e.einkauf, 'ein Einkaufsvorschlag');
    assert.ok(e.einkauf.ermoeglicht.length >= 5, 'eröffnet viele Möglichkeiten');
  });

  test('genug im Bestand → kein Einkauf', async () => {
    const e = await erzeugeVorschlaege(regelbasiert(), anfrage(), { id: ids() });
    assert.equal(e.notfall, false);
    assert.equal(e.einkauf, null);
  });

  test('Preis nur aus Daten: bekannter Preis einer leeren Sorte, sonst „unbekannt“ statt geschätzt', () => {
    const ohneSattmacher = snapshot(nurFarben('braun', 'rot', 'weiss'), '');
    const unbekannt = waehleMultiUse(ohneSattmacher, 'x');
    assert.equal(unbekannt.preis_cent, null);

    const mitPreis = snapshot([...nurFarben('braun', 'rot', 'weiss'),
      { id: 99, name: 'Reis', farbe: 'gelb', anzahl: 0, bald_ablaufen: false, groesse_g: 125, kosten_cent: 9, lagerort: 'vorrat' }], '');
    const e = waehleMultiUse(mitPreis, 'x');
    assert.equal(e.name, 'Reis');
    assert.equal(e.preis_cent, 9);
  });

  test('KI-Einkauf wird geprüft: zu wenig Nutzen → eigener Multi-Use-Vorschlag', async () => {
    const snap = snapshot(nurFarben('weiss'), '');
    const ki = festerAnbieter({ vorschlaege: [], einkauf: { name: 'Trüffel', ermoeglicht: ['Trüffelpasta'] } });
    const e = await erzeugeVorschlaege(ki, anfrage({ snapshot: snap }), { id: ids() });
    assert.notEqual(e.einkauf?.name, 'Trüffel');
    assert.ok(MULTI_USE.some((m) => m.name === e.einkauf?.name));
  });

  test('KI-Einkauf mit vielen Möglichkeiten wird übernommen – ohne erfundenen Preis', () => {
    const e = pruefeEinkauf(
      { name: 'Gehackte Tomaten', ermoeglicht: ['Chili', 'Curry', 'Suppe', 'Pizza', 'Ragù', 'Shakshuka'], begruendung: 'kostet 0,49 €' },
      snapshot(nurFarben('weiss'), ''), 'x',
    );
    assert.ok(e);
    assert.equal(e.preis_cent, null);
    assert.equal(e.ermoeglicht.length, 6);
  });
});

describe('Multi-Use-Zutaten', () => {
  test('fehlt der Sattmacher, wird ein vielseitiger Sattmacher gewählt', () => {
    const e = waehleMultiUse(snapshot(nurFarben('braun', 'rot', 'gruen', 'weiss'), ''), 'x');
    assert.ok(['Reis', 'Pasta', 'Kartoffeln', 'Wraps', 'Haferflocken'].includes(e.name), e.name);
  });

  test('fehlt die Basis, werden Tomaten gewählt', () => {
    const e = waehleMultiUse(snapshot(nurFarben('braun', 'gelb', 'gruen'), ''), 'x');
    assert.equal(e.name, 'Gehackte Tomaten (Dose)');
    assert.ok(e.ermoeglicht.length >= 6);
  });

  test('schon Vorhandenes wird nicht vorgeschlagen', () => {
    const e = waehleMultiUse(snapshot(nurFarben('weiss'), 'Reis, Nudeln'), 'x');
    assert.notEqual(e.name, 'Reis');
  });

  test('jede Multi-Use-Zutat passt zu mindestens 3 Gerichten', () => {
    for (const m of MULTI_USE) assert.ok(m.passt_zu.length >= 3, m.name);
  });
});

describe('Abwägung statt „immer das Billigste“', () => {
  test('ein etwas teureres Gericht, das bald Ablaufendes und mehr Bausteine nutzt, gewinnt', () => {
    const bestand = SEED.map((z) => (z.name === 'TK-Spinat' || z.name === 'Kichererbsen' ? { ...z, bald_ablaufen: true } : z));
    const snap = snapshot(bestand, '');
    const billig = pruefeGericht({ name: 'Linsen pur', zutaten: [{ id: 'b3', bloecke: 2 }, { id: 'b9', bloecke: 2 }], zeit_min: 10,
      eigenschaften: { gerichtstyp: 'wrap', sattmacher: 'wrap', hauptzutat: 'linsen' } }, snap, OPTIONEN, 'a');
    const kreativ = pruefeGericht({ name: 'Kichererbsen-Spinat-Curry-Wrap', zeit_min: 12,
      zutaten: [{ id: 'b4', bloecke: 2 }, { id: 'b7', bloecke: 2 }, { id: 'b2', bloecke: 2 }, { id: 'b9', bloecke: 2 }, { id: 'b11', bloecke: 1 }],
      eigenschaften: { gerichtstyp: 'wrap', sattmacher: 'wrap', hauptzutat: 'kichererbsen' } }, snap, OPTIONEN, 'b');
    assert.ok(billig.ok && kreativ.ok);
    assert.ok(billig.wert.kosten.pro_portion_cent < kreativ.wert.kosten.pro_portion_cent, 'Linsen sind billiger');
    const l = berechneLeitplanken([], { art: 'normal' });
    assert.ok(bewerte(kreativ.wert, OPTIONEN, [], l) > bewerte(billig.wert, OPTIONEN, [], l));
  });
});

describe('Notfall-Einkauf: von der Software bewertet und begründet', () => {
  test('Gründe kommen aus Daten: passt zu Vorhandenem, Haltbarkeit, Lagerung, Preis unbekannt', () => {
    const e = waehleMultiUse(snapshot(nurFarben('braun', 'rot', 'weiss'), ''), 'x');
    assert.ok(['Reis', 'Pasta'].includes(e.name), e.name);
    assert.ok(e.gruende.some((g) => /Lücke/.test(g)), 'füllt die Sattmacher-Lücke');
    assert.ok(e.gruende.some((g) => /^Passt zu \d+ Sachen, die schon da sind: /.test(g)));
    assert.ok(e.gruende.some((g) => /haltbar, ohne Kühlung lagerbar/.test(g)));
    assert.ok(e.gruende.includes('Preis unbekannt.'));
    assert.match(e.heute ?? '', new RegExp(`^${e.name} \\+ `), 'konkrete Kombination mit dem Bestand');
  });

  test('bekannter Preis wird mit Bezug genannt – aus dem Bestand, nicht geschätzt', () => {
    const mitPreis = snapshot([...nurFarben('braun', 'rot', 'weiss'),
      { id: 99, name: 'Reis', farbe: 'gelb', anzahl: 0, bald_ablaufen: false, groesse_g: 75, kosten_cent: 149, lagerort: 'vorrat', einheit: 'g', portion_menge: 75, kosten_menge: 1000 }], '');
    const e = waehleMultiUse(mitPreis, 'x');
    assert.equal(e.name, 'Reis');
    assert.equal(e.preis_cent, 149);
    assert.equal(e.preis_bezug, 'für 1 kg');
    assert.ok(e.gruende.includes('Zuletzt 1,49 € für 1 kg.'));
  });

  test('Kombinierbarkeit zählt: mit Linsen und Soße im Bestand gewinnt ein Sattmacher', () => {
    const [erste] = bewerteMultiUse(snapshot(nurFarben('braun', 'rot'), ''));
    assert.equal(erste.m.rolle, 'gelb');
    assert.ok(erste.partner.length >= 3);
  });
});

describe('Neue Bausteine: sauber definiert, erst nach „übernehmen“ gespeichert', () => {
  test('Art, Farbe, Lagerort, Portionen, Zutaten; Kosten nur aus bekannten Preisen', () => {
    const b = pruefeBaustein({
      name: 'Tomaten-Linsen-Basis', art: 'komponente', farbe: 'rot', lagerort: 'gefrierfach', portionen: 6, portion_g: 150,
      zutaten: [{ id: 'b3', portionen: 3 }, { id: 'b1', portionen: 2 }, { name: 'Zwiebeln' }],
      verwendbar_fuer: ['Pasta', 'Wrap', 'Auflauf'], begruendung: 'Vielseitig. Kostet nur 0,30 € pro Portion.',
    }, snapshot(), 'x');
    assert.ok(b);
    assert.deepEqual([b.bestandsart, b.farbe, b.lagerort, b.portionen, b.portion_g], ['komponente', 'rot', 'gefrierfach', 6, 150]);
    assert.deepEqual(b.zutaten, ['Linsen gekocht', 'Tomatensoße', 'Zwiebeln']);
    // Linsen 3 × 8 + Soße 2 × 17 = 58 ct bekannt, Zwiebeln unbekannt → teilweise, pro Portion ab 10 ct
    assert.equal(b.kosten.status, 'teilweise');
    assert.equal(b.kosten.gesamt_cent, 58);
    assert.equal(b.kosten.pro_portion_cent, 10);
    assert.deepEqual(b.kosten.unbekannt, ['Zwiebeln']);
    assert.equal(b.begruendung, 'Vielseitig.', 'Preis der KI entfernt');
  });

  test('ohne gültige Farbe oder zu wenig Verwendungen → keine Idee', () => {
    assert.equal(pruefeBaustein({ name: 'X', farbe: 'lila', verwendbar_fuer: ['a', 'b', 'c'] }, snapshot(), 'x'), null);
    assert.equal(pruefeBaustein({ name: 'X', farbe: 'rot', verwendbar_fuer: ['a'] }, snapshot(), 'x'), null);
  });
});
