// Tinder-Logik: Gefällt mir, Nicht meins, Ähnlich, Session-Feedback, keine Duplikate, schrittweises Entfernen.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { berechneLeitplanken, lerneTendenzen } from '../../supabase/functions/_shared/kombi/praeferenz.ts';
import { aehnlichkeit } from '../../supabase/functions/_shared/kombi/aehnlichkeit.ts';
import { erzeugeVorschlaege } from '../../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { kurz } from '../../supabase/functions/_shared/kombi/bewertung.ts';
import type { FeedbackEintrag, RohGericht } from '../../supabase/functions/_shared/kombi/typen.ts';
import { anfrage, fb, festerAnbieter, ids, kurzGericht } from './fixtures.ts';

const normal = { art: 'normal' } as const;
const curry = (n: number) => fb('dislike', `Curry ${n}`, { gerichtstyp: 'curry', gewuerzrichtung: 'indisch', sattmacher: 'reis', hauptzutat: 'linsen' });

describe('„Gefällt mir“', () => {
  test('zwei Likes derselben Art werden als beliebt erkannt, eines noch nicht', () => {
    const eins = berechneLeitplanken([fb('like', 'Pasta 1', { gerichtstyp: 'pasta' })], normal);
    assert.equal(eins.beliebt.some((t) => t.wert === 'pasta'), false);
    const zwei = berechneLeitplanken([fb('like', 'Pasta 1', { gerichtstyp: 'pasta' }), fb('like', 'Pasta 2', { gerichtstyp: 'pasta' })], normal);
    assert.ok(zwei.beliebt.some((t) => t.dimension === 'gerichtstyp' && t.wert === 'pasta'));
  });

  test('auch ein einzelnes „Speichern“ macht noch kein Muster', () => {
    const l = berechneLeitplanken([fb('save', 'Pasta 1', { gerichtstyp: 'pasta' })], normal);
    assert.deepEqual(l.beliebt, []);
  });

  test('ein Like beendet eine Ablehnungsserie', () => {
    const l = berechneLeitplanken([curry(1), curry(2), curry(3), fb('like', 'Wrap')], normal);
    assert.equal(l.ablehnungen_in_folge, 0);
    assert.equal(l.radius, 0);
    assert.deepEqual(l.ausschluss.gerichtstyp, []);
  });
});

describe('„Nicht meins“ – nicht zu schnell lernen', () => {
  test('eine einzelne Ablehnung heißt nicht „mag keine Linsen“', () => {
    const l = berechneLeitplanken([fb('dislike', 'Linsen-Curry', { gerichtstyp: 'curry', hauptzutat: 'linsen' })], normal);
    assert.deepEqual(l.gemieden, []);
    assert.equal(l.radius, 0);
    assert.deepEqual(l.ausschluss, { gerichtstyp: [], gewuerzrichtung: [], sattmacher: [], hauptzutat: [] });
    const t = lerneTendenzen([fb('dislike', 'Linsen-Curry', { hauptzutat: 'linsen' })]).find((x) => x.wert === 'linsen');
    assert.ok(t && t.score > -0.34, 'nur schwaches Signal');
  });

  test('Curry ✗, Pasta ✓, Curry ✗, Wrap ✓ → vorsichtiges Muster statt „mag kein Curry“', () => {
    const l = berechneLeitplanken([
      fb('dislike', 'Curry A', { gerichtstyp: 'curry' }),
      fb('like', 'Pasta', { gerichtstyp: 'pasta' }),
      fb('dislike', 'Curry B', { gerichtstyp: 'curry' }),
      fb('like', 'Wrap', { gerichtstyp: 'wrap' }),
    ], normal);
    assert.ok(l.gemieden.some((t) => t.dimension === 'gerichtstyp' && t.wert === 'curry'));
    const text = l.muster.join(' ');
    assert.match(text, /Pasta\/Wraps scheinen gerade häufiger angenommen zu werden als Currys/);
    assert.doesNotMatch(text, /mag (kein|nicht)|hasst/i);
  });

  test('„Überspringen“ ist neutral und unterbricht keine Serie', () => {
    const l = berechneLeitplanken([curry(1), fb('skip', 'x'), curry(2)], normal);
    assert.equal(l.ablehnungen_in_folge, 2);
    assert.equal(lerneTendenzen([fb('skip', 'x', { gerichtstyp: 'toast' })]).length, 0);
  });
});

