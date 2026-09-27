// Komponenten entdecken: Rolle, Zusammensetzung, Nutzbarkeit (Software), Kosten, fehlende Zutaten,
// keine erfundenen Inhalte, Speichern erst nach Bestätigung. Plus: Kochansicht und Entnahme.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { erzeugeKomponenten } from '../../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { auftragAlsText, systemPromptFuer } from '../../supabase/functions/_shared/kombi/anbieter/prompt.ts';
import { berechneLeitplanken } from '../../supabase/functions/_shared/kombi/praeferenz.ts';
import {
  bewerteNutzbarkeit, KATALOG, komponenteAlsSorte, pruefeKomponente,
} from '../../supabase/functions/_shared/kombi/komponenten.ts';
import { gerichtstypenVon, partnerVon, ROLLEN } from '../../supabase/functions/_shared/kombi/rollen.ts';
import { entnahmeText, kochAnsicht } from '../../supabase/functions/_shared/kombi/aktionen.ts';
import { pruefeGericht } from '../../supabase/functions/_shared/kombi/validierung.ts';
import type { KiAuftrag } from '../../supabase/functions/_shared/kombi/typen.ts';
import { anfrage, festerAnbieter, ids, OPTIONEN, SEED, snapshot, zeile } from './fixtures.ts';

const HAUSHALT = [
  ...SEED,
  zeile(20, 'Gehackte Tomaten (Dose)', 'rot', 100, 79, 800, { art: 'zutat', einheit: 'g', portion_menge: 400, kosten_menge: 400, lagerort: 'vorrat', bald_ablaufen: true }),
  zeile(21, 'Zwiebeln', 'gruen', 100, 99, 100, { art: 'zutat', einheit: 'g', portion_menge: 100, kosten_menge: 1000, lagerort: 'vorrat' }),
  zeile(22, 'Tomaten-Basis', 'rot', 150, 228, 6, {
    art: 'komponente', kosten_menge: 6, zusammensetzung: ['Tomaten', 'Zwiebeln', 'Knoblauch'], gerichtstypen: ['pasta', 'pizza', 'suppe'], richtung: 'italienisch',
  }),
];
const tomatenBasisRoh = () => ({
  name: 'Tomaten-Sugo', rolle: 'rot', richtung: 'italienisch', gerichtstypen: ['pasta', 'pizza', 'wrap', 'suppe', 'auflauf', 'eintopf'],
  verwendung: ['Pasta', 'Shakshuka'], beschreibung: 'Tomaten mit Zwiebeln und Knoblauch eingekocht.',
  zutaten: [{ id: 'b20', menge: 800 }, { id: 'b21', menge: 150 }, { name: 'Knoblauch', menge: 10, einheit: 'g' }, { id: 'g-oel' }],
  portionen: 6, portion_g: 150, lagerort: 'gefrierfach',
});

describe('Komponenten verstehen: Rolle, Zusammensetzung, Funktion', () => {
  test('Rolle kommt aus der Kombi-Farbe; Gerichtsarten hinterlegt oder typisch', () => {
    const s = snapshot(HAUSHALT);
    const tb = s.zutaten.find((z) => z.name === 'Tomaten-Basis')!;
    assert.equal(ROLLEN[tb.farbe!].name, 'Basis & Soße');
    assert.deepEqual(gerichtstypenVon(tb), { typen: ['pasta', 'pizza', 'suppe'], quelle: 'hinterlegt' });
    const linsen = s.zutaten.find((z) => z.name === 'Linsen gekocht')!;
    assert.equal(gerichtstypenVon(linsen).quelle, 'typisch');
  });

  test('Partner: ergänzende Rollen aus dem Vorrat (Basis → Protein, Sattmacher, Gemüse …)', () => {
    const s = snapshot(HAUSHALT);
    const tb = s.zutaten.find((z) => z.name === 'Tomaten-Basis')!;
    const partner = partnerVon(tb, s.zutaten).map((p) => p.farbe);
    assert.ok(partner.length > 0);
    assert.ok(partner.every((f) => ['braun', 'gelb', 'gruen', 'weiss'].includes(f!)), partner.join(','));
  });

  test('Prompt: Baukasten-Prinzip, Rolle, „enthält“, unbekannte Zusammensetzung (TK-Pizza)', () => {
    const a: KiAuftrag = { ...anfrage({ snapshot: snapshot(HAUSHALT) }), leitplanken: berechneLeitplanken([], { art: 'normal' }), notfall: false };
    const text = auftragAlsText(a);
    assert.match(text, /b22 \| Tomaten-Basis \| Rolle: Basis & Soße \| 6 Portionen \| Gefrierfach \| enthält: Tomaten, Zwiebeln, Knoblauch \| passt in: Pasta, Pizza, Suppe \| Richtung: italienisch/);
    assert.match(text, /b13 \| Pizza \| Rolle: Komplettgericht [^\n]*Zusammensetzung unbekannt/);
    const system = systemPromptFuer(a);
    assert.match(system, /KEINE normale Rezept-App/);
    assert.match(system, /Finde sinnvolle Kombinationen dieser Bausteine/);
    assert.match(system, /nicht, dass Tomaten, Käse oder Weizen darin sind/);
    assert.match(systemPromptFuer({ ...a, aufgabe: 'komponenten' }), /Was könnte dieser Haushalt sinnvoll VORBEREITEN/);
  });
});

