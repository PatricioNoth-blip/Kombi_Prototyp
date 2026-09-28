// Oberfläche ohne Browser: Navigation (Zustand beim Wechsel), Vorrat-Übersicht, Eingaben.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BEREICHE, hashVon, ladeNav, navigiere, neuerEintrag, routeAus, speichereNav, START, type NavZustand } from '../../src/navigation.ts';
import { dringendHeute, gruss, heuteGekocht, monatsbilanz, sinnvolleProduktion, startReihenfolge } from '../../src/startseite.ts';
import type { KomponentenVorschlag } from '../../supabase/functions/_shared/kombi/typen.ts';
import { freieTage, fuellstand, heuteWichtig, ortKacheln, sortenFuer, tagName, vorratswert, zustand } from '../../src/dashboard.ts';
import type { Sorte } from '../../src/api.ts';
import { leseEingabe } from '../../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { reserviertAusser } from '../../supabase/functions/_shared/kombi/planung.ts';

const HEUTE = '2026-09-27';

function sorte(id: number, name: string, teil: Partial<Sorte> = {}): Sorte {
  return {
    id, name, farbe: 'rot', anzahl: 4, mindestbestand: 0, nachkochen: false, aelteste: null, bald_ablaufen: false,
    haltbar_tage: 90, groesse_g: 150, kosten_cent: null, lagerort: 'gefrierfach', art: 'komponente', einheit: 'portion',
    portion_menge: 1, kosten_menge: 1, abgelaufen: 0, geoeffnet: 0, ...teil,
  };
}

describe('Navigation: fünf Bereiche, Zustand, Adressen, Zurück', () => {
  test('alle fünf Hauptbereiche sind erreichbar; die App startet mit „Start“', () => {
    assert.deepEqual(BEREICHE.map((b) => b.id), ['start', 'essen', 'vorrat', 'produktion', 'einkauf']);
    assert.equal(START.bereich, 'start');
    for (const b of BEREICHE) assert.equal(navigiere(START, { typ: 'wechsle', bereich: b.id, scroll: 0 }).bereich, b.id);
  });

  test('geöffneter Lagerort und Filter bleiben beim Wechsel erhalten, Scrollposition je Bereich', () => {
    let z: NavZustand = navigiere(START, { typ: 'wechsle', bereich: 'vorrat', scroll: 0 });
    z = navigiere(z, { typ: 'vorrat', teil: { ort: 'gefrierfach' } });
    z = navigiere(z, { typ: 'vorrat', teil: { art: 'komponente' } });
    z = navigiere(z, { typ: 'wechsle', bereich: 'essen', scroll: 420 });
    z = navigiere(z, { typ: 'essen', teil: { ansicht: 'woche' } });
    z = navigiere(z, { typ: 'wechsle', bereich: 'produktion', scroll: 90 });
    z = navigiere(z, { typ: 'wechsle', bereich: 'vorrat', scroll: 0 });
    assert.deepEqual([z.vorrat.ort, z.vorrat.art, z.scroll.vorrat, z.scroll.essen, z.essen.ansicht], ['gefrierfach', 'komponente', 420, 90, 'woche']);
  });

  test('nochmal auf den aktiven Reiter → zurück zum Anfang des Bereichs; Wechsel schließt Details', () => {
    let z = navigiere(START, { typ: 'route', route: routeAus('#/vorrat/kuehlschrank?sorte=4') });
    assert.equal(z.sorte, 4);
    z = navigiere(z, { typ: 'wechsle', bereich: 'vorrat', scroll: 300 });
    assert.deepEqual([z.vorrat.ort, z.sorte, z.scroll.vorrat], [null, null, 0]);
  });

  test('Deep Links: Adresse ↔ Zustand, Unbekanntes führt zum Start, alte Adresse „komponenten“ → Produktion', () => {
    const r = routeAus('#/vorrat/gefrierfach?art=komponente&sorte=12');
    assert.deepEqual(r, { bereich: 'vorrat', ort: 'gefrierfach', art: 'komponente', ansicht: 'heute', sorte: 12 });
    const z = navigiere(START, { typ: 'route', route: r });
    assert.equal(hashVon(z), '#/vorrat/gefrierfach?art=komponente&sorte=12');
    assert.equal(hashVon(navigiere(START, { typ: 'route', route: routeAus('#/essen/woche') })), '#/essen/woche');
    assert.equal(routeAus('#/komponenten').bereich, 'produktion');
    assert.equal(routeAus('#/admin/x').bereich, 'start');
    assert.equal(routeAus('#/vorrat/keller?art=x&sorte=-1').ort, null);
    assert.equal(routeAus('').bereich, 'start');
    for (const h of ['#/start', '#/essen', '#/vorrat', '#/vorrat/alle', '#/produktion', '#/einkauf', '#/einkauf?sorte=3']) {
      assert.equal(hashVon(navigiere(START, { typ: 'route', route: routeAus(h) })), h, h);
    }
  });

  test('Zurück: Bereich, Lagerort und geöffnete Details bekommen einen Verlaufseintrag, Filter nicht', () => {
    const vorrat = navigiere(START, { typ: 'wechsle', bereich: 'vorrat', scroll: 0 });
    const ort = navigiere(vorrat, { typ: 'vorrat', teil: { ort: 'gefrierfach' } });
    const filter = navigiere(ort, { typ: 'vorrat', teil: { art: 'zutat' } });
    const detail = navigiere(filter, { typ: 'sorte', id: 5 });
    assert.equal(neuerEintrag(START, vorrat), true);
    assert.equal(neuerEintrag(vorrat, ort), true);
    assert.equal(neuerEintrag(ort, filter), false);
    assert.equal(neuerEintrag(filter, detail), true);
    // Zurück = die vorige Adresse wird wieder angewendet
    const zurueck = navigiere(detail, { typ: 'route', route: routeAus(hashVon(filter)) });
    assert.deepEqual([zurueck.bereich, zurueck.vorrat.ort, zurueck.vorrat.art, zurueck.sorte], ['vorrat', 'gefrierfach', 'zutat', null]);
  });

  test('beim Öffnen immer Start (außer ein Link zeigt woandershin); alte Speicherstände sind kein Problem', () => {
    assert.equal(ladeNav(speichereNav(navigiere(START, { typ: 'wechsle', bereich: 'einkauf', scroll: 0 }))).bereich, 'start');
    assert.equal(ladeNav('bestand').bereich, 'start');
    assert.equal(ladeNav('{kaputt').bereich, 'start');
    assert.equal(ladeNav(null, '#/einkauf').bereich, 'einkauf');
    assert.equal(ladeNav(JSON.stringify({ bereich: 'komponenten', essen: { ansicht: 'woche' } })).essen.ansicht, 'woche');
  });
});