describe('schrittweises Entfernen nach Ablehnungen in Folge', () => {
  const serie = (n: number) => Array.from({ length: n }, (_, i) => curry(i + 1));

  test('Radius wächst: gleiche Art → anderer Typ → andere Richtung → ganz anders', () => {
    const r = [1, 2, 3, 4, 5].map((n) => berechneLeitplanken(serie(n), normal));
    assert.deepEqual(r.map((l) => l.radius), [0, 1, 2, 2, 3]);
    assert.deepEqual(r[0].ausschluss.gerichtstyp, [], '1×: anderes Curry ist noch erlaubt');
    assert.deepEqual(r[1].ausschluss.gerichtstyp, ['curry']);
    assert.deepEqual(r[1].ausschluss.gewuerzrichtung, [], '2×: gleiche Richtung (z. B. Reispfanne) noch erlaubt');
    assert.deepEqual(r[2].ausschluss.gewuerzrichtung, ['indisch']);
    assert.deepEqual(r[2].ausschluss.sattmacher, []);
    assert.deepEqual(r[4].ausschluss.sattmacher, ['reis'], '5×: Suche deutlich geöffnet');
    assert.deepEqual(r[4].ausschluss.hauptzutat, ['linsen']);
    assert.match(r[4].muster.join(' '), /öffne die Suche deutlich/);
  });

  test('Engine verwirft Vorschläge, die gegen die Ausschlüsse verstoßen', async () => {
    const vorschlag = (name: string, gerichtstyp: string, gewuerzrichtung: string): RohGericht => ({
      name, zutaten: [{ id: 'b3', bloecke: 1 }, { id: 'b9', bloecke: 2 }],
      eigenschaften: { gerichtstyp, gewuerzrichtung, hauptzutat: 'kichererbsen', sattmacher: 'wrap' },
    });
    const ki = festerAnbieter({
      vorschlaege: [
        vorschlag('Noch ein Curry', 'curry', 'indisch'),
        vorschlag('Indische Pfanne', 'pfanne', 'indisch'),
        vorschlag('Mexikanischer Wrap', 'wrap', 'mexikanisch'),
      ],
    });
    const e = await erzeugeVorschlaege(ki, anfrage({ feedback: serie(3) }), { id: ids() });
    assert.deepEqual(e.gerichte.map((g) => g.name), ['Mexikanischer Wrap']);
    assert.equal(e.verworfen.length, 2);
    assert.equal(ki.auftraege[0].leitplanken.radius, 2, 'KI bekommt die Leitplanken mit');
  });

  test('regelbasiert: nach mehreren Ablehnungen kommt eine andere Richtung', async () => {
    const feedback: FeedbackEintrag[] = [];
    const gesehen = [];
    const erste = await erzeugeVorschlaege(regelbasiert(), anfrage({ anzahl: 1 }), { id: ids() });
    let aktuell = erste.gerichte[0];
    const abgelehnt = [aktuell.eigenschaften.gerichtstyp];
    for (let i = 0; i < 3; i++) {
      gesehen.push(kurz(aktuell));
      feedback.push({ ...kurz(aktuell), aktion: 'dislike', vorschlag_id: aktuell.id });
      const e = await erzeugeVorschlaege(regelbasiert(), anfrage({ anzahl: 1, gesehen, feedback }), { id: ids() });
      aktuell = e.gerichte[0];
      assert.ok(aktuell, `Runde ${i + 2} liefert einen Vorschlag`);
      if (i >= 1) assert.ok(!abgelehnt.includes(aktuell.eigenschaften.gerichtstyp), `Runde ${i + 2}: anderer Gerichtstyp`);
      abgelehnt.push(aktuell.eigenschaften.gerichtstyp);
    }
  });
});

