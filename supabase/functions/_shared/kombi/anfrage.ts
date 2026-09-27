// Prüft eine eingehende Anfrage (z. B. in der Edge Function), bevor sie zur KI geht:
// feste Struktur, begrenzte Größen, nur erwartete Felder. So kann die Funktion nicht als
// allgemeiner KI-Zugang missbraucht werden.
import type {
  Aktion, FeedbackEintrag, GerichtKurz, KiAnfrage, Modus, Optionen, Snapshot, SnapshotZutat,
} from './typen.ts';
import { normalisiereEigenschaften } from './validierung.ts';
import { kuerze } from './text.ts';

const GRENZEN = { zutaten: 300, preise: 300, gesehen: 60, feedback: 120, anzahl: 5 };
const QUELLEN = ['bestand', 'kuehlschrank', 'grundausstattung'] as const;
const FARBEN = ['rot', 'braun', 'gruen', 'gelb', 'weiss', 'schwarz', 'blau'] as const;
const LAGERORTE = ['gefrierfach', 'kuehlschrank', 'vorrat'] as const;
const AKTIONEN: Aktion[] = ['like', 'dislike', 'similar', 'skip', 'save', 'cook'];

export class AnfrageFehler extends Error {}

const liste = (x: unknown, max: number): unknown[] => (Array.isArray(x) ? x.slice(0, max) : []);
const zahlOderNull = (x: unknown, min: number, max: number): number | null => {
  const n = Number(x);
  return x === null || x === undefined || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, Math.round(n)));
};
const eins = <T extends string>(x: unknown, erlaubt: readonly T[]): T | null =>
  erlaubt.find((e) => e === x) ?? null;

function zutat(x: unknown): SnapshotZutat | null {
  const z = x as Record<string, unknown>;
  const quelle = eins(z?.quelle, QUELLEN);
  const id = kuerze(z?.id, 40);
  const name = kuerze(z?.name, 80);
  if (!quelle || !id || !name) return null;
  return {
    id,
    quelle,
    name,
    farbe: eins(z.farbe, FARBEN),
    lagerort: eins(z.lagerort, LAGERORTE),
    anzahl: zahlOderNull(z.anzahl, 0, 9999),
    groesse_g: zahlOderNull(z.groesse_g, 1, 100000),
    kosten_cent: zahlOderNull(z.kosten_cent, 0, 100000),
    bald_verbrauchen: z.bald_verbrauchen === true,
    block_typ_id: zahlOderNull(z.block_typ_id, 1, Number.MAX_SAFE_INTEGER),
  };
}

function gerichtKurz(x: unknown): GerichtKurz | null {
  const g = x as Record<string, unknown>;
  const name = kuerze(g?.name, 80);
  if (!name) return null;
  return {
    name,
    eigenschaften: normalisiereEigenschaften(g.eigenschaften as Record<string, unknown>, name),
    zutaten: liste(g.zutaten, 20).map((z) => kuerze(z, 80)).filter(Boolean),
  };
}

export function pruefeAnfrage(roh: unknown): KiAnfrage {
  const a = roh as Record<string, unknown>;
  if (!a || typeof a !== 'object') throw new AnfrageFehler('Anfrage fehlt.');
  const s = a.snapshot as Record<string, unknown>;
  if (!s || !Array.isArray(s.zutaten)) throw new AnfrageFehler('Snapshot fehlt.');

  const snapshot: Snapshot = {
    datum: kuerze(s.datum, 30),
    zutaten: liste(s.zutaten, GRENZEN.zutaten).map(zutat).filter((z): z is SnapshotZutat => z !== null),
    preise: liste(s.preise, GRENZEN.preise)
      .map((p) => p as Record<string, unknown>)
      .map((p) => ({ name: kuerze(p?.name, 80), kosten_cent: zahlOderNull(p?.kosten_cent, 0, 100000) }))
      .filter((p): p is { name: string; kosten_cent: number } => !!p.name && p.kosten_cent !== null),
  };

  const o = (a.optionen ?? {}) as Record<string, unknown>;
  const optionen: Optionen = {
    personen: zahlOderNull(o.personen, 1, 12) ?? 2,
    max_minuten: zahlOderNull(o.max_minuten, 5, 240),
    guenstig: o.guenstig !== false,
  };

  const gesehen = liste(a.gesehen, GRENZEN.gesehen).map(gerichtKurz).filter((g): g is GerichtKurz => g !== null);
  const feedback: FeedbackEintrag[] = [];
  for (const f of liste(a.feedback, GRENZEN.feedback)) {
    const e = f as Record<string, unknown>;
    const g = gerichtKurz(e);
    const aktion = eins(e?.aktion, AKTIONEN);
    if (g && aktion) feedback.push({ ...g, aktion, vorschlag_id: kuerze(e.vorschlag_id, 60) });
  }

  const m = a.modus as Record<string, unknown> | undefined;
  const anker = m?.art === 'aehnlich' ? gerichtKurz(m.zu) : null;
  const modus: Modus = anker ? { art: 'aehnlich', zu: anker } : { art: 'normal' };

  return {
    snapshot,
    optionen,
    gesehen,
    feedback,
    modus,
    anzahl: zahlOderNull(a.anzahl, 1, GRENZEN.anzahl) ?? 3,
  };
}
