// Prüft die Rohantwort einer KI gegen den Snapshot.
// Die KI darf NICHTS als vorhanden ausgeben, was nicht im Snapshot steht, und rechnet keine Preise:
//   • Zutaten ohne gültige id/Namen im Snapshot → „fehlt“ (nie „vorhanden“)
//   • mehr Blöcke als vorhanden → Rest „fehlt“
//   • Kosten und Portionen rechnet ausschließlich dieser Code
import type {
  BausteinIdee, Eigenschaften, FehlendeZutat, Gericht, GerichtZutat, Kosten, Optionen,
  RohBaustein, RohGericht, Snapshot, SnapshotZutat,
} from './typen.ts';
import {
  GERICHTSTYPEN, GESCHMACK, GEWUERZRICHTUNGEN, KONSISTENZ, SATTMACHER, ZUBEREITUNG,
} from './typen.ts';
import { bekannterPreis } from './snapshot.ts';
import { ausListe, kuerze, normalisiere } from './text.ts';

const FARBEN = ['rot', 'braun', 'gruen', 'gelb', 'weiss', 'schwarz', 'blau'] as const;

/** Mehr fehlende Zutaten sind kein „Essen aus dem Vorrat“ mehr. */
export const MAX_FEHLEND = 3;
const MAX_BLOECKE = 24;

export type Pruefung<T> = { ok: true; wert: T } | { ok: false; grund: string };

