// Kalorien und Nährwerte – ausschließlich aus hinterlegten Daten, nie geschätzt.
//
// Nährwerte stehen je Sorte wie der Preis: „X kcal für N Einheiten“ (z. B. 359 kcal für 100 g).
// null heißt unbekannt – nicht 0. Fehlt ein Wert, wird nichts ergänzt: Das Ergebnis ist dann
// „teilweise“ (Summe der bekannten, mit Liste des Unbekannten) oder „unbekannt“.
import type { Einheit, FehlendeZutat, GerichtZutat } from './typen.ts';
import { normalisiere } from './text.ts';

export type Naehrwert = {
  kcal: number | null;
  protein_g: number | null;
  kohlenhydrate_g: number | null;
  fett_g: number | null;
  /** Menge (in der Einheit der Sorte), auf die sich die Werte beziehen */
  menge: number;
};

export type NaehrwertStatus = 'berechnet' | 'teilweise' | 'unbekannt';

export type Naehrwerte = {
  status: NaehrwertStatus;
  /** Summe der bekannten kcal des ganzen Gerichts; null = keine bekannt */
  kcal_gesamt: number | null;
  /** kcal_gesamt ÷ Portionen (bei „teilweise“ nur der bekannte Teil) */
  kcal_portion: number | null;
  /** je Portion – nur, wenn alles berechnet ist und der Wert für jede Zutat bekannt ist */
  protein_g: number | null;
  kohlenhydrate_g: number | null;
  fett_g: number | null;
  portionen: number;
  /** Zutaten ohne bekannte Nährwerte bzw. ohne bekannte Menge */
  unbekannt: string[];
};

/** Grundausstattung ohne Kalorien (Tatsache, keine Schätzung). Öl hat Kalorien, die Menge ist aber unbekannt. */
const OHNE_KALORIEN = new Set(['wasser', 'salz', 'pfeffer']);

/** Bezugsmenge: hinterlegt, sonst 100 g/ml bzw. 1 Portion/Stück. */
export function naehrwertMenge(menge: number | null | undefined, einheit: Einheit): number {
  if (menge && menge > 0) return menge;
  return einheit === 'g' || einheit === 'ml' ? 100 : 1;
}

/** Aus Datenbankwerten; ohne kcal gibt es keinen verwertbaren Nährwert (null). */
export function naehrwertAus(z: {
  kcal?: number | string | null; protein_g?: number | string | null; kohlenhydrate_g?: number | string | null;
  fett_g?: number | string | null; naehrwert_menge?: number | null;
}, einheit: Einheit): Naehrwert | null {
  const zahl = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  const kcal = zahl(z.kcal);
  if (kcal === null) return null;
  return {
    kcal,
    protein_g: zahl(z.protein_g),
    kohlenhydrate_g: zahl(z.kohlenhydrate_g),
    fett_g: zahl(z.fett_g),
    menge: naehrwertMenge(z.naehrwert_menge, einheit),
  };
}

export type NaehrwertPosten = {
  name: string;
  /** Menge in der Einheit der Sorte; null = unbekannt */
  menge: number | null;
  naehrwert: Naehrwert | null;
};

const runde1 = (x: number) => Math.round(x * 10) / 10;

/** Summiert Nährwerte. Wasser, Salz und Pfeffer zählen als 0 kcal, alles ohne Daten als unbekannt. */
export function summiereNaehrwerte(posten: NaehrwertPosten[], portionen: number): Naehrwerte {
  const p = Math.max(1, Math.round(portionen) || 1);
  const relevant = posten.filter((x) => !OHNE_KALORIEN.has(normalisiere(x.name)));
  const bekannt = relevant.filter((x) => x.menge !== null && x.naehrwert !== null && x.naehrwert.kcal !== null);
  const unbekannt = [...new Set(relevant.filter((x) => !bekannt.includes(x)).map((x) => x.name))];
  const anteil = (x: NaehrwertPosten) => (x.menge as number) / Math.max(1, (x.naehrwert as Naehrwert).menge);

  const status: NaehrwertStatus = bekannt.length === 0 ? 'unbekannt' : unbekannt.length ? 'teilweise' : 'berechnet';
  const kcal = bekannt.length ? bekannt.reduce((s, x) => s + anteil(x) * (x.naehrwert!.kcal as number), 0) : null;
  const makro = (feld: 'protein_g' | 'kohlenhydrate_g' | 'fett_g') => {
    if (status !== 'berechnet' || bekannt.some((x) => x.naehrwert![feld] === null)) return null;
    return runde1(bekannt.reduce((s, x) => s + anteil(x) * (x.naehrwert![feld] as number), 0) / p);
  };
  return {
    status,
    kcal_gesamt: kcal === null ? null : Math.round(kcal),
    kcal_portion: kcal === null ? null : Math.round(kcal / p),
    protein_g: makro('protein_g'),
    kohlenhydrate_g: makro('kohlenhydrate_g'),
    fett_g: makro('fett_g'),
    portionen: p,
    unbekannt,
  };
}

/**
 * Nährwerte eines Gerichts aus seinen Zutaten. `finde` liefert die hinterlegten Nährwerte einer Sorte
 * (Engine: aus dem Snapshot; App: aus dem aktuellen Bestand – auch für ältere gespeicherte Gerichte).
 * Kühlschrank-Reste und fehlende Zutaten ohne Sorte bleiben unbekannt.
 */
export function naehrwerteFuerGericht(
  g: { zutaten: Pick<GerichtZutat, 'name' | 'quelle' | 'menge' | 'block_typ_id'>[]; fehlt: Pick<FehlendeZutat, 'name' | 'grund' | 'menge'>[]; portionen: number },
  finde: (blockTypId: number | null, name: string) => Naehrwert | null,
): Naehrwerte {
  const posten: NaehrwertPosten[] = g.zutaten.map((z) => ({
    name: z.name,
    menge: z.quelle === 'bestand' ? z.menge : null,
    naehrwert: z.quelle === 'bestand' ? finde(z.block_typ_id, z.name) : null,
  }));
  for (const f of g.fehlt) {
    // „zu wenig“: der Rest kommt aus dem Einkauf derselben Sorte – deren Werte sind bekannt, falls hinterlegt
    const sorte = f.grund === 'zu_wenig' ? g.zutaten.find((z) => z.name === f.name) : undefined;
    posten.push({ name: f.name, menge: f.menge, naehrwert: sorte ? finde(sorte.block_typ_id, f.name) : null });
  }
  return summiereNaehrwerte(posten, g.portionen);
}

/** „620 kcal / Portion“, „ab 450 kcal / Portion“ (teilweise), „kcal unbekannt“ */
export function kcalText(n: Naehrwerte | null | undefined, proPortion = true): string {
  if (!n || n.status === 'unbekannt' || n.kcal_portion === null) return 'kcal unbekannt';
  const wert = (proPortion ? n.kcal_portion : n.kcal_gesamt ?? 0).toLocaleString('de-DE');
  return `${n.status === 'teilweise' ? 'ab ' : ''}${wert} kcal${proPortion ? ' / Portion' : ''}`;
}

export const UNBEKANNTE_NAEHRWERTE: Naehrwerte = {
  status: 'unbekannt', kcal_gesamt: null, kcal_portion: null, protein_g: null, kohlenhydrate_g: null, fett_g: null, portionen: 1, unbekannt: [],
};
