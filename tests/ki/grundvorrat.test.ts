// Grundvorrat als Sorten anlegen (scripts/grundvorrat.ts): richtige Bausteine, gültige Stammdaten,
// nichts doppelt – und mit diesem Vorrat sind alle Grundrezepte kochbar.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GRUNDVORRAT, planeGrundvorrat } from '../../scripts/grundvorrat.ts';
import { bausteineFuerName } from '../../supabase/functions/_shared/kombi/grundbausteine.ts';
import { grundrezepteFuer } from '../../supabase/functions/_shared/kombi/grundrezepte.ts';
import { baueSnapshot, GRUNDAUSSTATTUNG, type BestandZeile } from '../../supabase/functions/_shared/kombi/snapshot.ts';
import { ids, OPTIONEN } from './fixtures.ts';

describe('Grundvorrat anlegen', () => {
  test('jede Sorte ist genau ihr Grundbaustein', () => {
    assert.deepEqual(GRUNDVORRAT.map((s) => [s.name, bausteineFuerName(s.name, s.farbe).map((b) => b.id)]), [
      ['Nudeln', ['nudeln']], ['Reis', ['reis']], ['Lasagneplatten', ['lasagneplatten']], ['Haferflocken', ['haferflocken']],
      ['Mehl', ['mehl']], ['Kartoffeln', ['kartoffeln']], ['Rote Linsen, trocken', ['rote_linsen']],
      ['Braune Linsen, trocken', ['braune_linsen']], ['Kichererbsen, trocken', ['kichererbsen_trocken']],
      ['Kidneybohnen, trocken', ['kidneybohnen_trocken']], ['Sojagranulat', ['sojagranulat']],
      ['Passierte Tomaten', ['passierte_tomaten']], ['Gehackte Tomaten', ['gehackte_tomaten']], ['Tomatenmark', ['tomatenmark']],
      ['Mais', ['mais']], ['Kokosmilch', ['kokosmilch']], ['Brot', ['brot']], ['Brötchen', ['broetchen']],
      ['Margherita-Pizza', ['margherita_pizza']], ['Tomaten-Gemüse-Basis', ['tomaten_gemuese_basis']],
      ['Linsen-Bolognese-Basis', ['linsen_bolognese_basis']], ['Neutrale Gemüse-Basis', ['neutrale_gemuese_basis']],
      ['Gekochte Kichererbsen', ['gekochte_kichererbsen']], ['Gekochte Kidneybohnen', ['gekochte_kidneybohnen']],
      ['Gekochte Linsen', ['gekochte_linsen']], ['TK-Gemüse', ['tk_gemuese']],
    ]);
  });

  test('Stammdaten erfüllen die Regeln der Datenbank; Grundausstattung wird nicht als Vorrat geführt', () => {
    assert.equal(new Set(GRUNDVORRAT.map((s) => s.name)).size, GRUNDVORRAT.length, 'Namen eindeutig');
    for (const s of GRUNDVORRAT) {
      assert.ok(s.groesse_g > 0 && s.haltbar_tage > 0 && s.portion_menge > 0, s.name);
      if (s.einheit === 'portion') assert.equal(s.portion_menge, 1, s.name);
      assert.ok(s.zusammensetzung === null || s.zusammensetzung.length >= 1, s.name);
      assert.ok(!GRUNDAUSSTATTUNG.some((g) => g === s.name), s.name);
    }
  });

  test('nichts doppelt: gleicher Name oder derselbe Grundbaustein wird übersprungen – Produkte nur bei gleichem Namen', () => {
    const plan = planeGrundvorrat([
      { id: 1, name: 'Linsen gekocht', farbe: 'braun' }, { id: 2, name: 'Kichererbsen', farbe: 'braun' },
      { id: 3, name: 'Tomatensoße', farbe: 'rot' }, { id: 4, name: 'Brötchen', farbe: 'gelb' },
      { id: 5, name: 'Pizza', farbe: 'blau' }, { id: 6, name: 'TK-Spinat', farbe: 'gruen' },
    ]);
    assert.deepEqual(plan.schonDa.map((x) => [x.sorte.name, x.als]), [
      ['Brötchen', 'Brötchen'], ['Tomaten-Gemüse-Basis', 'Tomatensoße'], ['Gekochte Kichererbsen', 'Kichererbsen'], ['Gekochte Linsen', 'Linsen gekocht'],
    ]);
    assert.ok(plan.anlegen.some((s) => s.name === 'Margherita-Pizza'), 'selbst gemachte Pizza ist ein eigenes Produkt');
    assert.ok(plan.anlegen.some((s) => s.name === 'TK-Gemüse'), 'TK-Spinat ist kein allgemeines TK-Gemüse');
    assert.equal(planeGrundvorrat(GRUNDVORRAT.map((s, i) => ({ id: i, name: s.name, farbe: s.farbe }))).anlegen.length, 0, 'zweimal ausführen legt nichts doppelt an');
  });

  test('mit diesem Grundvorrat (eingebucht) sind alle 25 Grundrezepte direkt kochbar', () => {
    const bestand: BestandZeile[] = GRUNDVORRAT.map((s, i) => ({
      id: 500 + i, name: s.name, farbe: s.farbe, art: s.art, herkunft: s.herkunft, einheit: s.einheit, portion_menge: s.portion_menge,
      groesse_g: s.groesse_g, lagerort: s.lagerort, zusammensetzung: s.zusammensetzung, bald_ablaufen: false,
      anzahl: s.einheit === 'g' ? 2000 : s.einheit === 'stueck' ? 6 : 6,
    }));
    const stand = grundrezepteFuer(baueSnapshot(bestand, '', '2026-10-15'), OPTIONEN, ids());
    assert.equal(stand.length, 25);
    assert.deepEqual(stand.filter((s) => !s.kochbar).map((s) => `${s.rezept.id}: ${s.gericht.fehlt.map((f) => f.name).join(', ')}`), []);
  });
});