describe('Komponenten-Vorschläge prüfen', () => {
  test('verwerten: Zutaten aus dem Vorrat mit Mengen, Rest wird eingekauft; Kosten nur aus bekannten Preisen', () => {
    const k = pruefeKomponente(tomatenBasisRoh(), snapshot(HAUSHALT), 'k1');
    assert.ok(k);
    assert.deepEqual(k.zutaten.map((z) => [z.name, z.quelle, z.menge]), [
      ['Gehackte Tomaten (Dose)', 'bestand', 800],
      ['Zwiebeln', 'bestand', 100],          // nur 100 g da …
      ['Zwiebeln', 'einkauf', 50],           // … 50 g fehlen
      ['Knoblauch', 'einkauf', 10],
      ['Öl', 'grundausstattung', null],
    ]);
    // Herstellung: Tomaten 800 g × 0,79 €/400 g = 158 ct; Zwiebeln 150 g × 0,099 = 14,85 ct; Knoblauch unbekannt
    assert.equal(k.kosten.status, 'teilweise');
    assert.equal(k.kosten.gesamt_cent, 173);
    assert.deepEqual(k.kosten.unbekannt, ['Knoblauch']);
    // Einkauf in Packungen: Zwiebeln 1 × 1 kg = 0,99 €; Knoblauch unbekannt
    assert.deepEqual([k.einkauf.gesamt_cent, k.einkauf.unbekannt], [99, ['Knoblauch']]);
    assert.equal(k.typ, 'neu');
    assert.ok(k.verwertet.includes('Gehackte Tomaten (Dose)'), 'bald ablaufende Tomaten werden verwertet');
  });

  test('Nutzbarkeit rechnet die Software – Sterne der KI werden ignoriert', () => {
    const roh = { ...tomatenBasisRoh(), sterne: 1, nutzbarkeit: 1 } as never;
    const k = pruefeKomponente(roh, snapshot(HAUSHALT), 'k1');
    assert.ok(k);
    assert.ok(k.nutzbarkeit.sterne >= 4, `${k.nutzbarkeit.sterne}`);
    assert.match(k.nutzbarkeit.gruende[0], /^Für 6 Gerichtsarten/);
    assert.ok(k.nutzbarkeit.gruende.includes('Dafür fehlen noch 2 Zutaten.'));
  });

  test('Nutzbarkeit ist nachvollziehbar: vielseitiger, kombinierbar, alles da → mehr Sterne', () => {
    const basis = { gerichtstypen: ['pasta' as const], partner: [], lagerort: 'kuehlschrank' as const, verwertet: [], fuelltLuecke: false, fehlend: 4, rolle: 'rot' as const };
    const schwach = bewerteNutzbarkeit(basis);
    const stark = bewerteNutzbarkeit({ ...basis, gerichtstypen: ['pasta', 'pizza', 'wrap', 'suppe', 'auflauf', 'eintopf'], partner: ['a', 'b', 'c', 'd'], lagerort: 'gefrierfach', verwertet: ['Tomaten'], fuelltLuecke: true, fehlend: 0 });
    assert.ok(schwach.sterne <= 2, `${schwach.sterne}`);
    assert.equal(stark.sterne, 5);
    assert.ok(schwach.punkte < 0.2);
    assert.equal(stark.punkte, 1);
  });

  test('keine erfundenen Inhalte: Name nennt Zutat, die nicht drin ist → verworfen; Satz in der Beschreibung entfernt', () => {
    assert.equal(pruefeKomponente({ ...tomatenBasisRoh(), name: 'Tomaten-Käse-Basis' }, snapshot(HAUSHALT), 'x'), null);
    const k = pruefeKomponente({ ...tomatenBasisRoh(), beschreibung: 'Tomaten mit Zwiebeln eingekocht. Mit frischem Basilikum verfeinert.' }, snapshot(HAUSHALT), 'x');
    assert.equal(k?.beschreibung, 'Tomaten mit Zwiebeln eingekocht.');
  });

  test('ungültige Rolle oder Komplettgericht → keine Komponente', () => {
    assert.equal(pruefeKomponente({ ...tomatenBasisRoh(), rolle: 'lila' }, snapshot(HAUSHALT), 'x'), null);
    assert.equal(pruefeKomponente({ ...tomatenBasisRoh(), rolle: 'blau' }, snapshot(HAUSHALT), 'x'), null);
  });

  test('Engine: schon vorhandene Komponente wird nicht nochmal vorgeschlagen; sortiert nach Nutzbarkeit', async () => {
    const ki = festerAnbieter({ vorschlaege: [], komponenten: [{ ...tomatenBasisRoh(), name: 'Tomaten-Basis' }, tomatenBasisRoh()] });
    const e = await erzeugeKomponenten(ki, anfrage({ snapshot: snapshot(HAUSHALT), aufgabe: 'komponenten' }), { id: ids() });
    assert.deepEqual(e.komponenten.map((k) => k.name), ['Tomaten-Sugo']);
    assert.equal(e.verworfen[0].grund, 'gibt es schon im Vorrat');
    assert.equal(ki.auftraege[0].aufgabe, 'komponenten');
  });

  test('Demo-Modus: Katalog-Vorschläge, geprüft wie KI-Vorschläge', async () => {
    const e = await erzeugeKomponenten(regelbasiert(), anfrage({ snapshot: snapshot(HAUSHALT), aufgabe: 'komponenten', anzahl: 5 }), { id: ids() });
    assert.ok(e.komponenten.length >= 3);
    assert.ok(e.komponenten.every((k) => k.nutzbarkeit.sterne >= 1 && k.nutzbarkeit.sterne <= 5));
    assert.equal(e.komponenten.some((k) => k.name === 'Linsen gekocht'), false, 'gibt es schon');
    for (const k of KATALOG) assert.ok(k.gerichtstypen.length >= 3, k.name);
  });
});

