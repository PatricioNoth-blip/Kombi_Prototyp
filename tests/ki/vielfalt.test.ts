// Abwechslung über mehrere Dimensionen, „gerade etwas anderes“ ≠ Ablehnung,
// Priorität geöffnet > bald > Rest > Komplettgericht > Komponente > Vorrat (aber nicht blind), Favoriten.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { erzeugeVorschlaege } from '../../supabase/functions/_shared/kombi/engine.ts';
import { verletztVielfalt, vielfaltSperre, wiederholung } from '../../supabase/functions/_shared/kombi/vielfalt.ts';
import { berechneLeitplanken, lerneTendenzen } from '../../supabase/functions/_shared/kombi/praeferenz.ts';
import { bewerte, dringlichkeitVon } from '../../supabase/functions/_shared/kombi/bewertung.ts';
import { pruefeGericht } from '../../supabase/functions/_shared/kombi/validierung.ts';
import type { GerichtZutat, RohGericht } from '../../supabase/functions/_shared/kombi/typen.ts';
import { anfrage, fb, festerAnbieter, ids, kurzGericht, OPTIONEN, SEED, snapshot } from './fixtures.ts';

const wrap = (name: string, hauptzutat = 'linsen') => kurzGericht(name, { gerichtstyp: 'wrap', sattmacher: 'wrap', hauptzutat });

/** Rohgerichte aus dem Seed: gleiche Zutaten, nur Typ/Hauptzutat verschieden */
const roh = (name: string, gerichtstyp: string, sattmacher: string, idsListe: string[], hauptzutat = 'linsen'): RohGericht => ({
  name, zeit_min: 12, zutaten: idsListe.map((id) => ({ id, portionen: 1 })),
  eigenschaften: { gerichtstyp, sattmacher, hauptzutat, gewuerzrichtung: 'neutral' },
});

describe('Abwechslung über mehrere Dimensionen', () => {
  test('Wiederholung misst Gerichtstyp, Hauptzutat, Sattmacher … mit Gewicht auf den letzten', () => {
    const zuletzt = [wrap('A'), wrap('B'), wrap('C')];
    assert.ok(wiederholung(wrap('D'), zuletzt) > 0.6);
    const pasta = kurzGericht('Pasta', { gerichtstyp: 'pasta', sattmacher: 'pasta', hauptzutat: 'kichererbsen', gewuerzrichtung: 'italienisch', zubereitung: 'topf', konsistenz: 'cremig' });
    assert.ok(wiederholung(pasta, zuletzt) < 0.2);
    assert.equal(wiederholung(wrap('X'), []), 0);
  });

  test('nach 3 Wraps unter den letzten 4 ist „Wrap“ gesperrt – außer im Ähnlich-Modus', () => {
    const zuletzt = [wrap('A'), kurzGericht('Curry', { gerichtstyp: 'curry', sattmacher: 'reis' }), wrap('B'), wrap('C')];
    const sperre = vielfaltSperre(zuletzt);
    assert.deepEqual(sperre.gerichtstyp, ['wrap']);
    assert.deepEqual(sperre.sattmacher, ['wrap']);
    assert.ok(verletztVielfalt(wrap('D'), sperre));
    assert.deepEqual(vielfaltSperre(zuletzt, wrap('Anker')).gerichtstyp, [], 'Ähnliches ausdrücklich gewünscht');
    assert.deepEqual(vielfaltSperre([wrap('A'), wrap('B')]).gerichtstyp, [], 'zwei sind noch keine Serie');
  });

  test('Engine: kein vierter Wrap nach drei Wraps, wenn es Alternativen gibt', async () => {
    const ki = festerAnbieter({
      vorschlaege: [
        roh('Kichererbsen-Wrap', 'wrap', 'wrap', ['b4', 'b9', 'b1'], 'kichererbsen'),
        roh('Linsen-Eintopf', 'eintopf', 'keiner', ['b3', 'b1']),
      ],
    });
    const gesehen = [wrap('Linsen-Wrap'), wrap('Bohnen-Wrap', 'bohnen'), wrap('Spinat-Wrap', 'spinat')];
    const e = await erzeugeVorschlaege(ki, anfrage({ gesehen, anzahl: 2 }), { id: ids() });
    assert.deepEqual(e.gerichte.map((g) => g.name), ['Linsen-Eintopf']);
    assert.match(ki.auftraege[0].leitplanken.vielfalt_sperre.gerichtstyp.join(), /wrap/, 'KI erfährt die Sperre');
  });

  test('geht gar nichts anderes, kommt trotzdem ein Gericht (nicht blind leer)', async () => {
    const ki = festerAnbieter({ vorschlaege: [roh('Kichererbsen-Wrap', 'wrap', 'wrap', ['b4', 'b9'], 'kichererbsen')] });
    const gesehen = [wrap('A'), wrap('B'), wrap('C')];
    const e = await erzeugeVorschlaege(ki, anfrage({ gesehen }), { id: ids() });
    assert.equal(e.gerichte.length, 1);
    assert.equal(e.notfall, false);
  });

  test('innerhalb einer Antwort: lieber verschieden als drei ähnlich gute Wraps', async () => {
    const ki = festerAnbieter({
      vorschlaege: [
        roh('Linsen-Wrap', 'wrap', 'wrap', ['b3', 'b9', 'b1']),
        roh('Kichererbsen-Wrap', 'wrap', 'wrap', ['b4', 'b9', 'b1'], 'kichererbsen'),
        roh('Bohnen-Wrap', 'wrap', 'wrap', ['b5', 'b9', 'b1'], 'bohnen'),
        roh('Tomatiger Linsen-Eintopf', 'eintopf', 'brot', ['b3', 'b1', 'b8']),
      ],
    });
    const e = await erzeugeVorschlaege(ki, anfrage({ anzahl: 2 }), { id: ids() });
    assert.deepEqual(e.gerichte.map((g) => g.eigenschaften.gerichtstyp).sort(), ['eintopf', 'wrap']);
  });
});

