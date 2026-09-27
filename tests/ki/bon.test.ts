// Bon-Import: Parser, Zuordnung, Rückfragen, Mengen, Kosten, Vorschau, E-Bon (PDF), KI-Prüfung.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { bereinigeZeile, fuegeSeitenZusammen, packungAus, zerlegeBon } from '../../supabase/functions/_shared/kombi/bon/parser.ts';
import { lesbarerName, ordneZu } from '../../supabase/functions/_shared/kombi/bon/abgleich.ts';
import {
  alleFragen, alsNeu, bestandMenge, buchungsDaten, erstelleEntwurf, fingerabdruck, fragenFuer, kostenGebucht, nichtUebernehmen,
  setzeAnzahl, setzeBestandMenge, setzeMengeProEinheit, setzeTyp, vorgeschlageneAnzahl, vorschlaegeAnnehmen, vorschau,
  waehleSorte, type Kontext,
} from '../../supabase/functions/_shared/kombi/bon/vorschlag.ts';
import { pdfText } from '../../supabase/functions/_shared/kombi/bon/pdf.ts';
import { namenFuerPositionen, pruefeBonLesung } from '../../supabase/functions/_shared/kombi/bon/ki.ts';
import type { Gewohnheit, SorteInfo } from '../../supabase/functions/_shared/kombi/bon/typen.ts';

const sorte = (id: number, name: string, einheit: SorteInfo['einheit'], extra: Partial<SorteInfo> = {}): SorteInfo => ({
  id, name, einheit, farbe: 'gruen', art: 'zutat', portion_menge: einheit === 'g' ? 100 : 1, groesse_g: 100,
  lagerort: 'vorrat', herkunft: null, kosten_cent: null, kosten_menge: 1, anzahl: 0, ...extra,
});

const SORTEN: SorteInfo[] = [
  sorte(1, 'Tomaten', 'g', { anzahl: 500 }),
  sorte(2, 'Tomatensoße', 'portion', { art: 'komponente', herkunft: 'selbstgemacht', farbe: 'rot', anzahl: 6 }),
  sorte(3, 'Naturjoghurt', 'g', { lagerort: 'kuehlschrank' }),
  sorte(4, 'Kidneybohnen', 'stueck', { farbe: 'braun', anzahl: 1 }),
  sorte(5, 'Vollkornbrot', 'stueck', { farbe: 'gelb' }),
  sorte(6, 'Bananen', 'g'),
  sorte(7, 'TK-Pizza', 'portion', { art: 'komplettgericht', farbe: 'blau', lagerort: 'gefrierfach' }),
];

const kontext = (gewohnheiten: Gewohnheit[] = [], namen: Record<string, string> = {}): Kontext => ({ sorten: SORTEN, gewohnheiten, namen });

const REWE = `REWE Markt GmbH
Musterstraße 1
50667 Köln
                          EUR
NATUR JOGHURT 500G           2,37 B
  3 Stk x   0,79
TOMATEN 1KG                  1,49 B
KIDNEYBOHNEN 400G            1,78 B
  2 Stk x   0,89
Preisvorteil                -0,30 B
VOLLKORN BROT                1,49 B
BANANE                       1,68 B
  0,842 kg x  1,99 EUR/kg
MINERALWASSER 6X1,5L         1,74 A
PFAND 0,25 EURO              1,50 A *
WASCHMITTEL COLOR            4,99 A
HAFERDRINK BARISTA 1L        1,89 A
--------------------------------------
SUMME                 EUR   18,63
Geg. EC-Cash          EUR   18,63
Datum: 28.09.2026  Uhrzeit: 17:45:12`;

const quelle = { quelle: 'kassenbon' as const, erkennung: 'text' };
const entwurfAus = (text: string, k = kontext()) => erstelleEntwurf(zerlegeBon(text), k, quelle);
const pos = (e: ReturnType<typeof entwurfAus>, text: string) => {
  const p = e.positionen.find((x) => x.bon.text.startsWith(text));
  assert.ok(p, `Position ${text}`);
  return p;
};