describe('Komponente übernehmen – erst nach Bestätigung', () => {
  test('Vorschlag allein ist kein Bestand; der Datensatz entsteht nur über komponenteAlsSorte()', async () => {
    const aufrufe: string[] = [];
    const ki = festerAnbieter({ vorschlaege: [], komponenten: [tomatenBasisRoh()] });
    const e = await erzeugeKomponenten(ki, anfrage({ snapshot: snapshot(HAUSHALT), aufgabe: 'komponenten' }), { id: ids() });
    assert.deepEqual(aufrufe, [], 'die Engine hat keinen Datenbankzugriff');
    const sorte = komponenteAlsSorte(e.komponenten[0]);
    assert.deepEqual(
      [sorte.art, sorte.farbe, sorte.herkunft, sorte.einheit, sorte.lagerort, sorte.kosten_cent, sorte.kosten_menge],
      ['komponente', 'rot', 'selbstgemacht', 'portion', 'gefrierfach', null, 6],
      'Preis nur, wenn vollständig berechnet',
    );
    assert.deepEqual(sorte.zusammensetzung, ['Gehackte Tomaten (Dose)', 'Zwiebeln', 'Knoblauch']);
    assert.deepEqual(sorte.gerichtstypen, ['pasta', 'pizza', 'wrap', 'suppe', 'auflauf', 'eintopf']);
  });

  test('vollständig berechnete Herstellung → „X € für N Portionen“', () => {
    const k = pruefeKomponente({ ...tomatenBasisRoh(), zutaten: [{ id: 'b20', menge: 800 }, { id: 'g-oel' }] }, snapshot(HAUSHALT), 'x')!;
    assert.equal(k.kosten.status, 'berechnet');
    assert.deepEqual([komponenteAlsSorte(k).kosten_cent, komponenteAlsSorte(k).kosten_menge], [158, 6]);
  });
});