describe('„Ähnlich“', () => {
  test('liefert ein anderes Gericht mit erkennbarer Gemeinsamkeit', async () => {
    const anker = await erzeugeVorschlaege(regelbasiert(), anfrage({ anzahl: 1 }), { id: ids() });
    const zu = kurz(anker.gerichte[0]);
    const e = await erzeugeVorschlaege(regelbasiert(), anfrage({
      anzahl: 1,
      gesehen: [zu],
      feedback: [{ ...zu, aktion: 'similar', vorschlag_id: anker.gerichte[0].id }],
      modus: { art: 'aehnlich', zu },
    }), { id: ids() });
    const neu = e.gerichte[0];
    assert.notEqual(neu.name, zu.name);
    const a = aehnlichkeit(kurz(neu), zu);
    assert.ok(a >= 0.25 && a < 0.85, `ähnlich, aber nicht gleich (${a})`);
    assert.ok(
      neu.eigenschaften.hauptzutat === zu.eigenschaften.hauptzutat || neu.eigenschaften.gewuerzrichtung === zu.eigenschaften.gewuerzrichtung,
      'gleiche Hauptzutat oder Richtung',
    );
  });

  test('die KI bekommt das Vorbild als Anker', async () => {
    const zu = kurzGericht('Linsen-Tomaten-Pasta', { gerichtstyp: 'pasta', hauptzutat: 'linsen' });
    const ki = festerAnbieter({ vorschlaege: [] });
    await erzeugeVorschlaege(ki, anfrage({ modus: { art: 'aehnlich', zu } }), { id: ids() });
    assert.equal(ki.auftraege[0].leitplanken.anker?.name, 'Linsen-Tomaten-Pasta');
  });
});

describe('Feedback innerhalb einer Session', () => {
  test('gesehene Gerichte und Entscheidungen gehen in den nächsten Auftrag ein', async () => {
    const ki = festerAnbieter({ vorschlaege: [] });
    const gesehen = [kurzGericht('Curry A', { gerichtstyp: 'curry' }), kurzGericht('Curry B', { gerichtstyp: 'curry' })];
    const feedback = [fb('dislike', 'Curry A', { gerichtstyp: 'curry' }), fb('dislike', 'Curry B', { gerichtstyp: 'curry' })];
    await erzeugeVorschlaege(ki, anfrage({ gesehen, feedback }), { id: ids() });
    const a = ki.auftraege[0];
    assert.deepEqual(a.gesehen.map((g) => g.name), ['Curry A', 'Curry B']);
    assert.deepEqual(a.leitplanken.ausschluss.gerichtstyp, ['curry']);
    assert.ok(a.leitplanken.gemieden.some((t) => t.wert === 'curry'));
  });
});

describe('keine Duplikate', () => {
  test('bereits Gezeigtes und Doppeltes in einer Antwort wird verworfen', async () => {
    const g = (name: string): RohGericht => ({
      name, zutaten: [{ id: 'b3', bloecke: 1 }, { id: 'b1', bloecke: 1 }, { id: 'b9', bloecke: 2 }],
      eigenschaften: { gerichtstyp: 'wrap', hauptzutat: 'linsen', sattmacher: 'wrap', gewuerzrichtung: 'italienisch' },
    });
    const ki = festerAnbieter({ vorschlaege: [g('Linsen-Wrap'), g('Linsen Wrap!'), g('Linsen-Tomaten-Wrap'), g('Gezeigt')] });
    const gezeigt = kurzGericht('Gezeigt', { gerichtstyp: 'curry' });
    const e = await erzeugeVorschlaege(ki, anfrage({ gesehen: [gezeigt] }), { id: ids() });
    assert.deepEqual(e.gerichte.map((x) => x.name), ['Linsen-Wrap']);
    assert.equal(e.verworfen.length, 3);
    assert.ok(e.verworfen.every((v) => /zu ähnlich/.test(v.grund)));
  });

  test('regelbasiert wiederholt über viele Runden kein Gericht', async () => {
    const gesehen = [];
    const namen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const e = await erzeugeVorschlaege(regelbasiert(), anfrage({ gesehen }), { id: ids() });
      for (const g of e.gerichte) {
        assert.ok(!namen.has(g.name), `„${g.name}“ doppelt`);
        namen.add(g.name);
        gesehen.push(kurz(g));
      }
    }
    assert.ok(namen.size >= 10);
  });
});