describe('Bon lesen (deterministischer Parser)', () => {
  test('einfacher Bon: Artikel, Anzahl, Einzelpreis, Betrag, Händler, Datum, Summe', () => {
    const b = zerlegeBon(REWE);
    assert.equal(b.haendler, 'REWE');
    assert.equal(b.filiale, '50667 Köln');
    assert.equal(b.datum, '2026-09-28');
    assert.equal(b.summe_cent, 1863);
    assert.equal(b.summe_geprueft, 'passt');
    const joghurt = b.positionen[0];
    assert.deepEqual([joghurt.text, joghurt.anzahl, joghurt.einzelpreis_cent, joghurt.gesamtpreis_cent], ['NATUR JOGHURT 500G', 3, 79, 237]);
    assert.deepEqual(joghurt.packung, { menge: 500, einheit: 'g' });
  });

  test('Formate: „2 x 0,79 €“ in der Zeile, Lidl „0,79 x 2“, Aldi-Artikelnummer, führende Anzahl', () => {
    const b = zerlegeBon(`NATUR JOGHURT 500G     2 x 0,79 €   1,58 €
Naturjoghurt 3,5%      0,79 x 2   1,58 A
123456 Joghurt Natur              0,79 A
3 x Kidneybohnen                  2,67 A`);
    assert.deepEqual(b.positionen.map((p) => [p.text, p.anzahl, p.einzelpreis_cent, p.gesamtpreis_cent]), [
      ['NATUR JOGHURT 500G', 2, 79, 158],
      ['Naturjoghurt 3,5%', 2, 79, 158],
      ['Joghurt Natur', 1, 79, 79],
      ['Kidneybohnen', 3, null, 267],
    ]);
    assert.equal(b.positionen[1].typ, 'lebensmittel', '„3,5%“ ist kein Rabatt');
  });

  test('Wiegeware: Gewicht in g, auch wenn der Betrag erst in der Folgezeile steht', () => {
    const b = zerlegeBon(`BANANE 1,68 B
0,842 kg x 1,99 EUR/kg
Äpfel
1,205 kg x 2,49 EUR/kg 3,00 A`);
    assert.deepEqual(b.positionen.map((p) => [p.text, p.gewicht_g, p.gesamtpreis_cent]), [['BANANE', 842, 168], ['Äpfel', 1205, 300]]);
  });

  test('Rabatt direkt unter dem Artikel gehört zu ihm – allgemeine Rabatte bleiben offen', () => {
    const b = zerlegeBon(REWE);
    const bohnen = b.positionen.find((p) => p.text.startsWith('KIDNEY'))!;
    assert.equal(bohnen.rabatt_cent, 30);
    const offen = zerlegeBon(`TOMATEN 1,49\nCoupon 10% auf den Einkauf -0,15\nSUMME 1,34`);
    assert.equal(offen.positionen[0].rabatt_cent, 0);
    assert.equal(offen.positionen[1].typ, 'rabatt');
    assert.match(offen.positionen[1].warnungen[0], /nicht eindeutig zugeordnet/);
    assert.equal(offen.summe_geprueft, 'passt');
  });

  test('Pfand und Leergut sind eigene Geldpositionen, Nicht-Lebensmittel werden erkannt', () => {
    const b = zerlegeBon(`COLA 1,5L 1,29 A\nPFAND 0,25 0,25 A *\nLEERGUT -0,75\nZAHNPASTA 0,95 A\nTRAGETASCHE 0,20 A`);
    assert.deepEqual(b.positionen.map((p) => [p.text, p.typ, p.gesamtpreis_cent]), [
      ['COLA 1,5L', 'lebensmittel', 129], ['PFAND 0,25', 'pfand', 25], ['LEERGUT', 'pfand', -75],
      ['ZAHNPASTA', 'nicht_lebensmittel', 95], ['TRAGETASCHE', 'nicht_lebensmittel', 20],
    ]);
    assert.equal(b.positionen[0].pfand_cent, 25, 'Pfand wird beim Artikel vermerkt');
  });

  test('OCR-Fehler: „O,79“, „l,49“, „1 ,49“ werden gelesen; unplausible Summe wird gemeldet, nicht korrigiert', () => {
    assert.equal(bereinigeZeile('TOMATEN   O,79 B'), 'TOMATEN 0,79 B');
    assert.equal(bereinigeZeile('BROT l,49'), 'BROT 1,49');
    assert.equal(bereinigeZeile('MEHL 1 ,49'), 'MEHL 1,49');
    const b = zerlegeBon(`TOMATEN O,79\nJOGHURT 2 x 0,79 1,68\nSUMME 2,37`);
    assert.equal(b.positionen[0].gesamtpreis_cent, 79);
    assert.match(b.positionen[1].warnungen[0], /2 × 0,79 € ergibt nicht 1,68 €/);
    assert.equal(b.summe_geprueft, 'weicht_ab');
    assert.match(b.warnungen[0], /vermutlich ein Lesefehler/);
  });

  test('langer Bon: 60 Artikel, nichts nach der Summe wird Artikel', () => {
    const zeilen = Array.from({ length: 60 }, (_, i) => `ARTIKEL ${String.fromCharCode(65 + (i % 26))}${i} 1,00 A`);
    const b = zerlegeBon(`LIDL\n${zeilen.join('\n')}\nzu zahlen 60,00\nA 7% 56,07 3,93 60,00\nKartenzahlung 60,00`);
    assert.equal(b.positionen.length, 60);
    assert.equal(b.summe_geprueft, 'passt');
  });

  test('mehrere Fotos: Reihenfolge (Kopf zuerst, Summe zuletzt) und doppelte Bereiche nur einmal', () => {
    const foto1 = ['REWE Markt', '50667 Köln', 'TOMATEN 1KG 1,49 B', 'KIDNEYBOHNEN 0,89 B', 'VOLLKORN BROT 1,49 B'];
    const foto2 = ['KIDNEYBOHNEN 0,89 B', 'VOLLKORN BROT 1,49 B', 'BANANE 1,68 B', 'SUMME EUR 5,55'];
    const zeilen = fuegeSeitenZusammen([foto2, foto1]); // falsch herum fotografiert
    assert.deepEqual(zeilen, ['REWE Markt', '50667 Köln', 'TOMATEN 1KG 1,49 B', 'KIDNEYBOHNEN 0,89 B', 'VOLLKORN BROT 1,49 B', 'BANANE 1,68 B', 'SUMME EUR 5,55']);
    const b = zerlegeBon([foto2, foto1]);
    assert.equal(b.positionen.length, 4);
    assert.equal(b.summe_geprueft, 'passt');
    assert.equal(b.seiten, 2);
  });

  test('eine einzelne gleiche Zeile: die Summe entscheidet, ob doppelt fotografiert oder zweimal gekauft', () => {
    const zweimal = zerlegeBon([['REWE', 'MILCH 0,99'], ['MILCH 0,99', 'SUMME 1,98']]);
    assert.equal(zweimal.positionen.length, 2, 'zweimal gekauft');
    const doppelt = zerlegeBon([['REWE', 'MILCH 0,99', 'BROT 1,49'], ['BROT 1,49', 'SUMME 2,48']]);
    assert.equal(doppelt.positionen.length, 2, 'BROT nur einmal');
    assert.equal(doppelt.summe_geprueft, 'passt');
  });

  test('Packungsgrößen: g, kg, l, ml, cl, Mehrfachpackung, Stück – sonst null (nichts erfinden)', () => {
    assert.deepEqual(packungAus('TOMATEN 1KG'), { menge: 1000, einheit: 'g' });
    assert.deepEqual(packungAus('H-MILCH 1,5L'), { menge: 1500, einheit: 'ml' });
    assert.deepEqual(packungAus('SAHNE 20CL'), { menge: 200, einheit: 'ml' });
    assert.deepEqual(packungAus('WASSER 6X1,5L'), { menge: 9000, einheit: 'ml' });
    assert.deepEqual(packungAus('EIER 10ST'), { menge: 10, einheit: 'stueck' });
    assert.equal(packungAus('BIO NATJOG 500'), null);
  });
});

