// Prüft die Rohantwort einer KI gegen den Snapshot.
// Die KI darf NICHTS als vorhanden ausgeben, was nicht im Snapshot steht, und rechnet keine Preise:
//   • Zutaten ohne gültige id/Namen im Snapshot → „fehlt“ (nie „vorhanden“)
//   • mehr als vorhanden → Rest „fehlt“; Mengen in der Einheit der Sorte (Portion, Stück, g, ml)
//   • Kosten, Portionen, Gerichtsart und „rettet Lebensmittel“ rechnet ausschließlich dieser Code
//   • Texte werden gegen erfundene Zutaten, Preise und Behauptungen geprüft (wahrheit.ts)
import type {
  BausteinIdee, Eigenschaften, FehlendeZutat, Gericht, Gerichtsart, GerichtZutat, Kosten, Optionen,
  RohBaustein, RohGericht, RohZutat, Snapshot, SnapshotZutat,
} from './typen.ts';
import {
  ARTEN, EINHEITEN, GERICHTSTYPEN, GESCHMACK, GEWUERZRICHTUNGEN, KONSISTENZ, SATTMACHER, TEMPERATUR, ZUBEREITUNG,
} from './typen.ts';
import { bekannterPreisInfo, GRUNDAUSSTATTUNG } from './snapshot.ts';
import { bezugText, mengeAusPortionen, mengeText, portionenAusMenge } from './mengen.ts';
import { type KostenPosten, rundeCent, summiereKosten, verbrauchswert } from './kosten.ts';
import { bereinigeText, deckungstext, pruefeName, type Regeln, ungedeckt } from './wahrheit.ts';
import { ausListe, kuerze, normalisiere } from './text.ts';

const FARBEN = ['rot', 'braun', 'gruen', 'gelb', 'weiss', 'schwarz', 'blau'] as const;
const LAGERORTE = ['gefrierfach', 'kuehlschrank', 'vorrat'] as const;

/** Mehr fehlende Zutaten sind kein „Essen aus dem Vorrat“ mehr. */
export const MAX_FEHLEND = 3;
const MAX_PORTIONEN = 24;

export type Pruefung<T> = { ok: true; wert: T } | { ok: false; grund: string };

export function normalisiereEigenschaften(roh: Record<string, unknown> | undefined, name: string): Eigenschaften {
  const e = roh ?? {};
  const schaerfe = Math.round(Number(e.schaerfe));
  const gerichtstyp = ausListe(e.gerichtstyp, GERICHTSTYPEN, 'sonstiges');
  return {
    gerichtstyp,
    hauptzutat: normalisiere(kuerze(e.hauptzutat, 40)) || normalisiere(name).split(' ')[0] || 'unbekannt',
    geschmack: ausListe(e.geschmack, GESCHMACK, 'herzhaft'),
    schaerfe: (Number.isFinite(schaerfe) ? Math.min(3, Math.max(0, schaerfe)) : 0) as Eigenschaften['schaerfe'],
    konsistenz: ausListe(e.konsistenz, KONSISTENZ, 'stueckig'),
    sattmacher: ausListe(e.sattmacher, SATTMACHER, 'sonstiges'),
    gewuerzrichtung: ausListe(e.gewuerzrichtung, GEWUERZRICHTUNGEN, 'neutral'),
    zubereitung: ausListe(e.zubereitung, ZUBEREITUNG, 'pfanne'),
    temperatur: ausListe(e.temperatur, TEMPERATUR, gerichtstyp === 'salat' ? 'kalt' : 'warm'),
  };
}

function findeImSnapshot(snapshot: Snapshot, id: unknown, name: unknown): SnapshotZutat | null {
  if (typeof id === 'string') {
    const z = snapshot.zutaten.find((x) => x.id === id);
    if (z) return z;
  }
  if (typeof name === 'string' && name.trim()) {
    const n = normalisiere(name);
    return snapshot.zutaten.find((x) => normalisiere(x.name) === n) ?? null;
  }
  return null;
}

