// Kassenbon-Text → strukturierte Positionen. Deterministisch, ohne KI.
//
// Die KI darf beim Foto helfen, den Text abzuschreiben (OCR). Was eine Zeile bedeutet – Artikel,
// Menge, Einzelpreis, Betrag, Rabatt, Pfand, Summe –, entscheidet ausschließlich dieser Parser.
// Er erfindet nichts: Was nicht lesbar ist, bleibt null und wird in der App als unsicher gezeigt.
//
// Unterstützte Formen (REWE, Lidl, Aldi, Edeka … und E-Bon-Text):
//   NATUR JOGHURT 500G           1,58 B      +  „  2 Stk x   0,79“ in der nächsten Zeile
//   NATUR JOGHURT 500G  2 x 0,79 €   1,58 €
//   Naturjoghurt        0,79 x 2     1,58 A
//   BANANE                         1,68 B    +  „0,842 kg x 1,99 EUR/kg“
//   Preisvorteil                  -0,30      → Rabatt des Artikels direkt darüber
//   PFAND 0,25                     0,25 A *  → Pfand (eigene Geldposition)
//   SUMME EUR                      9,45
import type { BonDaten, BonPosition, BonTyp, Packung } from './typen.ts';
import { normalisiere } from '../text.ts';

// ───────── Zeilen vorbereiten ─────────