describe('Produktzuordnung mit Sicherheitswert', () => {
  test('bekanntes Produkt: sicher, ohne Rückfrage', () => {
    const z = ordneZu('TOMATEN 1KG', SORTEN);
    assert.equal(z.status, 'sicher');
    assert.equal(z.kandidaten[0].name, 'Tomaten');
    const e = entwurfAus('TOMATEN 1KG 1,49');
    assert.deepEqual(alleFragen(e, kontext()), []);
  });

  test('Kürzel werden aufgelöst: „BIO NATJOG 500“ → Naturjoghurt', () => {
    const z = ordneZu('BIO NATJOG 500', SORTEN);
    assert.equal(z.kandidaten[0].name, 'Naturjoghurt');
    assert.ok(z.kandidaten[0].sicherheit >= 0.85);
  });

  test('Gekauftes landet nicht still bei selbstgemachter Tomatensoße', () => {
    const z = ordneZu('TOMATEN 1KG', SORTEN);
    const sosse = z.kandidaten.find((k) => k.name === 'Tomatensoße');
    assert.ok(!sosse || sosse.sicherheit < 0.55);
  });

  test('mehrdeutig („Tomaten“: frisch / gehackt / Dose) → Rückfrage mit Auswahl', () => {
    const sorten = [sorte(1, 'Tomaten frisch', 'g'), sorte(2, 'Tomaten gehackt', 'g'), sorte(3, 'Tomaten (Dose)', 'stueck')];
    const k = { sorten, gewohnheiten: [] };
    const e = erstelleEntwurf(zerlegeBon('TOMATEN 0,99'), k, quelle);
    assert.equal(e.positionen[0].zuordnung.status, 'unsicher');
    const f = fragenFuer(e.positionen[0], k);
    assert.equal(f[0].art, 'zuordnung');
    assert.equal(f[0].pflicht, true);
    assert.match(f[0].frage, /welche meinst du/);
    assert.ok(e.positionen[0].zuordnung.kandidaten.length >= 2);
  });

  test('gelernt: früher bestätigte Zuordnung ist sicher', () => {
    const sorten = [sorte(1, 'Tomaten frisch', 'g'), sorte(2, 'Tomaten gehackt', 'g')];
    const g: Gewohnheit = { schluessel: 'tomaten', uebernommen: 2, nicht_uebernommen: 0, teilweise: 0, letzte_sorte: 2, letzte_menge_pro_einheit: 400, letzter_grund: null };
    const k = { sorten, gewohnheiten: [g] };
    const e = erstelleEntwurf(zerlegeBon('TOMATEN 0,99'), k, quelle);
    const p = e.positionen[0];
    assert.equal(p.zuordnung.status, 'sicher');
    assert.deepEqual(p.ziel, { art: 'sorte', sorte_id: 2 });
    assert.equal(p.menge_pro_einheit, 400, 'gelernte Umrechnung');
    assert.deepEqual(fragenFuer(p, k), []);
  });

  test('KI-Name ist nur ein Hinweis: höchstens „unsicher“', () => {
    const z = ordneZu('XYZ 123 ABC', SORTEN, null, 'Naturjoghurt');
    assert.equal(z.kandidaten[0].name, 'Naturjoghurt');
    assert.equal(z.kandidaten[0].grund, 'hinweis');
    assert.equal(z.status, 'unsicher');
  });
});