function ganzzahl(wert: unknown, min: number, max: number, ersatz: number): number {
  const n = Math.round(Number(wert));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : ersatz;
}

/** Ohne Angabe: Sattmacher und Komplettgerichte eine Portion pro Person, sonst eine pro zwei Personen. */
function standardPortionen(z: SnapshotZutat, personen: number): number {
  if (z.art === 'komplettgericht' || z.farbe === 'gelb') return personen;
  return Math.max(1, Math.ceil(personen / 2));
}

/** Gewünschte Portionen aus der KI-Antwort (auf Viertel gerundet, begrenzt). */
function portionenAus(rz: RohZutat | undefined, z: SnapshotZutat, personen: number): number {
  const wert = Number(rz?.portionen ?? rz?.bloecke);
  if (!Number.isFinite(wert) || wert <= 0) return standardPortionen(z, personen);
  return Math.min(MAX_PORTIONEN, Math.max(0.25, Math.round(wert * 4) / 4));
}

const aufzaehlung = (namen: string[]) =>
  namen.length <= 1 ? namen.join('') : `${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]}`;

/** Kosten des Gerichts – ausschließlich über die zentrale Kostenfunktion. */
export function berechneKosten(zutaten: GerichtZutat[], fehlt: FehlendeZutat[], personen: number): Kosten {
  const posten: KostenPosten[] = zutaten
    .filter((z) => z.quelle !== 'grundausstattung')
    .map((z) => ({ name: z.name, cent: z.kosten_cent }));
  // Einkauf: nur, wenn Menge UND Preis bekannt sind (fehlende Teilmenge einer vorhandenen Sorte).
  const einkauf: KostenPosten[] = fehlt.map((f) => ({
    name: f.name,
    cent: f.grund === 'zu_wenig' ? f.preis_cent : null,
  }));
  return summiereKosten(posten, personen, einkauf);
}

export function gerichtsartVon(zutaten: GerichtZutat[]): Gerichtsart {
  const echte = zutaten.filter((z) => z.quelle !== 'grundausstattung');
  const komplett = echte.filter((z) => z.art === 'komplettgericht');
  if (komplett.length === 0) return 'rezept';
  return komplett.length === echte.length ? 'komplett' : 'komplett_plus';
}

/** Was dieses Gericht vor dem Verderben rettet. */
export function rettetVon(zutaten: GerichtZutat[], snapshot: Snapshot): string[] {
  return zutaten
    .filter((z) => {
      if (z.quelle === 'kuehlschrank') return true;
      if (z.quelle !== 'bestand') return false;
      const s = snapshot.zutaten.find((x) => x.id === z.id);
      return z.geoeffnet || z.bald_verbrauchen || !!s?.rest || !!s?.aufgetaut;
    })
    .map((z) => z.name);
}

function ablaufText(tage: number | null): string {
  if (tage === null) return 'sollte bald verbraucht werden';
  if (tage < 0) return 'ist über dem Datum – bitte prüfen';
  if (tage === 0) return 'läuft heute ab';
  if (tage === 1) return 'läuft morgen ab';
  return `läuft in ${tage} Tagen ab`;
}

export function warumJetzt(zutaten: GerichtZutat[], fehlt: FehlendeZutat[], snapshot?: Snapshot): string[] {
  const gruende: string[] = [];
  const aufgetaut = zutaten.filter((z) => snapshot?.zutaten.find((s) => s.id === z.id)?.aufgetaut).map((z) => z.name);
  if (aufgetaut.length) gruende.push(`${aufzaehlung(aufgetaut)} ${aufgetaut.length === 1 ? 'ist' : 'sind'} aufgetaut – heute verbrauchen.`);
  const offen = zutaten.filter((z) => z.geoeffnet).map((z) => z.name);
  if (offen.length) gruende.push(`${aufzaehlung(offen)} ${offen.length === 1 ? 'ist' : 'sind'} angebrochen – jetzt verbrauchen.`);
  for (const z of zutaten) {
    if (z.quelle !== 'bestand' || !z.bald_verbrauchen || z.geoeffnet) continue;
    const tage = snapshot?.zutaten.find((s) => s.id === z.id)?.tage_bis_ablauf ?? null;
    gruende.push(`${z.name} ${ablaufText(tage)}.`);
  }
  const reste = zutaten.filter((z) => z.quelle === 'kuehlschrank').map((z) => z.name);
  if (reste.length) gruende.push(`Verwertet deine Reste: ${reste.join(', ')}.`);
  if (fehlt.length === 0) gruende.push('Du hast alles zuhause.');
  else if (fehlt.length === 1) gruende.push('Du hast fast alles zuhause.');
  return gruende;
}

