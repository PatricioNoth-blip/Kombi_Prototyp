// KI-Benchmark: 30 Szenarien, automatische Prüfungen – und keine Punkte für Erfundenes.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SZENARIEN } from '../../scripts/benchmark/szenarien.ts';
import { fasseZusammen, halluzinierer, istGenerisch, messe, zaehleHalluzinationen, anfrageFuer } from '../../scripts/benchmark/messung.ts';
import { regelbasiert } from '../../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';

describe('KI-Benchmark', () => {
  test('30 reproduzierbare Szenarien mit eindeutigen ids – Zutaten, Komponenten, Komplettgerichte, Reste, Woche, Komponenten-Ideen', () => {
    assert.equal(SZENARIEN.length, 30);
    assert.equal(new Set(SZENARIEN.map((s) => s.id)).size, 30);
    assert.ok(SZENARIEN.some((s) => s.aufgabe === 'komponenten') && SZENARIEN.some((s) => s.aufgabe === 'woche') && SZENARIEN.some((s) => s.modus?.art === 'reste'));
  });

  test('Halluzinationen werden in der Rohantwort gezählt: Zutat, Menge, Preis, kcal, Bestandsmenge, Bild-URL', async () => {
    const s = SZENARIEN.find((x) => x.id === 'frisch-bowl')!;
    const roh = await halluzinierer().vorschlagen({ ...anfrageFuer(s), leitplanken: undefined as never, notfall: false });
    const h = zaehleHalluzinationen(roh, anfrageFuer(s).snapshot);
    assert.ok(h.zutaten >= 2, 'b999 und Rinderfilet');
    assert.ok(h.mengen >= 1, '99 Portionen');
    assert.ok(h.preise >= 1 && h.naehrwerte >= 1 && h.bestand >= 1 && h.bildquellen >= 1, JSON.stringify(h));
  });

  test('fair: die halluzinierende Attrappe liegt weit hinter den Regeln – Erfundenes bringt keine Punkte', async () => {
    const auswahl = SZENARIEN.filter((s) => ['frisch-bowl', 'baukasten', 'ablauf', 'pizza-unbekannt', 'leer'].includes(s.id));
    const messungen = [];
    for (const s of auswahl) {
      messungen.push(await messe(regelbasiert(), s));
      messungen.push(await messe(halluzinierer(), s));
    }
    const [erster, zweiter] = fasseZusammen(messungen);
    assert.equal(erster.anbieter, 'regelbasiert');
    assert.equal(zweiter.anbieter, 'attrappe:halluzinierer');
    assert.ok(erster.punkte > zweiter.punkte + 40, `${erster.punkte} vs. ${zweiter.punkte}`);
    assert.equal(erster.halluzinationen, 0);
    assert.ok(zweiter.halluzinationen > 20);
  });

  test('Regeln: in allen 30 Szenarien keine erfundenen Fakten; „Nichts erzwingen“ wird belohnt', async () => {
    for (const s of SZENARIEN) {
      const m = await messe(regelbasiert(), s);
      const h = m.erfundene_zutaten + m.erfundene_mengen + m.erfundene_preise + m.erfundene_naehrwerte + m.bestandsbehauptungen + m.erfundene_bildquellen;
      assert.equal(h, 0, `${s.id}: ${JSON.stringify(m)}`);
      assert.ok(m.json_gueltig && m.schema_gueltig, s.id);
      if (s.id === 'leer' || s.id === 'reste-nichts') assert.equal(m.punkte, 100, s.id);
    }
  });

  test('normale Zutaten werden unterstützt: frische Bowl, Auflauf, Toast, Frühstück, Kühlschrank-Reste', async () => {
    for (const id of ['frisch-bowl', 'auflauf', 'toast', 'fruehstueck', 'kuehlschrank', 'ablauf']) {
      const m = await messe(regelbasiert(), SZENARIEN.find((s) => s.id === id)!);
      assert.ok(m.bestanden >= 1, `${id}: kein Gericht`);
      assert.equal(m.anteil_vorhanden, 1, `${id}: alles aus dem Vorrat`);
    }
    const ablauf = await messe(regelbasiert(), SZENARIEN.find((s) => s.id === 'ablauf')!);
    assert.equal(ablauf.dringend_genutzt, 1, 'Spinat und geöffneter Joghurt werden verwertet');
  });

  test('generische Namen werden erkannt', () => {
    for (const n of ['Tomaten-Pasta', 'Gemüse-Reis', 'Joghurt-Bowl', 'Pasta mit Gemüse', 'Reis mit Linsen und Spinat']) assert.ok(istGenerisch(n), n);
    for (const n of ['Rote Samt-Pasta', 'Sommer-Crunch mit Joghurt', 'Knusper-Falafel mit Gurke', 'Überbackene Brokkoli-Pasta']) assert.ok(!istGenerisch(n), n);
  });
});