describe('Rückfragen – gezielt, nicht bombardierend', () => {
  test('unbekanntes Produkt → „Neues Produkt erkannt“ mit Vorschlag (Name, Einheit, Lagerort, Kategorie)', () => {
    const e = entwurfAus(REWE);
    const hafer = pos(e, 'HAFERDRINK');
    assert.equal(hafer.ziel.art, 'neu');
    if (hafer.ziel.art !== 'neu') return;
    assert.deepEqual([hafer.ziel.daten.name, hafer.ziel.daten.einheit, hafer.ziel.daten.art], ['Haferdrink Barista', 'ml', 'zutat']);
    assert.equal(hafer.menge_pro_einheit, 1000);
    const f = fragenFuer(hafer, kontext());
    assert.equal(f[0].art, 'neu');
    assert.match(f[0].frage, /Neues Produkt erkannt: „Haferdrink Barista“/);
  });

  test('Joghurt 3 Stück → „Wie viele sollen in deinen Bestand?“ (weich, mit Vorschlag)', () => {
    const e = entwurfAus(REWE);
    const f = fragenFuer(pos(e, 'NATUR JOGHURT'), kontext());
    assert.equal(f.length, 1);
    assert.equal(f[0].art, 'menge');
    assert.equal(f[0].pflicht, false);
    assert.match(f[0].frage, /3 × Naturjoghurt gekauft – wie viele/);
  });

  test('Schokolade (Nutzung unbekannt) → „Soll sie in deinen Bestand?“', () => {
    const e = entwurfAus('SCHOKOLADE 100G 1,29');
    const f = alleFragen(e, kontext());
    assert.deepEqual(f.map((x) => x.art), ['neu', 'uebernehmen']);
  });

  test('Nicht-Lebensmittel, Pfand, offene Rabatte: keine Fragen', () => {
    const e = entwurfAus(REWE);
    for (const t of ['WASCHMITTEL', 'PFAND']) assert.deepEqual(fragenFuer(pos(e, t), kontext()), []);
  });

  test('Einheit passt nicht (Pizza in Portionen) → Pflichtfrage zur Umrechnung, Antwort wird gebucht', () => {
    const e = entwurfAus('TK PIZZA MARGHERITA 350G 2 x 1,99 3,98');
    const p = e.positionen[0];
    assert.deepEqual(p.ziel, { art: 'sorte', sorte_id: 7 });
    const f = fragenFuer(p, kontext());
    assert.ok(f.some((x) => x.art === 'umrechnung' && x.pflicht));
    assert.equal(vorschau(e, kontext()).kann_buchen, false, 'ohne Antwort kein Buchen');
    const e2 = setzeMengeProEinheit(waehleSorte(e, p.nr, 7, kontext()), p.nr, 1);
    assert.equal(bestandMenge(e2.positionen[0]), 2);
    assert.equal(vorschau(e2, kontext()).kann_buchen, true);
  });

  test('Lernen: „Du übernimmst Joghurt normalerweise nicht“ – Hinweis und Vorschlag 0, aber keine Automatik', () => {
    const g: Gewohnheit = { schluessel: 'natur joghurt 500g', uebernommen: 0, nicht_uebernommen: 3, teilweise: 0, letzte_sorte: null, letzte_menge_pro_einheit: null, letzter_grund: 'direkt_gegessen' };
    const k = kontext([g]);
    const e = entwurfAus(REWE, k);
    const j = pos(e, 'NATUR JOGHURT');
    const f = fragenFuer(j, k);
    assert.match(f[0].hinweis ?? '', /Du übernimmst Naturjoghurt normalerweise nicht in deinen Bestand/);
    assert.equal(vorgeschlageneAnzahl(j, k), 0, 'Vorschlag 0');
    assert.equal(j.anzahl_uebernehmen, 3, 'entschieden wird nichts ohne den Nutzer');
    const e2 = setzeAnzahl(e, j.nr, 3);
    assert.deepEqual(fragenFuer(pos(e2, 'NATUR JOGHURT'), k), [], 'Nutzer kann jederzeit überschreiben');
  });

  test('„Rest wie vorgeschlagen“ beantwortet nur weiche Fragen – Pflichtfragen bleiben', () => {
    const e = vorschlaegeAnnehmen(entwurfAus(REWE));
    const f = alleFragen(e, kontext());
    assert.ok(f.every((x) => x.pflicht));
    assert.ok(f.some((x) => x.art === 'neu'));
  });
});