/** Hinweise auf Unbekanntes – ehrlich statt geraten. */
function hinweiseVon(zutaten: GerichtZutat[]): string[] {
  return zutaten
    .filter((z) => z.quelle === 'bestand' && z.art !== 'zutat' && z.zusammensetzung === null)
    .map((z) => `Zusammensetzung von ${z.name} unbekannt`);
}

function ersatzBeschreibung(gerichtsart: Gerichtsart, zutaten: GerichtZutat[]): string {
  const echte = zutaten.filter((z) => z.quelle !== 'grundausstattung');
  const komplett = echte.filter((z) => z.art === 'komplettgericht').map((z) => z.name);
  const rest = echte.filter((z) => z.art !== 'komplettgericht').map((z) => z.name);
  if (gerichtsart === 'komplett') return `${aufzaehlung(komplett)} – schon fertig, nur noch warm machen.`;
  if (gerichtsart === 'komplett_plus') return `${aufzaehlung(komplett)}, dazu ${aufzaehlung(rest)}.`;
  return `Mit ${aufzaehlung(rest)}.`;
}

function regelnFuer(zutaten: GerichtZutat[], snapshot: Snapshot): Regeln {
  return {
    hausgemacht_erlaubt: zutaten.some(
      (z) => snapshot.zutaten.find((s) => s.id === z.id)?.herkunft === 'selbstgemacht',
    ),
  };
}