describe('„Gerade etwas anderes“ ist keine Ablehnung', () => {
  test('Überspringen lernt nichts und öffnet keinen Radius', () => {
    const feedback = [fb('skip', 'Curry A', { gerichtstyp: 'curry' }), fb('skip', 'Curry B', { gerichtstyp: 'curry' }), fb('skip', 'Curry C', { gerichtstyp: 'curry' })];
    assert.deepEqual(lerneTendenzen(feedback), []);
    const l = berechneLeitplanken(feedback, { art: 'normal' });
    assert.equal(l.radius, 0);
    assert.deepEqual(l.ausschluss.gerichtstyp, []);
    assert.equal(l.kurzfristig_meiden.length, 3, 'aber: für den Moment etwas anderes');
  });

  test('Übersprungenes wird nur kurzfristig zurückgestellt (letzte 3 Entscheidungen)', () => {
    const alt = [fb('skip', 'Curry A', { gerichtstyp: 'curry' }), fb('like', 'X'), fb('like', 'Y'), fb('like', 'Z')];
    assert.equal(berechneLeitplanken(alt, { art: 'normal' }).kurzfristig_meiden.length, 0);
  });

  test('Rangfolge: nach „gerade etwas anderes“ rutscht Ähnliches nach hinten – nach „Nicht meins“ ×2 fliegt es raus', async () => {
    const curry = roh('Kichererbsen-Curry', 'curry', 'reis', ['b4', 'b2', 'b6'], 'kichererbsen');
    const pasta = roh('Linsen-Eintopf', 'eintopf', 'keiner', ['b3', 'b1']);
    const ki = () => festerAnbieter({ vorschlaege: [curry, pasta] });
    const eig = { gerichtstyp: 'curry' as const, sattmacher: 'reis' as const, hauptzutat: 'kichererbsen' };

    const neutral = await erzeugeVorschlaege(ki(), anfrage({ anzahl: 2 }), { id: ids() });
    const nachSkip = await erzeugeVorschlaege(ki(), anfrage({ anzahl: 2, feedback: [fb('skip', 'Kichererbsen-Curry mit Spinat', eig)] }), { id: ids() });
    const nachDislike = await erzeugeVorschlaege(ki(), anfrage({ anzahl: 2, feedback: [fb('dislike', 'Curry 1', eig), fb('dislike', 'Curry 2', eig)] }), { id: ids() });

    const curryN = neutral.gerichte.find((g) => g.name === 'Kichererbsen-Curry')!;
    const curryS = nachSkip.gerichte.find((g) => g.name === 'Kichererbsen-Curry')!;
    assert.ok(curryS, 'nach Überspringen weiterhin möglich');
    assert.ok(curryS.bewertung < curryN.bewertung, 'aber weiter hinten');
    assert.equal(nachDislike.gerichte.some((g) => g.name === 'Kichererbsen-Curry'), false, 'zweimal abgelehnt → vorerst raus');
  });
});