/** Tabs, Sonderzeichen und typische OCR-Fehler in Beträgen („O,79“, „l,49“, „1 ,49“) glätten. */
export function bereinigeZeile(zeile: string): string {
  let t = zeile
    .replace(/[\t ]/g, ' ')
    .replace(/[−–—]/g, '-')
    .replace(/[×✕]/g, 'x');
  // O/o statt 0 und l/I/| statt 1 direkt vor dem Komma eines Betrags
  t = t.replace(/(^|[\s(x*-])[Oo](?=[.,]\d{2}\b)/g, '$10');
  t = t.replace(/(^|[\s(x*-])[lI|](?=[.,]\d{2}\b)/g, '$11');
  // „1 ,49“ / „1, 49“ → „1,49“
  t = t.replace(/(\d)\s+([.,])\s*(\d{2})(?!\d)/g, '$1$2$3').replace(/(\d)([.,])\s+(\d{2})(?!\d)/g, '$1$2$3');
  return t.replace(/\s+/g, ' ').trim();
}

/** '1,49' | '1.49' | '-0,30' | '0,30-' → Cent */
export function cent(betrag: string): number {
  const negativ = /^-|-$/.test(betrag.trim());
  const zahl = Number(betrag.replace(/[^\d.,]/g, '').replace(',', '.'));
  return Math.round(zahl * 100) * (negativ ? -1 : 1);
}

/** '0,842' → 842 (g bei kg-Angaben) */
function tausendstel(wert: string): number {
  return Math.round(Number(wert.replace(',', '.')) * 1000);
}

const BETRAG = String.raw`-?\d{1,4}[.,]\d{2}-?`;
/** Betrag am Zeilenende, optional mit €/EUR und Steuerklasse („1,58 B“, „0,25 A *“) */
const END_BETRAG = new RegExp(String.raw`(?:^|\s)(?:€\s*)?(${BETRAG})\s*(?:€|eur)?(?:\s+[a-z0-9*]{1,2}){0,2}\s*\*?$`, 'i');

function trenneBetrag(zeile: string): { text: string; cent: number } | null {
  const m = END_BETRAG.exec(zeile);
  if (!m) return null;
  return { text: zeile.slice(0, m.index).trim(), cent: cent(m[1]) };
}

// ───────── Erkennen, was eine Zeile ist ─────────

const SUMME = /^(summe|zu zahlen|gesamtbetrag|gesamtsumme|gesamt|total|endsumme|endbetrag|zahlbetrag)\b/i;
const ZU_ZAHLEN = /^(zu zahlen|zahlbetrag|endbetrag)\b/i;
const META = new RegExp(
  [
    String.raw`^(geg\.?|gegeben|bar\b|barzahlung|r(ü|ue)ckgeld|ec[- ]?cash|ec[- ]?karte|kartenzahlung|karte\b|girocard|visa|mastercard|maestro|v pay|kreditkarte)`,
    String.raw`^(mwst|ust|netto|brutto|steuer|posten|anzahl( der)? artikel|bon[- ]?nr|beleg|kasse\b|kassierer|trace|tse|uid|st\.?[- ]?nr|steuer[- ]?nr|tel\b|tel\.|telefon|fax|www\.|http)`,
    String.raw`^(zwischensumme|zw\.?-?summe|datum|uhrzeit|vielen dank|danke|ihr einkauf|payback[- ]?punkte|punkte)`,
    String.raw`^[a-d]\s*[=:]?\s*\d{1,2}([.,]\d{1,2})?\s*%`, // Steuertabelle „A 7,00 % …“
  ].join('|'),
  'i',
);
const PFAND = /pfand|leergut|einweg|mehrweg/i;
/** Rabattzeile auch ohne Minuszeichen erkennen – nur, wenn sie mit dem Rabattwort beginnt */
const RABATT_START = /^(rabatt|preisvorteil|nachlass|coupon|gutschein|sofortrabatt|ersparnis|aktionsrabatt|mengenrabatt|bonus|abzug)\b/i;
/** Rabatte, die sich auf den ganzen Einkauf beziehen – nie einem Artikel zuordnen */
const RABATT_ALLGEMEIN = /gutschein|payback|bonus|treue|einkauf|gesamt|warenkorb|\bbon\b|mitarbeiter/i;
const STORNO = /storno|retoure|r(ü|ue)cknahme/i;

const MENGE_FOLGEZEILE = new RegExp(
  String.raw`^(\d+(?:[.,]\d+)?)\s*(?:stk\.?|st\.?|st(ü|ue)ck)?\s*x\s*(?:€\s*)?(\d+[.,]\d{2})\s*(?:€|eur)?(?:\s+(${BETRAG})(?:\s+[a-z0-9*]{1,2}){0,2})?\s*\*?$`,
  'i',
);
const GEWICHT_FOLGEZEILE = new RegExp(
  String.raw`^(?:(?:handeingabe|waage|gewicht)\s*:?\s*)?(\d+[.,]\d{1,3})\s*kg\s*x\s*(?:€\s*)?(\d+[.,]\d{2})\s*(?:€|eur)?\s*/\s*kg(?:\s+(${BETRAG})(?:\s+[a-z0-9*]{1,2}){0,2})?\s*\*?$`,
  'i',
);

/** Nicht-Lebensmittel: kommen nie automatisch in den Lebensmittelbestand. */
const NICHT_LEBENSMITTEL = new RegExp(
  [
    'waschmittel', 'weichspueler', 'spuelmittel', 'spuelmaschine', 'geschirrtab', 'reiniger', 'putzmittel', 'schwamm', 'scheuer',
    'muellbeutel', 'muelltuete', 'toilettenpapier', 'klopapier', 'kuechenrolle', 'kuechentuch', 'taschentuech', 'zewa', 'tempo',
    'zahnpasta', 'zahncreme', 'zahnbuerste', 'shampoo', 'duschgel', 'duschbad', 'seife', 'deo', 'rasier', 'hautcreme',
    'handcreme', 'koerperlotion', 'sonnencreme', 'windel', 'binden', 'tampon', 'pflaster', 'katzenfutter', 'hundefutter',
    'katzenstreu', 'tierfutter', 'hundesnack', 'batterie', 'gluehbirne', 'leuchtmittel', 'kerze', 'teelicht', 'alufolie',
    'frischhaltefolie', 'backpapier', 'gefrierbeutel', 'feuerzeug', 'zeitschrift', 'zeitung', 'blumen', 'tragetasche',
    'tragetuete', 'tuete', 'beutel papier', 'geschenkkarte', 'zigarette', 'tabak',
  ].join('|'),
);

export function typVon(text: string): BonTyp {
  const n = normalisiere(text);
  if (PFAND.test(n)) return 'pfand';
  if (NICHT_LEBENSMITTEL.test(n)) return 'nicht_lebensmittel';
  return 'lebensmittel';
}

// ───────── Packung aus dem Artikeltext ─────────

function inEinheit(wert: number, einheit: string): Packung | null {
  const e = einheit.toLowerCase();
  const menge =
    e === 'kg' ? wert * 1000 : e === 'l' || e === 'ltr' ? wert * 1000 : e === 'cl' ? wert * 10 : wert;
  const art: Packung['einheit'] = e === 'kg' || e === 'g' || e === 'gr' ? 'g' : 'ml';
  const gerundet = Math.round(menge);
  return gerundet > 0 ? { menge: gerundet, einheit: art } : null;
}

/** „500G“ → 500 g, „1KG“ → 1000 g, „1,5L“ → 1500 ml, „6X1,5L“ → 9000 ml, „10ST“ → 10 Stück. Sonst null. */
export function packungAus(text: string): Packung | null {
  const t = text.replace(',', '.');
  const multi = /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|gr|g|ltr|l|ml|cl)\b/i.exec(t);
  if (multi) {
    const p = inEinheit(Number(multi[2]), multi[3]);
    return p ? { menge: p.menge * Number(multi[1]), einheit: p.einheit } : null;
  }
  const einfach = /(\d+(?:\.\d+)?)\s*(kg|gr|g|ltr|l|ml|cl)\b/i.exec(t);
  if (einfach) return inEinheit(Number(einfach[1]), einfach[2]);
  const stueck = /(\d+)\s*(?:st|stk|st(ü|ue)ck|er)\b/i.exec(t);
  if (stueck && Number(stueck[1]) > 0) return { menge: Number(stueck[1]), einheit: 'stueck' };
  return null;
}

// ───────── Händler, Datum, Filiale ─────────

const HAENDLER: [RegExp, string][] = [
  [/\brewe\b/i, 'REWE'], [/\bedeka\b/i, 'EDEKA'], [/\blidl\b/i, 'Lidl'], [/\baldi\s*s(ü|ue)d\b/i, 'ALDI SÜD'],
  [/\baldi\s*nord\b/i, 'ALDI Nord'], [/\baldi\b/i, 'ALDI'], [/\bpenny\b/i, 'PENNY'], [/\bnetto\b/i, 'Netto'],
  [/\bkaufland\b/i, 'Kaufland'], [/\bnorma\b/i, 'NORMA'], [/\btegut\b/i, 'tegut'], [/\bglobus\b/i, 'Globus'],
  [/\bdm[- ]drogerie|\bdm-markt\b/i, 'dm'], [/\brossmann\b/i, 'Rossmann'], [/\balnatura\b/i, 'Alnatura'],
  [/\bdenn'?s\b/i, "denn's"], [/\bbio\s*company\b/i, 'Bio Company'], [/\bmarktkauf\b/i, 'Marktkauf'],
  [/\bfamila\b/i, 'famila'], [/\bhit\b/i, 'HIT'], [/\bcombi\b/i, 'Combi'], [/\bnahkauf\b/i, 'nahkauf'],
];

export function haendlerAus(zeilen: string[]): string | null {
  for (const z of zeilen.slice(0, 12)) {
    const treffer = HAENDLER.find(([re]) => re.test(z));
    if (treffer) return treffer[1];
  }
  return null;
}

/** Erstes gültiges Datum TT.MM.JJJJ / TT.MM.JJ → YYYY-MM-DD */
export function datumAus(zeilen: string[]): string | null {
  for (const z of zeilen) {
    const re = /\b(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(z))) {
      const t = Number(m[1]);
      const mo = Number(m[2]);
      const j = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      if (t >= 1 && t <= 31 && mo >= 1 && mo <= 12 && j >= 2000 && j <= 2099) {
        return `${j}-${String(mo).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

function filialeAus(kopf: string[]): string | null {
  const z = kopf.find((x) => /\b\d{5}\s+[A-Za-zÄÖÜäöüß]/.test(x));
  return z ? z.slice(0, 120) : null;
}

// ───────── Mehrere Fotos eines langen Bons ─────────

const vergleich = (z: string) => normalisiere(z);

function seitenRang(zeilen: string[]): number {
  const kopf = !!haendlerAus(zeilen.slice(0, 6)) || zeilen.slice(0, 6).some((z) => /\b\d{5}\s+[A-Za-zÄÖÜäöüß]/.test(z));
  const fuss = zeilen.some((z) => SUMME.test(z));
  if (kopf && !fuss) return 0;
  if (fuss && !kopf) return 2;
  return 1;
}

/**
 * Fügt mehrere Fotos zusammen: Kopf (Händler) zuerst, Summe zuletzt, sonst in Aufnahme-Reihenfolge.
 * Doppelt fotografierte Bereiche (Ende von Foto 1 = Anfang von Foto 2) werden nur einmal gezählt.
 */
export function fuegeSeitenZusammen(seiten: string[][], einzeilig = false): string[] {
  const sortiert = seiten
    .map((zeilen, i) => ({ zeilen: zeilen.map(bereinigeZeile).filter(Boolean), i }))
    .filter((s) => s.zeilen.length > 0)
    .map((s) => ({ ...s, rang: seitenRang(s.zeilen) }))
    .sort((a, b) => a.rang - b.rang || a.i - b.i);

  const ergebnis: string[] = [];
  for (const seite of sortiert) {
    let ueberlappung = 0;
    const max = Math.min(ergebnis.length, seite.zeilen.length, 20);
    for (let k = max; k >= 1; k--) {
      const ende = ergebnis.slice(-k).map(vergleich);
      const anfang = seite.zeilen.slice(0, k).map(vergleich);
      if (ende.every((z, i) => z === anfang[i])) {
        // eine einzelne gleiche Zeile kann auch ein zweiter gleicher Artikel sein – nur auf Wunsch
        if (k >= 2 || (einzeilig && END_BETRAG.test(seite.zeilen[0]))) {
          ueberlappung = k;
          break;
        }
      }
    }
    ergebnis.push(...seite.zeilen.slice(ueberlappung));
  }
  return ergebnis;
}

// ───────── Der Parser ─────────

function neuePosition(nr: number, text: string, betrag: number | null, zeile: string): BonPosition {
  let t = text.replace(/^\d{4,}\s+/, '').trim(); // Artikelnummer (Aldi)
  let anzahl = 1;
  let einzel: number | null = null;
  let gewicht: number | null = null;

  const mitMenge = /^(.*?)\s+(\d+)\s*(?:stk\.?|st\.?)?\s*x\s*(?:€\s*)?(\d+[.,]\d{2})\s*(?:€|eur)?$/i.exec(t);
  const lidl = /^(.*?)\s+(\d+[.,]\d{2})\s*(?:€|eur)?\s*x\s*(\d+)$/i.exec(t);
  const vorne = /^(\d+)\s*x\s+(.+)$/i.exec(t);
  const gewogen = /^(.*?)\s+(\d+[.,]\d{1,3})\s*kg\s*x\s*(?:€\s*)?(\d+[.,]\d{2})\s*(?:€|eur)?\s*\/\s*kg$/i.exec(t);
  if (gewogen) {
    t = gewogen[1];
    gewicht = tausendstel(gewogen[2]);
  } else if (mitMenge) {
    t = mitMenge[1];
    anzahl = Number(mitMenge[2]);
    einzel = cent(mitMenge[3]);
  } else if (lidl) {
    t = lidl[1];
    einzel = cent(lidl[2]);
    anzahl = Number(lidl[3]);
  } else if (vorne) {
    anzahl = Number(vorne[1]);
    t = vorne[2];
  }
  if (anzahl < 1 || !Number.isFinite(anzahl)) anzahl = 1;
  if (einzel === null && anzahl === 1 && gewicht === null && betrag !== null) einzel = betrag;

  const typ = typVon(t);
  return {
    nr,
    text: t.slice(0, 200),
    typ,
    anzahl,
    einzelpreis_cent: einzel,
    gesamtpreis_cent: betrag,
    gewicht_g: gewicht,
    packung: typ === 'lebensmittel' || typ === 'unbekannt' ? packungAus(t) : null,
    rabatt_cent: 0,
    rabatt_texte: [],
    pfand_cent: 0,
    warnungen: [],
    zeilen: [zeile],
  };
}

function euro(c: number): string {
  return `${(c / 100).toFixed(2).replace('.', ',')} €`;
}

/** Prüft Menge × Einzelpreis gegen den Betrag – Hinweis auf Lesefehler, nie eine Korrektur. */
function pruefePosition(p: BonPosition, kilopreis: number | null): void {
  if (p.gesamtpreis_cent === null) {
    p.warnungen.push('Preis nicht lesbar');
    return;
  }
  if (p.gewicht_g !== null && kilopreis !== null) {
    const erwartet = (p.gewicht_g * kilopreis) / 1000;
    if (Math.abs(erwartet - p.gesamtpreis_cent) > 1.5) {
      p.warnungen.push(`${(p.gewicht_g / 1000).toFixed(3).replace('.', ',')} kg × ${euro(kilopreis)}/kg ergibt nicht ${euro(p.gesamtpreis_cent)} – bitte prüfen`);
    }
  } else if (p.einzelpreis_cent !== null && p.anzahl > 1) {
    const erwartet = Math.round(p.anzahl * p.einzelpreis_cent);
    if (Math.abs(erwartet - p.gesamtpreis_cent) > 1) {
      p.warnungen.push(`${p.anzahl} × ${euro(p.einzelpreis_cent)} ergibt nicht ${euro(p.gesamtpreis_cent)} – bitte prüfen`);
    }
  }
}

/**
 * Zerlegt Bon-Text (eine Seite als Text oder mehrere Fotos als Zeilenlisten) in Positionen.
 * Rabatte direkt unter einem Artikel gehören zu diesem Artikel; alle anderen bleiben offen.
 */
export function zerlegeBon(eingabe: string | string[][]): BonDaten {
  const seiten = typeof eingabe === 'string' ? [eingabe.split(/\r?\n/)] : eingabe;
  const streng = zerlegeZeilen(fuegeSeitenZusammen(seiten), seiten.length);
  if (seiten.length < 2 || streng.summe_geprueft === 'passt') return streng;
  // Eine einzelne gleiche Zeile am Fotorand: doppelt fotografiert oder zweimal gekauft?
  // Das entscheidet die Summe auf dem Bon – nicht eine Vermutung.
  const locker = zerlegeZeilen(fuegeSeitenZusammen(seiten, true), seiten.length);
  return locker.summe_geprueft === 'passt' ? locker : streng;
}

function zerlegeZeilen(zeilen: string[], seitenZahl: number): BonDaten {

  const positionen: BonPosition[] = [];
  const warnungen: string[] = [];
  let summe: number | null = null;
  let zuZahlen: number | null = null;
  let nachSumme = false;
  let ersterArtikel = -1;
  /** zuletzt erkannter Artikel – nur solange keine andere Art Zeile dazwischen kam */
  let letzter: BonPosition | null = null;
  /** Artikeltext ohne Betrag (Lidl-Wiegeware: Betrag steht in der nächsten Zeile) */
  let offenerText: string | null = null;
  const kilopreise = new Map<BonPosition, number>();

  const nr = () => positionen.length + 1;

  zeilen.forEach((zeile, index) => {
    if (/^[-=*_#.~\s]*$/.test(zeile)) return;

    if (SUMME.test(zeile) && !/zwischen/i.test(zeile)) {
      const b = trenneBetrag(zeile);
      if (b) {
        if (ZU_ZAHLEN.test(zeile)) zuZahlen = b.cent;
        else if (summe === null) summe = b.cent;
      }
      nachSumme = true;
      letzter = null;
      return;
    }
    if (nachSumme) return;
    if (META.test(zeile)) {
      letzter = null;
      offenerText = null;
      return;
    }

    const gewicht = GEWICHT_FOLGEZEILE.exec(zeile);
    if (gewicht) {
      const g = tausendstel(gewicht[1]);
      const kilo = cent(gewicht[2]);
      const betrag = gewicht[3] ? cent(gewicht[3]) : null;
      if (offenerText && betrag !== null) {
        const p = neuePosition(nr(), offenerText, betrag, `${offenerText} / ${zeile}`);
        p.gewicht_g = g;
        p.einzelpreis_cent = null;
        positionen.push(p);
        kilopreise.set(p, kilo);
        letzter = p;
      } else if (letzter) {
        letzter.gewicht_g = g;
        letzter.einzelpreis_cent = null;
        letzter.zeilen.push(zeile);
        kilopreise.set(letzter, kilo);
      }
      offenerText = null;
      return;
    }

    const menge = MENGE_FOLGEZEILE.exec(zeile);
    if (menge) {
      const anzahl = Number(menge[1].replace(',', '.'));
      const einzel = cent(menge[3]);
      const betrag = menge[4] ? cent(menge[4]) : null;
      if (offenerText && betrag !== null) {
        const p = neuePosition(nr(), offenerText, betrag, `${offenerText} / ${zeile}`);
        p.anzahl = anzahl;
        p.einzelpreis_cent = einzel;
        positionen.push(p);
        letzter = p;
      } else if (letzter) {
        letzter.anzahl = anzahl;
        letzter.einzelpreis_cent = einzel;
        letzter.zeilen.push(zeile);
      }
      offenerText = null;
      return;
    }

    const b = trenneBetrag(zeile);
    if (!b) {
      // Zeile ohne Betrag: vielleicht der Name eines gewogenen Artikels (Betrag folgt), sonst Kopf/Text
      offenerText = /[a-zäöüß]{2}/i.test(zeile) ? zeile : null;
      if (ersterArtikel < 0) letzter = null;
      return;
    }
    offenerText = null;
    if (!/[a-zäöüß]{2}/i.test(b.text)) {
      letzter = null;
      return;
    }

    if (PFAND.test(b.text)) {
      const p = neuePosition(nr(), b.text, b.cent, zeile);
      p.typ = 'pfand';
      p.packung = null;
      positionen.push(p);
      // Pfand direkt unter einem Artikel (nicht Leergut-Rückgabe) wird dort vermerkt
      if (letzter && letzter.typ !== 'pfand' && letzter.pfand_cent === 0 && b.cent > 0) letzter.pfand_cent = b.cent;
      return; // Artikel bleibt „letzter“: Rabatt darunter gehört noch zu ihm
    }

    if (b.cent < 0 || RABATT_START.test(b.text) || STORNO.test(b.text)) {
      const betrag = -Math.abs(b.cent);
      const eindeutig = letzter !== null && letzter.typ !== 'pfand' && !RABATT_ALLGEMEIN.test(b.text) && !STORNO.test(b.text);
      if (eindeutig && letzter) {
        letzter.rabatt_cent += -betrag;
        letzter.rabatt_texte.push(`${b.text} ${euro(betrag)}`);
        letzter.zeilen.push(zeile);
      } else {
        const p = neuePosition(nr(), b.text, betrag, zeile);
        p.typ = 'rabatt';
        p.packung = null;
        p.einzelpreis_cent = null;
        p.warnungen.push(
          STORNO.test(b.text)
            ? 'Storno – bitte die betroffene Position prüfen'
            : 'Rabatt konnte nicht eindeutig zugeordnet werden',
        );
        positionen.push(p);
      }
      letzter = null;
      return;
    }

    if (ersterArtikel < 0) ersterArtikel = index;
    const p = neuePosition(nr(), b.text, b.cent, zeile);
    positionen.push(p);
    letzter = p;
  });

  for (const p of positionen) {
    if (p.typ === 'lebensmittel' || p.typ === 'nicht_lebensmittel' || p.typ === 'unbekannt') {
      pruefePosition(p, kilopreise.get(p) ?? null);
      if (p.rabatt_cent > 0 && p.gesamtpreis_cent !== null && p.rabatt_cent > p.gesamtpreis_cent) {
        p.warnungen.push('Rabatt ist größer als der Preis – bitte prüfen');
      }
    }
  }

  const kopf = zeilen.slice(0, ersterArtikel >= 0 ? ersterArtikel : Math.min(zeilen.length, 8));
  const bekannt = positionen.every((p) => p.gesamtpreis_cent !== null);
  const berechnet = positionen.reduce((s, p) => s + (p.gesamtpreis_cent ?? 0) - p.rabatt_cent, 0);
  const endsumme = zuZahlen ?? summe;
  const geprueft: BonDaten['summe_geprueft'] =
    endsumme === null || !bekannt || positionen.length === 0 ? 'unbekannt' : Math.abs(berechnet - endsumme) <= 1 ? 'passt' : 'weicht_ab';
  if (geprueft === 'weicht_ab' && endsumme !== null) {
    warnungen.push(`Die gelesenen Beträge ergeben ${euro(berechnet)}, der Bon sagt ${euro(endsumme)} – vermutlich ein Lesefehler. Bitte die Positionen prüfen.`);
  }
  if (positionen.length === 0) warnungen.push('Auf dem Bon wurden keine Artikel mit Preis gefunden.');

  return {
    haendler: haendlerAus(kopf.length ? kopf : zeilen),
    filiale: filialeAus(kopf),
    datum: datumAus(zeilen),
    summe_cent: endsumme,
    positionen,
    berechnete_summe_cent: berechnet,
    summe_geprueft: geprueft,
    warnungen,
    seiten: seitenZahl,
  };
}