export function pruefeGericht(roh: RohGericht, snapshot: Snapshot, optionen: Optionen, id: string): Pruefung<Gericht> {
  const rohName = kuerze(roh.name, 80);
  if (!rohName) return { ok: false, grund: 'Gericht ohne Namen' };
  const personen = Math.max(1, optionen.personen);

  const zutaten: GerichtZutat[] = [];
  const fehlt: FehlendeZutat[] = [];
  const fehltName = (n: string, grund: FehlendeZutat['grund'], menge: number | null, z?: SnapshotZutat, einheitRoh?: unknown) => {
    if (!n) return;
    if (fehlt.some((f) => normalisiere(f.name) === normalisiere(n))) return;
    if (grund === 'zu_wenig' && z && menge !== null) {
      const wert = verbrauchswert(menge, z);
      fehlt.push({
        name: n, grund, menge, einheit: z.einheit,
        preis_cent: wert === null ? null : rundeCent(wert),
        preis_bezug: wert === null ? null : `für ${mengeText(menge, z.einheit)}`,
      });
      return;
    }
    const preis = bekannterPreisInfo(snapshot, n);
    // Menge nur übernehmen, wenn die KI eine gültige Einheit nennt – sonst „Menge offen“.
    const einheit = EINHEITEN.find((e) => e === einheitRoh) ?? null;
    fehlt.push({
      name: n, grund, menge: einheit ? menge : null, einheit,
      preis_cent: preis?.kosten_cent ?? null,
      preis_bezug: preis ? bezugText(preis.kosten_menge, preis.einheit) : null,
    });
  };

  for (const rz of Array.isArray(roh.zutaten) ? roh.zutaten : []) {
    const z = findeImSnapshot(snapshot, rz?.id, rz?.name);
    if (!z) {
      // Die KI hat etwas als vorhanden ausgegeben, das es nicht gibt → gehört zu „fehlt“.
      fehltName(kuerze(rz?.name ?? rz?.id, 60), 'nicht_im_bestand', null);
      continue;
    }
    const menge = z.quelle === 'bestand' ? mengeAusPortionen(portionenAus(rz, z, personen), z.einheit, z.portion_menge) : null;
    const schon = zutaten.find((x) => x.id === z.id);
    if (schon) {
      if (schon.menge !== null && menge !== null) schon.menge += menge;
      continue;
    }
    zutaten.push({
      id: z.id,
      name: z.name,
      quelle: z.quelle,
      farbe: z.farbe,
      art: z.art,
      einheit: z.einheit,
      menge,
      portionen: null,
      kosten_cent: null,
      bald_verbrauchen: z.bald_verbrauchen,
      geoeffnet: z.geoeffnet,
      zusammensetzung: z.zusammensetzung,
      block_typ_id: z.block_typ_id,
    });
  }

  // Nie mehr einplanen als vorhanden – der Rest fehlt. Danach Portionen und Wert je Zutat.
  for (const z of zutaten) {
    const s = snapshot.zutaten.find((x) => x.id === z.id);
    if (!s || z.menge === null) continue;
    if (typeof s.anzahl === 'number' && z.menge > s.anzahl) {
      fehltName(z.name, 'zu_wenig', z.menge - s.anzahl, s);
      z.menge = s.anzahl;
    }
    z.portionen = portionenAusMenge(z.menge, s.portion_menge);
    z.kosten_cent = verbrauchswert(z.menge, s);
  }

  for (const f of Array.isArray(roh.fehlt) ? roh.fehlt : []) {
    const n = kuerze(f?.name, 60);
    if (!n) continue;
    // Schlägt die KI etwas als „fehlt“ vor, das wir haben, ignorieren wir den Eintrag.
    if (findeImSnapshot(snapshot, null, n)) continue;
    const menge = Math.round(Number(f?.menge));
    fehltName(n, 'nicht_im_bestand', Number.isFinite(menge) && menge > 0 && menge <= 10_000 ? menge : null, undefined, f?.einheit);
  }

  // Zubereitung: Was dort vorkommt, aber im ganzen Haushalt nicht existiert, fehlt ehrlich.
  const haushalt = deckungstext([
    ...snapshot.zutaten.flatMap((z) => [z.name, ...(z.zusammensetzung ?? [])]),
    ...fehlt.map((f) => f.name),
  ]);
  const rohSchritte = (Array.isArray(roh.schritte) ? roh.schritte : []).map((s) => kuerze(s, 200)).filter(Boolean).slice(0, 8);
  for (const schritt of rohSchritte) {
    for (const n of ungedeckt(schritt, haushalt)) fehltName(n, 'nicht_im_bestand', null);
  }

  const echte = zutaten.filter((z) => z.quelle !== 'grundausstattung');
  if (echte.length === 0) return { ok: false, grund: `${rohName}: keine vorhandenen Zutaten` };
  if (fehlt.length > MAX_FEHLEND) return { ok: false, grund: `${rohName}: zu viele fehlende Zutaten (${fehlt.length})` };

  // Texte: nur Zutaten, die wirklich in DIESEM Gericht stecken (oder ehrlich als fehlend markiert sind).
  const regeln = regelnFuer(zutaten, snapshot);
  const gericht = deckungstext([
    ...zutaten.flatMap((z) => [z.name, ...(z.zusammensetzung ?? [])]),
    ...fehlt.map((f) => f.name),
    ...GRUNDAUSSTATTUNG,
  ]);
  const name = pruefeName(rohName, gericht, regeln);
  if ('fehler' in name) return { ok: false, grund: `${rohName}: ${name.fehler}` };

  const gerichtsart = gerichtsartVon(zutaten);
  const beschreibung = bereinigeText(kuerze(roh.beschreibung, 220), gericht, regeln).text;
  const deckungSchritte = deckungstext([haushalt, ...fehlt.map((f) => f.name)]);

  return {
    ok: true,
    wert: {
      art: 'gericht',
      id,
      name: kuerze(name.name, 60),
      emoji: kuerze(roh.emoji, 8) || '🍽️',
      beschreibung: kuerze(beschreibung, 180) || ersatzBeschreibung(gerichtsart, zutaten),
      gerichtsart,
      zutaten,
      fehlt,
      zeit_min: ganzzahl(roh.zeit_min, 1, 240, gerichtsart === 'rezept' ? 20 : 10),
      portionen: personen,
      schritte: rohSchritte.map((s) => bereinigeText(s, deckungSchritte, regeln).text).filter(Boolean),
      begruendung: kuerze(bereinigeText(kuerze(roh.begruendung, 300), gericht, regeln).text, 240),
      warum_jetzt: warumJetzt(zutaten, fehlt, snapshot),
      rettet: rettetVon(zutaten, snapshot),
      hinweise: hinweiseVon(zutaten),
      eigenschaften: normalisiereEigenschaften(roh.eigenschaften, name.name),
      kosten: berechneKosten(zutaten, fehlt, personen),
      bewertung: 0,
    },
  };
}