describe('Priorität beim Verbrauchen – mit Augenmaß', () => {
  const basis: GerichtZutat = {
    id: 'b1', name: 'x', quelle: 'bestand', farbe: 'rot', art: 'zutat', einheit: 'portion', menge: 1, portionen: 1,
    kosten_cent: 10, bald_verbrauchen: false, geoeffnet: false, zusammensetzung: null, block_typ_id: 1,
  };

  test('geöffnet > bald ablaufend > Rest > Komplettgericht > Komponente > Vorrat', () => {
    const w = [
      dringlichkeitVon({ ...basis, geoeffnet: true }),
      dringlichkeitVon({ ...basis, bald_verbrauchen: true }),
      dringlichkeitVon({ ...basis, quelle: 'kuehlschrank', menge: null }),
      dringlichkeitVon({ ...basis, art: 'komplettgericht' }),
      dringlichkeitVon({ ...basis, art: 'komponente' }),
      dringlichkeitVon({ ...basis, art: 'zutat' }),
    ];
    for (let i = 1; i < w.length; i++) assert.ok(w[i - 1] > w[i], `Stufe ${i}: ${w[i - 1]} > ${w[i]}`);
  });

  test('angebrochene Zutat hebt ein sonst gleiches Gericht nach vorn', () => {
    const offen = snapshot(SEED.map((z) => (z.name === 'Kichererbsen' ? { ...z, geoeffnet: 2 } : z)));
    const zu = snapshot(SEED);
    const r = roh('Kichererbsen-Pfanne', 'pfanne', 'keiner', ['b4', 'b6']);
    const l = berechneLeitplanken([], { art: 'normal' });
    const a = pruefeGericht(r, offen, OPTIONEN, 'a');
    const b = pruefeGericht(r, zu, OPTIONEN, 'b');
    assert.ok(a.ok && b.ok);
    assert.ok(bewerte(a.wert, OPTIONEN, [], l, undefined, { snapshot: offen }) > bewerte(b.wert, OPTIONEN, [], l, undefined, { snapshot: zu }));
  });

  test('aber nicht blind: Geöffnetes plus drei Einkäufe schlägt kein vollständiges Gericht', () => {
    const offen = snapshot(SEED.map((z) => (z.name === 'Kichererbsen' ? { ...z, geoeffnet: 2 } : z)));
    const l = berechneLeitplanken([], { art: 'normal' });
    const mitEinkauf = pruefeGericht({ ...roh('Kichererbsen-Salat', 'salat', 'keiner', ['b4']), fehlt: [{ name: 'Gurke' }, { name: 'Feta' }, { name: 'Oliven' }] }, offen, OPTIONEN, 'a');
    const vollstaendig = pruefeGericht(roh('Linsen-Wrap', 'wrap', 'wrap', ['b3', 'b9', 'b1']), offen, OPTIONEN, 'b');
    assert.ok(mitEinkauf.ok && vollstaendig.ok);
    const k = { snapshot: offen };
    assert.ok(bewerte(vollstaendig.wert, OPTIONEN, [], l, undefined, k) > bewerte(mitEinkauf.wert, OPTIONEN, [], l, undefined, k));
  });
});

describe('Lieblingsrezepte', () => {
  test('gehen als Inspiration an die KI und geben Verwandtem ein leichtes Plus', async () => {
    const favorit = kurzGericht('Linsentopf mit Brötchen', { gerichtstyp: 'eintopf', sattmacher: 'brot', hauptzutat: 'linsen' }, ['Linsen gekocht', 'Tomatensoße', 'Brötchen']);
    const ki = () => festerAnbieter({ vorschlaege: [roh('Linsen-Eintopf', 'eintopf', 'keiner', ['b3', 'b1'])] });
    const ohne = await erzeugeVorschlaege(ki(), anfrage(), { id: ids() });
    const k = ki();
    const mit = await erzeugeVorschlaege(k, anfrage({ favoriten: [favorit] }), { id: ids() });
    assert.ok(mit.gerichte[0].bewertung > ohne.gerichte[0].bewertung);
    assert.equal(k.auftraege[0].favoriten?.[0].name, 'Linsentopf mit Brötchen');
  });
});