describe('Einkauf ≠ Bestand: Mengen und Kosten', () => {
  test('3 × 500 g gekauft, 2 übernommen: Einkauf 1500 g, Bestand 1000 g, Kosten anteilig 1,58 €', () => {
    const e0 = entwurfAus(REWE);
    const j = pos(e0, 'NATUR JOGHURT');
    const e = setzeAnzahl(e0, j.nr, 2);
    const p = pos(e, 'NATUR JOGHURT');
    assert.equal(bestandMenge(p), 1000);
    assert.equal(kostenGebucht(p), 158);
    const v = vorschau(e, kontext());
    assert.deepEqual(v.nicht_uebernommen.find((x) => x.nr === j.nr), { nr: j.nr, name: 'Naturjoghurt', menge: '1 × 500 g', grund: 'Nicht übernommen' });
  });

  test('0 übernehmen mit Begründung – nichts in den Bestand, Grund wird mitgeschickt', () => {
    const e0 = entwurfAus(REWE);
    const nr = pos(e0, 'NATUR JOGHURT').nr;
    const e = nichtUebernehmen(e0, nr, 'direkt_gegessen');
    const p = pos(e, 'NATUR JOGHURT');
    assert.equal(bestandMenge(p), 0);
    const b = buchungsDaten(e).positionen.find((x) => x.nr === nr)!;
    assert.deepEqual([b.bestand_menge, b.grund], [0, 'direkt_gegessen']);
    assert.equal(vorschau(e, kontext()).nicht_uebernommen[0].grund, 'Wird direkt gegessen');
  });

  test('echter Einkaufspreis, Rabatt, Kosten pro Einheit', () => {
    const e = entwurfAus(REWE);
    assert.equal(kostenGebucht(pos(e, 'TOMATEN')), 149);
    const bohnen = pos(e, 'KIDNEYBOHNEN');
    assert.equal(bestandMenge(bohnen), 2, 'Stück-Sorte: 1 Dose = 1 Stück');
    assert.equal(kostenGebucht(bohnen), 148, '1,78 € − 0,30 € Rabatt');
    const v = vorschau(e, kontext());
    assert.equal(v.hinzufuegen.find((z) => z.name === 'Tomaten')!.kosten_text, '1,49 € · 1,49 € / kg');
    assert.equal(v.hinzufuegen.find((z) => z.name === 'Kidneybohnen')!.kosten_text, '1,48 € · 0,74 € / Stück');
  });

  test('Wiegeware: 842 g Bananen; Teilmenge in Gramm → anteilige Kosten', () => {
    const e = entwurfAus(REWE);
    const b = pos(e, 'BANANE');
    assert.equal(bestandMenge(b), 842);
    const e2 = setzeBestandMenge(e, b.nr, 421);
    assert.equal(bestandMenge(pos(e2, 'BANANE')), 421);
    assert.equal(kostenGebucht(pos(e2, 'BANANE')), 84);
  });

  test('unbekannter Preis bleibt unbekannt – nie geschätzt, nie 0', () => {
    const e = entwurfAus('TOMATEN 1KG ?,??');
    const p = e.positionen.length ? e.positionen[0] : null;
    const e2 = entwurfAus('REWE\nTOMATEN 1KG');
    assert.equal(e2.positionen.length, 0, 'Zeile ohne Betrag ist kein Artikel');
    if (p) assert.equal(kostenGebucht(p), null);
    const mitLuecke = erstelleEntwurf({ ...zerlegeBon('TOMATEN 1KG 1,49'), positionen: zerlegeBon('TOMATEN 1KG 1,49').positionen.map((x) => ({ ...x, gesamtpreis_cent: null })) }, kontext(), quelle);
    assert.equal(kostenGebucht(mitLuecke.positionen[0]), null);
    const v = vorschau(mitLuecke, kontext());
    assert.equal(v.hinzufuegen[0].kosten_text, 'Preis unbekannt');
    assert.equal(v.wert_unbekannt, 1);
  });

  test('Pfand ist keine Lebensmittelkosten und kommt nie in den Bestand', () => {
    const e = entwurfAus(REWE);
    const v = vorschau(e, kontext());
    assert.equal(v.pfand_cent, 150);
    assert.equal(kostenGebucht(pos(e, 'MINERALWASSER')), 174, 'Wasser ohne Pfand');
    const b = buchungsDaten(e).positionen.find((x) => x.typ === 'pfand')!;
    assert.equal(b.bestand_menge, 0);
  });

  test('Nicht-Lebensmittel: ausgeschlossen, auf Wunsch doch als Lebensmittel', () => {
    const k = kontext();
    const e = entwurfAus(REWE);
    const w = pos(e, 'WASCHMITTEL');
    assert.equal(bestandMenge(w), 0);
    assert.deepEqual(vorschau(e, k).kein_lebensmittel.map((x) => x.text), ['WASCHMITTEL COLOR']);
    const e2 = setzeTyp(e, w.nr, 'lebensmittel', k);
    assert.equal(pos(e2, 'WASCHMITTEL').typ, 'lebensmittel');
  });
});