export function pruefeBaustein(roh: RohBaustein | null | undefined, snapshot: Snapshot, id: string): BausteinIdee | null {
  const rohName = kuerze(roh?.name, 60);
  if (!roh || !rohName) return null;
  const art = ausListe(roh.art, ARTEN, 'komponente');
  const farbe = FARBEN.find((f) => f === normalisiere(String(roh.farbe ?? ''))) ?? (art === 'komplettgericht' ? 'blau' : null);
  if (!farbe) return null;
  const verwendbar = (Array.isArray(roh.verwendbar_fuer) ? roh.verwendbar_fuer : [])
    .map((v) => kuerze(v, 50))
    .filter(Boolean)
    .slice(0, 8);
  if (verwendbar.length < (art === 'komplettgericht' ? 1 : 3)) return null; // ein Baustein soll vielseitig sein
  const portionen = ganzzahl(roh.portionen, 1, 20, 6);

  // Zutaten: vorhandene mit Menge und Preis, der Rest wird eingekauft (Preis unbekannt).
  const zutaten: string[] = [];
  const posten: KostenPosten[] = [];
  for (const rz of (Array.isArray(roh.zutaten) ? roh.zutaten : []).slice(0, 12)) {
    const z = findeImSnapshot(snapshot, rz?.id, rz?.name);
    const name = z?.name ?? kuerze(rz?.name, 40);
    if (!name || zutaten.includes(name)) continue;
    zutaten.push(name);
    if (z?.quelle === 'grundausstattung') continue;
    if (z?.quelle === 'bestand') {
      const menge = mengeAusPortionen(portionenAus(rz, z, 1), z.einheit, z.portion_menge);
      posten.push({ name, cent: verbrauchswert(menge, z) });
    } else {
      posten.push({ name, cent: null });
    }
  }

  const regeln: Regeln = { hausgemacht_erlaubt: true }; // wird ja selbst gekocht
  const deckung = deckungstext([...zutaten, ...snapshot.zutaten.map((z) => z.name), ...GRUNDAUSSTATTUNG]);
  const name = pruefeName(rohName, deckung, regeln);
  if ('fehler' in name) return null;

  const pg = Number(roh.portion_g);
  return {
    art: 'baustein',
    id,
    name: name.name,
    bestandsart: art,
    farbe,
    lagerort: ausListe(roh.lagerort, LAGERORTE, 'gefrierfach'),
    portionen,
    portion_g: Number.isFinite(pg) && pg >= 20 && pg <= 1000 ? Math.round(pg) : null,
    zutaten,
    verwendbar_fuer: verwendbar,
    kosten: summiereKosten(posten.length ? posten : [{ name: rohName, cent: null }], portionen),
    begruendung: kuerze(bereinigeText(kuerze(roh.begruendung, 300), deckung, regeln).text, 240),
  };
}