describe('Startseite', () => {
  const HEUTE_S = '2026-09-28';
  const e = (erstellt_am: string, preis_cent: number | null, rueckgaengig = false) => ({ erstellt_am, preis_cent, rueckgaengig });
  const m = (datum: string, kosten_cent: number | null, kosten_unbekannt = 0, kcal: number | null = null, kcal_unbekannt = 1) =>
    ({ datum, titel: 'x', portionen: 2, kosten_cent, kosten_unbekannt, kcal, kcal_unbekannt, rueckgaengig: false });

  test('Ausgaben diesen Monat: nur tatsächlich Bezahltes; Rückgängiges und Vormonat zählen nicht', () => {
    const b = monatsbilanz({
      einkaeufe: [e('2026-09-03T10:00:00Z', 2980), e('2026-09-20T10:00:00Z', 2300), e('2026-09-21T10:00:00Z', null),
        e('2026-09-22T10:00:00Z', 999, true), e('2026-08-30T10:00:00Z', 5000)],
      herstellungen: [], mahlzeiten: [],
    }, HEUTE_S);
    assert.deepEqual(b.ausgegeben, { cent: 5280, anzahl: 3, ohne_preis: 1 });
    assert.equal(b.monat, 'September');
  });

  test('keine Doppelzählung: Produktion und Gekochtes sind Warenwert, nicht Teil der Ausgaben', () => {
    // 3,00 € Tomaten gekauft → 1,44 € davon zu Tomaten-Basis verarbeitet → 2 Portionen (0,48 €) gegessen
    const b = monatsbilanz({
      einkaeufe: [e('2026-09-10T10:00:00Z', 300)],
      herstellungen: [{ datum: '2026-09-10', kosten_cent: 144, kosten_unbekannt: 0, rueckgaengig: false }],
      mahlzeiten: [m('2026-09-11', 48)],
    }, HEUTE_S);
    assert.equal(b.ausgegeben.cent, 300, 'Ausgaben bleiben 3,00 € – nicht 3,00 + 1,44 + 0,48');
    assert.deepEqual(b.produktion, { cent: 144, anzahl: 1, vollstaendig: true });
    assert.deepEqual([b.gekocht.cent, b.gekocht.pro_mahlzeit_cent], [48, 48]);
  });

  test('Ø pro Mahlzeit nur, wenn für jede Mahlzeit alle Preise bekannt sind', () => {
    const voll = monatsbilanz({ einkaeufe: [], herstellungen: [], mahlzeiten: [m('2026-09-11', 120), m('2026-09-12', 86)] }, HEUTE_S);
    assert.equal(voll.gekocht.pro_mahlzeit_cent, 103);
    const teil = monatsbilanz({ einkaeufe: [], herstellungen: [], mahlzeiten: [m('2026-09-11', 120), m('2026-09-12', 40, 1)] }, HEUTE_S);
    assert.deepEqual([teil.gekocht.cent, teil.gekocht.vollstaendig, teil.gekocht.pro_mahlzeit_cent], [160, false, null]);
    assert.equal(monatsbilanz({ einkaeufe: [], herstellungen: [], mahlzeiten: [] }, HEUTE_S).leer, true);
  });

  test('„Heute gekocht“: kcal nur, wenn sie erfasst und vollständig bekannt sind', () => {
    assert.deepEqual(heuteGekocht([m(HEUTE_S, 48, 0, 1240, 0)], HEUTE_S), { titel: ['x'], kcal: 1240, vollstaendig: true });
    assert.equal(heuteGekocht([m(HEUTE_S, 48, 0, 600, 1)], HEUTE_S).kcal, null);
    assert.equal(heuteGekocht([m('2026-09-27', 48, 0, 600, 0)], HEUTE_S).titel.length, 0, 'nur heute');
  });

  test('Reihenfolge: Dringendes nach oben, sonst Essen zuerst; leere Bereiche entfallen', () => {
    assert.deepEqual(startReihenfolge({ dringend: true, wichtig: 2, produktion: true, einkauf: true, geld: true }),
      ['wichtig', 'essen', 'geld', 'produktion', 'einkauf']);
    assert.deepEqual(startReihenfolge({ dringend: false, wichtig: 1, produktion: false, einkauf: true, geld: false }),
      ['essen', 'wichtig', 'einkauf']);
    assert.deepEqual(startReihenfolge({ dringend: false, wichtig: 0, produktion: false, einkauf: false, geld: false }), ['essen']);
  });

  test('dringend: abgelaufen, aufgetaut, läuft heute/morgen ab, Auftauen fällig – „noch 3 Tage“ nicht', () => {
    assert.equal(dringendHeute([sorte(1, 'A', { abgelaufen: 1 })], HEUTE_S, 0), true);
    assert.equal(dringendHeute([sorte(2, 'B', { aufgetaut: 1 })], HEUTE_S, 0), true);
    assert.equal(dringendHeute([sorte(3, 'C', { bald_ablaufen: true, naechster_ablauf: '2026-09-29' })], HEUTE_S, 0), true);
    assert.equal(dringendHeute([sorte(4, 'D', { bald_ablaufen: true, naechster_ablauf: '2026-10-01' })], HEUTE_S, 0), false);
    assert.equal(dringendHeute([], HEUTE_S, 1), true);
  });

  test('Gruß nach Tageszeit', () => {
    assert.deepEqual([6, 12, 19, 2].map(gruss), ['Guten Morgen', 'Guten Tag', 'Guten Abend', 'Gute Nacht']);
  });

  test('Produktion nur, wenn sinnvoll: vorgemerkt & alles da, sonst Idee, die Dringendes verwertet – sonst nichts', () => {
    const idee = (typ: 'verwerten' | 'neu', verwertet: string[]) => ({ typ, verwertet, name: 'I' }) as unknown as KomponentenVorschlag;
    assert.equal(sinnvolleProduktion([{ plan_id: 'p', titel: 'Tomaten-Basis', portionen: 6, alles_da: true }], [])!.art, 'vorgemerkt');
    assert.equal(sinnvolleProduktion([{ plan_id: 'p', titel: 'T', portionen: 6, alles_da: false }], [idee('verwerten', ['Tomaten'])])!.art, 'idee');
    assert.equal(sinnvolleProduktion([], [idee('neu', ['Tomaten']), idee('verwerten', [])]), null, 'kein Füllmaterial');
  });
});