describe('Bestandsänderungen prüfen (Vorschau)', () => {
  test('vorher / Änderung / nachher je Sorte, neue Produkte markiert, Zusammenfassung', () => {
    const k = kontext();
    let e = entwurfAus(REWE);
    e = alsNeu(e, pos(e, 'HAFERDRINK').nr, k);
    e = alsNeu(e, pos(e, 'MINERALWASSER').nr, k);
    e = setzeAnzahl(e, pos(e, 'NATUR JOGHURT').nr, 2);
    const v = vorschau(e, k);
    const tomaten = v.hinzufuegen.find((z) => z.name === 'Tomaten')!;
    assert.deepEqual([tomaten.vorher, tomaten.aenderung, tomaten.nachher], [500, 1000, 1500]);
    assert.ok(v.hinzufuegen.find((z) => z.name === 'Haferdrink Barista')!.neu);
    assert.equal(v.kann_buchen, true, v.fehler.join());
    assert.equal(v.zusammenfassung, '7 Artikel hinzugefügt · 0 nicht übernommen');
  });

  test('zweimal derselbe Artikel: eine Zeile, Mengen addiert', () => {
    const v = vorschau(entwurfAus('TOMATEN 1KG 1,49\nTOMATEN 1KG 1,49'), kontext());
    assert.equal(v.hinzufuegen.length, 1);
    assert.deepEqual([v.hinzufuegen[0].aenderung, v.hinzufuegen[0].nachher, v.hinzufuegen[0].kosten_cent], [2000, 2500, 298]);
  });

  test('neues Produkt mit schon vorhandenem Namen → Hinweis statt Buchungsfehler', () => {
    const k = kontext();
    let e = entwurfAus('HAFERDRINK 1L 1,89');
    e = alsNeu(e, 1, k, { name: 'Tomaten' });
    const v = vorschau(e, k);
    assert.equal(v.kann_buchen, false);
    assert.match(v.fehler[0], /„Tomaten“ gibt es schon als Sorte/);
  });
});