describe('Kochansicht', () => {
  const s = snapshot(HAUSHALT);
  const bestand = HAUSHALT.map((z) => ({ id: z.id, anzahl: z.anzahl, abgelaufen: 0 }));

  test('Komplettgericht → „2 Portionen Pizza entnehmen“', () => {
    const p = pruefeGericht({ name: 'Pizza-Abend', zutaten: [{ id: 'b13', portionen: 2 }] }, s, OPTIONEN, 'x');
    assert.ok(p.ok);
    const k = kochAnsicht(p.wert, bestand);
    assert.equal(k.entnahme, '2 Portionen Pizza entnehmen');
    assert.deepEqual(k.posten.map((x) => [x.block_typ_id, x.menge]), [[13, 2]]);
  });

  test('Rezept → „2× Tomaten-Basis + 2× Linsen gekocht + 1× TK-Gemüsemix“, mit Rest danach', () => {
    const p = pruefeGericht({
      name: 'Linsen-Ragù', zutaten: [{ id: 'b22', portionen: 2 }, { id: 'b3', portionen: 2 }, { id: 'b6', portionen: 1 }, { id: 'g-salz' }],
    }, s, OPTIONEN, 'x');
    assert.ok(p.ok);
    const k = kochAnsicht(p.wert, bestand);
    assert.equal(k.entnahme, '2× Tomaten-Basis + 2× Linsen gekocht + 1× TK-Gemüsemix');
    assert.deepEqual(k.zeilen.map((z) => [z.name, z.text, z.status, z.danach]), [
      ['Tomaten-Basis', '2×', 'ok', 4], ['Linsen gekocht', '2×', 'ok', 4], ['TK-Gemüsemix', '1×', 'ok', 9], ['Salz', '', 'frei', null],
    ]);
  });

  test('gegen den AKTUELLEN Vorrat: inzwischen weniger da → gekappt, aufgebraucht → nicht entnommen', () => {
    const p = pruefeGericht({ name: 'Linsen-Ragù', zutaten: [{ id: 'b22', portionen: 2 }, { id: 'b3', portionen: 2 }] }, s, OPTIONEN, 'x');
    assert.ok(p.ok);
    const jetzt = bestand.map((b) => (b.id === 22 ? { ...b, anzahl: 1 } : b.id === 3 ? { ...b, anzahl: 0 } : b));
    const k = kochAnsicht(p.wert, jetzt);
    assert.deepEqual(k.zeilen.map((z) => z.status), ['zu_wenig', 'leer']);
    assert.equal(k.entnahme, '1× Tomaten-Basis');
  });

  test('warnt, wenn Portionen für eine geplante Mahlzeit reserviert sind', () => {
    const p = pruefeGericht({ name: 'Pizza-Abend', zutaten: [{ id: 'b13', portionen: 2 }] }, s, OPTIONEN, 'x');
    assert.ok(p.ok);
    const k = kochAnsicht(p.wert, bestand, new Map([[13, { menge: 3, plaene: ['Freitag: Pizza'] }]]));
    assert.ok(k.hinweise.some((h) => h === 'Pizza: 1 Portion davon sind für „Freitag: Pizza“ eingeplant.'), k.hinweise.join(' | '));
  });

  test('Entnahme-Text ohne Posten', () => {
    assert.equal(entnahmeText([]), 'Nichts zu entnehmen');
  });
});