describe('Vorrat als Übersicht', () => {
  test('„Heute wichtig“: jede Sorte einmal, dringendster Zustand zuerst', () => {
    const bestand = [
      sorte(1, 'Joghurt', { abgelaufen: 1, geoeffnet: 1, lagerort: 'kuehlschrank', art: 'zutat' }),
      sorte(2, 'Lasagne', { aufgetaut: 2, farbe: 'blau', art: 'komplettgericht' }),
      sorte(3, 'Spaghetti', { geoeffnet: 1, lagerort: 'vorrat', art: 'zutat', einheit: 'g', anzahl: 380 }),
      sorte(4, 'Linsen-Bolognese', { bald_ablaufen: true, naechster_ablauf: '2026-09-29' }),
      sorte(5, 'Tomatensoße', { nachkochen: true, anzahl: 1, mindestbestand: 3 }),
      sorte(6, 'Reis', { anzahl: 0, nachkochen: true, mindestbestand: 1, art: 'zutat' }),
      sorte(7, 'Pizza', {}),
    ];
    const w = heuteWichtig(bestand, HEUTE);
    assert.deepEqual(w.map((x) => [x.sorte.name, x.art]), [
      ['Joghurt', 'abgelaufen'], ['Lasagne', 'aufgetaut'], ['Spaghetti', 'geoeffnet'], ['Linsen-Bolognese', 'bald'],
      ['Reis', 'niedrig'], ['Tomatensoße', 'niedrig'],
    ]);
    assert.equal(w[3].text, 'noch 2 Tage');
    assert.equal(zustand(bestand[5], HEUTE)!.text, 'leer · nachkaufen');
    assert.equal(zustand(bestand[4], HEUTE)!.text, 'nur 1 Portion · nachkochen');
    assert.equal(zustand(bestand[6], HEUTE), null);
  });

  test('Lagerort-Kacheln: Gefrierfach in Portionen, sonst Artikel; Farbanteile summieren sich zu 1', () => {
    const bestand = [
      sorte(1, 'Pizza', { farbe: 'blau', anzahl: 4 }),
      sorte(2, 'Linsen', { farbe: 'braun', anzahl: 6 }),
      sorte(3, 'Erbsen', { farbe: 'gruen', einheit: 'g', portion_menge: 150, anzahl: 750 }),
      sorte(4, 'Wrap', { anzahl: 0 }),
      sorte(5, 'Joghurt', { lagerort: 'kuehlschrank', anzahl: 2, bald_ablaufen: true }),
      sorte(6, 'Spaghetti', { lagerort: 'vorrat', einheit: 'g', anzahl: 380 }),
      sorte(7, 'Reis', { lagerort: 'vorrat', anzahl: 0 }),
    ];
    const [gf, ks, vr] = ortKacheln(bestand, HEUTE);
    assert.deepEqual([gf.zahl, gf.einheit, gf.sorten, gf.leer], [15, 'Portionen', 4, 1]); // 4 + 6 + 5
    assert.deepEqual([ks.zahl, ks.einheit, ks.achtung], [1, 'Artikel', 1]);
    assert.deepEqual([vr.zahl, vr.leer], [1, 1]);
    assert.ok(Math.abs(gf.farben.reduce((a, f) => a + f.anteil, 0) - 1) < 1e-9);
    assert.deepEqual(gf.farben.map((f) => f.farbe), ['braun', 'gruen', 'blau']);
  });

  test('Füllstand „6 / 8 Portionen“ aus der Startmenge; ohne Bezug kein erfundener Balken', () => {
    assert.deepEqual(fuellstand(sorte(1, 'A', { anzahl: 6, start_menge: 8 })), { anteil: 0.75, text: '6 / 8 Portionen' });
    assert.equal(fuellstand(sorte(2, 'B', { einheit: 'g', anzahl: 375, start_menge: 500 }))!.text, '375 / 500 g');
    assert.equal(fuellstand(sorte(3, 'C', { anzahl: 1, mindestbestand: 2 }))!.anteil, 0.25);
    assert.equal(fuellstand(sorte(4, 'D', { anzahl: 3 })), null);
  });

  test('Vorratswert nur aus bekannten Preisen; Abgelaufenes zählt nicht', () => {
    const w = vorratswert([
      sorte(1, 'Pizza', { anzahl: 4, kosten_cent: 200, kosten_menge: 4 }),
      sorte(2, 'Spaghetti', { einheit: 'g', anzahl: 250, kosten_cent: 129, kosten_menge: 500 }),
      sorte(3, 'Joghurt', { anzahl: 2, abgelaufen: 2, kosten_cent: 45 }),
      sorte(4, 'Linsen', { anzahl: 3 }),
    ]);
    assert.deepEqual(w, { cent: 265, ohne_preis: 1 }); // 200 + 64,5 → 265
  });

  test('Lagerort-Ansicht: Filter nach Art und Suche (auch in der Zusammensetzung), Vorhandenes zuerst', () => {
    const bestand = [
      sorte(1, 'Burrito', { farbe: 'blau', art: 'komplettgericht', zusammensetzung: ['Tortilla', 'Kidneybohnen'] }),
      sorte(2, 'Bohnen', { art: 'zutat', anzahl: 0 }),
      sorte(3, 'Äpfel', { art: 'zutat', lagerort: 'kuehlschrank' }),
      sorte(4, 'Chili', { art: 'komponente', bald_ablaufen: true }),
    ];
    assert.deepEqual(sortenFuer(bestand, { ort: 'gefrierfach', art: null, suche: '' }, HEUTE).map((s) => s.name), ['Chili', 'Burrito', 'Bohnen']);
    assert.deepEqual(sortenFuer(bestand, { ort: 'alle', art: null, suche: 'bohne' }, HEUTE).map((s) => s.name), ['Burrito', 'Bohnen']);
    assert.deepEqual(sortenFuer(bestand, { ort: 'alle', art: 'zutat', suche: 'apfel' }, HEUTE).map((s) => s.name), ['Äpfel']);
  });
});