describe('Bestätigung, Transaktion, Doppelimport', () => {
  test('Ohne Bestätigung passiert nichts: Entwurf, Fragen und Vorschau sind reine Rechnungen', () => {
    // Die Engine hat gar keinen Datenbankzugriff: Sie kann nur Daten für bon_buchen() vorbereiten.
    const e = entwurfAus(REWE);
    const vorher = JSON.stringify(SORTEN);
    vorschau(e, kontext());
    alleFragen(e, kontext());
    buchungsDaten(e);
    assert.equal(JSON.stringify(SORTEN), vorher, 'Bestand unverändert');
  });

  test('Buchungsdaten: gebuchte Mengen, Preise und Entscheidungen – Nicht-Lebensmittel/Pfand nie mit Bestand', () => {
    const k = kontext();
    let e = entwurfAus(REWE);
    e = alsNeu(e, pos(e, 'HAFERDRINK').nr, k);
    const d = buchungsDaten(e);
    assert.equal(d.haendler, 'REWE');
    assert.equal(d.kaufdatum, '2026-09-28');
    assert.equal(d.fingerabdruck, e.fingerabdruck);
    const tomaten = d.positionen.find((x) => x.bon_text === 'TOMATEN 1KG')!;
    assert.deepEqual([tomaten.block_typ_id, tomaten.bestand_menge, tomaten.gesamtpreis_cent, tomaten.menge_pro_einheit], [1, 1000, 149, 1000]);
    const hafer = d.positionen.find((x) => x.bon_text.startsWith('HAFERDRINK'))!;
    assert.equal((hafer.neu as { name: string }).name, 'Haferdrink Barista');
    for (const x of d.positionen) if (x.typ !== 'lebensmittel') assert.equal(x.bestand_menge, 0);
  });

  test('Doppelimport: derselbe Bon hat denselben Fingerabdruck, ein anderer nicht', () => {
    assert.equal(fingerabdruck(zerlegeBon(REWE)), fingerabdruck(zerlegeBon(REWE)));
    assert.notEqual(fingerabdruck(zerlegeBon(REWE)), fingerabdruck(zerlegeBon(REWE.replace('1,49 B', '1,59 B'))));
  });

  test('Korrektur: Zuordnung ändern setzt die Umrechnung neu', () => {
    const k = kontext();
    const e = entwurfAus('TOMATEN 1KG 1,49');
    const e2 = waehleSorte(e, 1, 4, k); // versehentlich Kidneybohnen (Stück)
    assert.equal(e2.positionen[0].menge_pro_einheit, 1);
    const e3 = waehleSorte(e2, 1, 1, k);
    assert.equal(e3.positionen[0].menge_pro_einheit, 1000);
  });
});

