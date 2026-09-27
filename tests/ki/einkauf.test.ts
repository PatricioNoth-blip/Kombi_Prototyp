// Notfall-Einkauf und Multi-Use-Zutaten, Abwägung Kosten vs. Nutzen.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { erzeugeVorschlaege } from '../../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { MULTI_USE, pruefeEinkauf, waehleMultiUse } from '../../supabase/functions/_shared/kombi/einkauf.ts';
import { kannMahlzeit } from '../../supabase/functions/_shared/kombi/snapshot.ts';
import { pruefeGericht } from '../../supabase/functions/_shared/kombi/validierung.ts';
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
