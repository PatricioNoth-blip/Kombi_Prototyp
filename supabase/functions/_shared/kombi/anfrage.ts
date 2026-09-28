// Prüft eine eingehende Anfrage (z. B. in der Edge Function), bevor sie zur KI geht:
// feste Struktur, begrenzte Größen, nur erwartete Felder. So kann die Funktion nicht als
// allgemeiner KI-Zugang missbraucht werden.
import { naehrwertAus } from './naehrwerte.ts';
import type {
  Aktion, FeedbackEintrag, GerichtKurz, KiAnfrage, Modus, Optionen, PreisInfo, Snapshot, SnapshotZutat,
} from './typen.ts';
import { ARTEN, EINHEITEN } from './typen.ts';
import { normalisiereEigenschaften } from './validierung.ts';
import { saubereGerichtstypen, saubereRichtung, saubereZusammensetzung } from './snapshot.ts';
import { kuerze } from './text.ts';

const GRENZEN = { zutaten: 300, preise: 300, gesehen: 60, feedback: 120, favoriten: 10, anzahl: 5, woche: 7 };
const AUFGABEN = ['gerichte', 'komponenten', 'woche'] as const;
const MAX_MENGE = 1_000_000;
const QUELLEN = ['bestand', 'kuehlschrank', 'grundausstattung'] as const;
const FARBEN = ['rot', 'braun', 'gruen', 'gelb', 'weiss', 'schwarz', 'blau'] as const;
const LAGERORTE = ['gefrierfach', 'kuehlschrank', 'vorrat'] as const;
const AKTIONEN: Aktion[] = ['like', 'dislike', 'similar', 'skip', 'save', 'cook'];
const HERKUENFTE = ['selbstgemacht', 'gekauft'] as const;

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
  const einheit = eins(z.einheit, EINHEITEN) ?? 'portion';
  return {
    id,
    quelle,
    name,
    farbe: eins(z.farbe, FARBEN),
    lagerort: eins(z.lagerort, LAGERORTE),
    art: eins(z.art, ARTEN),
    herkunft: eins(z.herkunft, HERKUENFTE),
    einheit,
    anzahl: zahlOderNull(z.anzahl, 0, MAX_MENGE),
    portion_menge: einheit === 'portion' ? 1 : zahlOderNull(z.portion_menge, 1, MAX_MENGE) ?? 1,
    groesse_g: zahlOderNull(z.groesse_g, 1, 100000),
    kosten_cent: zahlOderNull(z.kosten_cent, 0, 1_000_000),
    kosten_menge: zahlOderNull(z.kosten_menge, 1, MAX_MENGE) ?? 1,
    zusammensetzung: saubereZusammensetzung(z.zusammensetzung),
    notiz: kuerze(z.notiz, 200) || null,
    bald_verbrauchen: z.bald_verbrauchen === true,
    geoeffnet: z.geoeffnet === true,
    rest: z.rest === true,
    tage_bis_ablauf: zahlOderNull(z.tage_bis_ablauf, -3650, 3650),
    aufgetaut: z.aufgetaut === true,
    gerichtstypen: saubereGerichtstypen(z.gerichtstypen),
    richtung: saubereRichtung(z.richtung),
    block_typ_id: zahlOderNull(z.block_typ_id, 1, Number.MAX_SAFE_INTEGER),
    naehrwert: naehrwertVon(z.naehrwert, einheit),
  };
}

/** Nährwerte aus der Anfrage: nur Zahlen ≥ 0, ohne kcal kein Nährwert. */
function naehrwertVon(x: unknown, einheit: SnapshotZutat['einheit']): SnapshotZutat['naehrwert'] {
  const n = x as Record<string, unknown> | null;
  if (!n || typeof n !== 'object') return null;
  // Nährwerte haben Nachkommastellen (0,4 g Fett) – nicht auf ganze Zahlen runden
  const w = (v: unknown) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100_000 ? Math.round(n * 10) / 10 : null;
  };
  return naehrwertAus({ kcal: w(n.kcal), protein_g: w(n.protein_g), kohlenhydrate_g: w(n.kohlenhydrate_g), fett_g: w(n.fett_g),
    naehrwert_menge: zahlOderNull(n.menge, 1, MAX_MENGE) }, einheit);
}

function preis(x: unknown): PreisInfo | null {
  const p = x as Record<string, unknown>;
  const name = kuerze(p?.name, 80);
  const kosten = zahlOderNull(p?.kosten_cent, 0, 1_000_000);
  if (!name || kosten === null) return null;
  const einheit = eins(p.einheit, EINHEITEN) ?? 'portion';
  return {
    name,
    kosten_cent: kosten,
    kosten_menge: zahlOderNull(p.kosten_menge, 1, MAX_MENGE) ?? 1,
    einheit,
    portion_menge: einheit === 'portion' ? 1 : zahlOderNull(p.portion_menge, 1, MAX_MENGE) ?? 1,
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
    preise: liste(s.preise, GRENZEN.preise).map(preis).filter((p): p is PreisInfo => p !== null),
    abgelaufen: liste(s.abgelaufen, 50)
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({ name: kuerze(x?.name, 80), menge: zahlOderNull(x?.menge, 1, MAX_MENGE), einheit: eins(x?.einheit, EINHEITEN) ?? 'portion' }))
      .filter((x): x is Snapshot['abgelaufen'][number] => !!x.name && x.menge !== null),
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
  const modus: Modus = anker ? { art: 'aehnlich', zu: anker } : m?.art === 'reste' ? { art: 'reste' } : { art: 'normal' };
  const aufgabe = eins(a.aufgabe, AUFGABEN) ?? 'gerichte';

  const favoriten = liste(a.favoriten, GRENZEN.favoriten).map(gerichtKurz).filter((g): g is GerichtKurz => g !== null);

  return {
    snapshot,
    optionen,
    gesehen,
    favoriten,
    feedback,
    modus,
    aufgabe,
    anzahl: zahlOderNull(a.anzahl, 1, aufgabe === 'woche' ? GRENZEN.woche : GRENZEN.anzahl) ?? 3,
  };
}