describe('E-Bon', () => {
  const pdf = (inhalt: string, komprimiert: boolean) => {
    const strom = komprimiert ? deflateSync(Buffer.from(inhalt, 'latin1')) : Buffer.from(inhalt, 'latin1');
    const kopf = `%PDF-1.4\n1 0 obj\n<< /Length ${strom.length}${komprimiert ? ' /Filter /FlateDecode' : ''} >>\nstream\n`;
    return new Uint8Array(Buffer.concat([Buffer.from(kopf, 'latin1'), strom, Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')]));
  };
  const inhalt = [
    'BT /F1 9 Tf 20 800 Td (REWE Markt GmbH) Tj ET',
    'BT /F1 9 Tf 20 780 Td (NATUR JOGHURT 500G) Tj 180 0 Td (1,58 B) Tj ET',
    'BT 1 0 0 1 20 770 Tm (  2 Stk x 0,79) Tj ET',
    'BT 1 0 0 1 20 760 Tm [(TOMA) -20 (TEN 1KG)] TJ 1 0 0 1 200 760 Tm (1,49 B) Tj ET',
    'BT 1 0 0 1 20 740 Tm (SUMME EUR) Tj 1 0 0 1 200 740 Tm (3,07) Tj ET',
    'BT 1 0 0 1 20 730 Tm (28.09.2026 17:45) Tj ET',
  ].join('\n');

  test('PDF mit Textebene (komprimiert und unkomprimiert) → Zeilen → derselbe Parser', async () => {
    for (const komprimiert of [true, false]) {
      const zeilen = await pdfText(pdf(inhalt, komprimiert));
      assert.deepEqual(zeilen.slice(0, 4), ['REWE Markt GmbH', 'NATUR JOGHURT 500G 1,58 B', '2 Stk x 0,79', 'TOMATEN 1KG 1,49 B']);
      const b = zerlegeBon(zeilen.join('\n'));
      assert.deepEqual(b.positionen.map((p) => [p.text, p.anzahl, p.gesamtpreis_cent]), [['NATUR JOGHURT 500G', 2, 158], ['TOMATEN 1KG', 1, 149]]);
      assert.equal(b.summe_geprueft, 'passt');
      assert.equal(b.datum, '2026-09-28');
    }
  });

  test('PDF ohne lesbaren Text → leer (nicht raten)', async () => {
    assert.deepEqual(await pdfText(pdf('q 100 0 0 100 0 0 cm /Im1 Do Q', true)), []);
    assert.deepEqual(await pdfText(new TextEncoder().encode('kein pdf')), []);
  });

  test('E-Bon als Text (aus Mail/App kopiert)', () => {
    const b = zerlegeBon('Lidl\nTomaten 1,49 A\nNaturjoghurt 0,79 x 2 1,58 A\nzu zahlen 3,07\n27.09.2026');
    assert.equal(b.haendler, 'Lidl');
    assert.equal(b.positionen.length, 2);
    assert.equal(b.summe_geprueft, 'passt');
  });
});

describe('KI als OCR: Antwort wird geprüft', () => {
  test('nur Text, Namen nur zu echten Zeilen, Preise in Namen entfernt', () => {
    const l = pruefeBonLesung({
      seiten: [{ zeilen: ['REWE', 'BIO NATJOG 500 0,79 B', 42, null] }, ['SUMME 0,79']],
      namen: { 'BIO NATJOG 500': 'Naturjoghurt 0,79 €', 'ERFUNDEN 1KG': 'Trüffel', 'X': 5 },
    });
    assert.deepEqual(l.seiten, [['REWE', 'BIO NATJOG 500 0,79 B'], ['SUMME 0,79']]);
    assert.deepEqual(l.namen, { 'BIO NATJOG 500': 'Naturjoghurt' });
    assert.deepEqual(namenFuerPositionen(l.namen, ['BIO NATJOG 500']), { 'BIO NATJOG 500': 'Naturjoghurt' });
  });

  test('kaputte Antwort → leer statt Absturz', () => {
    assert.deepEqual(pruefeBonLesung(null), { seiten: [], namen: {} });
    assert.deepEqual(pruefeBonLesung({ seiten: 'x', namen: [] }), { seiten: [], namen: {} });
  });

  test('lesbarer Name aus Bon-Text', () => {
    assert.equal(lesbarerName('HAFERDRINK BARISTA 1L'), 'Haferdrink Barista');
    assert.equal(lesbarerName('SAUERKRAUT 520G'), 'Sauerkraut');
    assert.equal(lesbarerName('ZWIEBEL 1KG NETZ'), 'Zwiebeln');
  });
});
