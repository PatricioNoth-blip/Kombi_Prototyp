// Die KI darf nichts direkt verändern: Vorschläge sind lesend, Änderungen erst nach Bestätigung.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { erzeugeVorschlaege } from '../../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { entnahmePlan, kochenBestaetigen, rezeptDatensatz, type BuchungsPort } from '../../supabase/functions/_shared/kombi/aktionen.ts';
import { anfrage, festerAnbieter, ids, snapshot, SEED, tiefGefroren } from './fixtures.ts';

function portAttrappe(fehlerBei: number[] = []) {
  const aufrufe: [number, number][] = [];
  const port: BuchungsPort = {
    async entnehmen(id, n) {
      aufrufe.push([id, n]);
      if (fehlerBei.includes(id)) throw new Error('Nur noch 1× da');
      return [id * 100 + n];
    },
  };
  return { port, aufrufe };
}

describe('KI-Vorschlag verändert den Bestand nicht', () => {
  test('Snapshot und Anfrage bleiben unverändert (eingefroren – jede Änderung würde scheitern)', async () => {
    const a = tiefGefroren(anfrage({ snapshot: snapshot(SEED, 'Paprika') }));
    const vorher = JSON.stringify(a);
    const e = await erzeugeVorschlaege(regelbasiert(), a, { id: ids() });
    assert.ok(e.gerichte.length > 0);
    assert.equal(JSON.stringify(a), vorher);
  });

  test('auch eine KI, die „alles aufessen“ vorschlägt, bucht nichts', async () => {
    const { aufrufe } = portAttrappe();
    // Verplant den kompletten Bestand (99 je Sorte wäre zu viel und würde verworfen).
    const ki = festerAnbieter({ vorschlaege: [{ name: 'Alles-Pfanne', zutaten: SEED.map((z) => ({ id: `b${z.id}`, bloecke: z.anzahl })) }] });
    const e = await erzeugeVorschlaege(ki, anfrage(), { id: ids() });
    assert.equal(e.gerichte.length, 1);
    assert.deepEqual(aufrufe, [], 'die Engine hat gar keinen Zugriff auf Buchungen');
  });
});

describe('Datenbankänderung erst nach Nutzerbestätigung', () => {
  test('„Heute kochen“ erzeugt erst einen Plan – gebucht wird nur bei Bestätigung', async () => {
    const e = await erzeugeVorschlaege(regelbasiert(), anfrage({ snapshot: snapshot(SEED, 'Paprika') }), { id: ids() });
    const g = e.gerichte[0];
    const plan = entnahmePlan(g);
    assert.ok(plan.length >= 2);
    assert.ok(plan.every((p) => p.anzahl > 0 && Number.isInteger(p.block_typ_id)));
    assert.equal(plan.some((p) => /Paprika|Salz/.test(p.name)), false, 'Kühlschrank & Grundausstattung werden nicht gebucht');

    const { port, aufrufe } = portAttrappe();
    assert.deepEqual(aufrufe, [], 'Plan allein bucht nichts');
    const ergebnis = await kochenBestaetigen(plan, port);
    assert.deepEqual(aufrufe, plan.map((p) => [p.block_typ_id, p.anzahl]));
    assert.equal(ergebnis.bewegungIds.length, plan.length);
    assert.deepEqual(ergebnis.fehler, []);
  });

  test('der Nutzer kann Posten abwählen; Fehler einzelner Posten werden gemeldet', async () => {
    const { port, aufrufe } = portAttrappe([3]);
    const ergebnis = await kochenBestaetigen(
      [{ block_typ_id: 3, name: 'Linsen gekocht', anzahl: 2 }, { block_typ_id: 9, name: 'Wrap', anzahl: 0 }, { block_typ_id: 1, name: 'Tomatensoße', anzahl: 1 }],
      port,
    );
    assert.deepEqual(aufrufe, [[3, 2], [1, 1]], 'Anzahl 0 = abgewählt');
    assert.deepEqual(ergebnis.fehler, [{ name: 'Linsen gekocht', meldung: 'Nur noch 1× da' }]);
    assert.deepEqual(ergebnis.bewegungIds, [101]);
  });
});

describe('Rezept speichern', () => {
  test('Datensatz enthält das geprüfte Gericht vollständig', async () => {
    const e = await erzeugeVorschlaege(regelbasiert(), anfrage(), { id: ids() });
    const r = rezeptDatensatz(e.gerichte[0]);
    assert.equal(r.name, e.gerichte[0].name);
    assert.deepEqual(r.daten.zutaten, e.gerichte[0].zutaten);
    assert.equal(typeof r.daten.kosten.pro_portion_cent, 'number');
  });
});