describe('Eingaben und Reservierungen für die Oberfläche', () => {
  test('Tage: „Heute“, „Morgen“, Wochentag; Woche planen überspringt belegte Tage', () => {
    assert.equal(tagName(HEUTE, '2026-09-27'), 'Heute');
    assert.equal(tagName(HEUTE, '2026-09-28'), 'Morgen');
    assert.equal(tagName(HEUTE, '2026-09-30'), 'Mi 30.09.');
    assert.equal(tagName(HEUTE, '2026-10-02'), 'Fr 02.10.');
    assert.deepEqual(freieTage(HEUTE, ['2026-09-28', null, '2026-09-30'], 3), ['2026-09-27', '2026-09-29', '2026-10-01']);
  });

  test('Einkauf von Hand: „500 g Zwiebeln“, „1,5 kg“, „2 Paprika“, „Basilikum“', () => {
    assert.deepEqual(leseEingabe('500 g Zwiebeln'), { name: 'Zwiebeln', menge: 500, einheit: 'g' });
    assert.deepEqual(leseEingabe('1,5 kg Kartoffeln'), { name: 'Kartoffeln', menge: 1500, einheit: 'g' });
    assert.deepEqual(leseEingabe('0.5 l Milch'), { name: 'Milch', menge: 500, einheit: 'ml' });
    assert.deepEqual(leseEingabe('2 Paprika'), { name: 'Paprika', menge: 2, einheit: 'stueck' });
    assert.deepEqual(leseEingabe('3 Portionen Tomatensoße'), { name: 'Tomatensoße', menge: 3, einheit: 'portion' });
    assert.deepEqual(leseEingabe('  Basilikum '), { name: 'Basilikum', menge: null, einheit: null });
  });

  test('Kochansicht: nur was ANDERE Pläne reserviert haben, mit ihren Namen', () => {
    const proPlan = new Map([
      ['a', [{ block_typ_id: 1, reserviert: 2 }, { block_typ_id: null, reserviert: 0 }]],
      ['b', [{ block_typ_id: 1, reserviert: 1 }, { block_typ_id: 2, reserviert: 0 }]],
    ]);
    const plaene = [{ id: 'a', titel: 'Lasagne' }, { id: 'b', titel: 'Wraps' }];
    assert.deepEqual([...reserviertAusser(proPlan, plaene, null)], [[1, { menge: 3, plaene: ['Lasagne', 'Wraps'] }]]);
    assert.deepEqual([...reserviertAusser(proPlan, plaene, 'a')], [[1, { menge: 1, plaene: ['Wraps'] }]]);
  });
});