export function normalisiereEigenschaften(roh: Record<string, unknown> | undefined, name: string): Eigenschaften {
  const e = roh ?? {};
  const schaerfe = Math.round(Number(e.schaerfe));
  return {
    gerichtstyp: ausListe(e.gerichtstyp, GERICHTSTYPEN, 'sonstiges'),
    hauptzutat: normalisiere(kuerze(e.hauptzutat, 40)) || normalisiere(name).split(' ')[0] || 'unbekannt',
    geschmack: ausListe(e.geschmack, GESCHMACK, 'herzhaft'),
    schaerfe: (Number.isFinite(schaerfe) ? Math.min(3, Math.max(0, schaerfe)) : 0) as Eigenschaften['schaerfe'],
    konsistenz: ausListe(e.konsistenz, KONSISTENZ, 'stueckig'),
    sattmacher: ausListe(e.sattmacher, SATTMACHER, 'sonstiges'),
    gewuerzrichtung: ausListe(e.gewuerzrichtung, GEWUERZRICHTUNGEN, 'neutral'),
    zubereitung: ausListe(e.zubereitung, ZUBEREITUNG, 'pfanne'),
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

/** Kosten nur aus Bestandspreisen: Blöcke × Preis pro Block, geteilt durch Personen. */
export function berechneKosten(zutaten: GerichtZutat[], fehlt: FehlendeZutat[], personen: number): Kosten {
  let gesamt = 0;
  let vollstaendig = true;
  for (const z of zutaten) {
    if (z.quelle === 'grundausstattung') continue;
    if (z.quelle === 'kuehlschrank' || z.kosten_cent === null || z.bloecke === null) {
      vollstaendig = false;
      continue;
    }
    gesamt += z.bloecke * z.kosten_cent;
  }
  const einkauf = fehlt.reduce((s, f) => s + (f.preis_cent ?? 0) * (f.menge ?? 1), 0);
  const p = Math.max(1, personen);
  return {
    gesamt_cent: gesamt,
    pro_portion_cent: Math.round(gesamt / p),
    personen: p,
    vollstaendig,
    einkauf_cent: einkauf,
  };
}

export function warumJetzt(zutaten: GerichtZutat[], fehlt: FehlendeZutat[]): string[] {
  const gruende: string[] = [];
  if (fehlt.length === 0) gruende.push('Du hast alles zuhause.');
  else if (fehlt.length === 1) gruende.push('Du hast fast alles zuhause.');
  const bald = zutaten.filter((z) => z.bald_verbrauchen);
  const ausBestand = bald.filter((z) => z.quelle === 'bestand').map((z) => z.name);
  const ausKuehlschrank = bald.filter((z) => z.quelle === 'kuehlschrank').map((z) => z.name);
  if (ausBestand.length) gruende.push(`${ausBestand.join(', ')} sollte bald verbraucht werden.`);
  if (ausKuehlschrank.length) gruende.push(`Verwertet deine Reste: ${ausKuehlschrank.join(', ')}.`);
  return gruende;
}

export function pruefeGericht(roh: RohGericht, snapshot: Snapshot, optionen: Optionen, id: string): Pruefung<Gericht> {
  const name = kuerze(roh.name, 80);
  if (!name) return { ok: false, grund: 'Gericht ohne Namen' };

  const zutaten: GerichtZutat[] = [];
  const fehlt: FehlendeZutat[] = [];
  const fehltName = (n: string, grund: FehlendeZutat['grund'], menge: number | null) => {
    if (!n) return;
    const vorhanden = fehlt.find((f) => normalisiere(f.name) === normalisiere(n));
    if (vorhanden) return;
    fehlt.push({ name: n, grund, menge, preis_cent: bekannterPreis(snapshot, n) });
  };

  for (const rz of Array.isArray(roh.zutaten) ? roh.zutaten : []) {
    const z = findeImSnapshot(snapshot, rz?.id, rz?.name);
    if (!z) {
      // Die KI hat etwas als vorhanden ausgegeben, das es nicht gibt → gehört zu „fehlt“.
      fehltName(kuerze(rz?.name ?? rz?.id, 60), 'nicht_im_bestand', null);
      continue;
    }
    const bloecke = z.quelle === 'bestand' ? ganzzahl(rz?.bloecke, 1, MAX_BLOECKE, 1) : null;
    const schon = zutaten.find((x) => x.id === z.id);
    if (schon) {
      if (schon.bloecke !== null && bloecke !== null) schon.bloecke += bloecke;
      continue;
    }
    zutaten.push({
      id: z.id,
      name: z.name,
      quelle: z.quelle,
      farbe: z.farbe,
      bloecke,
      kosten_cent: z.kosten_cent,
      bald_verbrauchen: z.bald_verbrauchen,
      block_typ_id: z.block_typ_id,
    });
  }

  // Nie mehr einplanen als vorhanden – der Rest fehlt.
  for (const z of zutaten) {
    const verfuegbar = snapshot.zutaten.find((s) => s.id === z.id)?.anzahl;
    if (z.bloecke !== null && typeof verfuegbar === 'number' && z.bloecke > verfuegbar) {
      fehltName(z.name, 'zu_wenig', z.bloecke - verfuegbar);
      z.bloecke = verfuegbar;
    }
  }

  for (const f of Array.isArray(roh.fehlt) ? roh.fehlt : []) {
    const n = kuerze(f?.name, 60);
    if (!n) continue;
    // Schlägt die KI etwas als „fehlt“ vor, das wir haben, ignorieren wir den Eintrag.
    if (findeImSnapshot(snapshot, null, n)) continue;
    fehltName(n, 'nicht_im_bestand', null);
  }

  const echte = zutaten.filter((z) => z.quelle !== 'grundausstattung');
  if (echte.length === 0) return { ok: false, grund: `${name}: keine vorhandenen Zutaten` };
  if (fehlt.length > MAX_FEHLEND) return { ok: false, grund: `${name}: zu viele fehlende Zutaten (${fehlt.length})` };

  const kosten = berechneKosten(zutaten, fehlt, optionen.personen);
  return {
    ok: true,
    wert: {
      art: 'gericht',
      id,
      name,
      emoji: kuerze(roh.emoji, 8) || '🍽️',
      zutaten,
      fehlt,
      zeit_min: ganzzahl(roh.zeit_min, 1, 240, 20),
      schritte: (Array.isArray(roh.schritte) ? roh.schritte : []).map((s) => kuerze(s, 200)).filter(Boolean).slice(0, 8),
      begruendung: kuerze(roh.begruendung, 300),
      warum_jetzt: warumJetzt(zutaten, fehlt),
      eigenschaften: normalisiereEigenschaften(roh.eigenschaften, name),
      kosten,
      bewertung: 0,
    },
  };
}

export function pruefeBaustein(roh: RohBaustein | null | undefined, id: string): BausteinIdee | null {
  if (!roh || !kuerze(roh.name, 60)) return null;
  const farbe = FARBEN.find((f) => f === normalisiere(String(roh.farbe ?? '')));
  if (!farbe) return null;
  const verwendbar = (Array.isArray(roh.verwendbar_fuer) ? roh.verwendbar_fuer : [])
    .map((v) => kuerze(v, 50))
    .filter(Boolean)
    .slice(0, 8);
  if (verwendbar.length < 3) return null; // ein Baustein soll vielseitig sein
  return {
    art: 'baustein',
    id,
    name: kuerze(roh.name, 60),
    farbe,
    portionen: ganzzahl(roh.portionen, 1, 20, 6),
    verwendbar_fuer: verwendbar,
    begruendung: kuerze(roh.begruendung, 240),
  };
}
