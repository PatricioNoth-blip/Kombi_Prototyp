// Navigation: fünf Bereiche, Adressen zum Verlinken (#/vorrat/gefrierfach) und Zurück wie gewohnt.
// Was man in einem Bereich geöffnet, gefiltert oder gescrollt hat, bleibt beim Wechsel erhalten.
// Rein und ohne Laufzeit-Importe, damit es sich ohne Browser testen lässt.
import type { Art } from '../supabase/functions/_shared/kombi/typen.ts';
import type { IconName } from './Icon';

export type Bereich = 'start' | 'essen' | 'vorrat' | 'produktion' | 'einkauf';
export type VorratOrt = 'gefrierfach' | 'kuehlschrank' | 'vorrat' | 'alle';

export const BEREICHE: { id: Bereich; name: string; icon: IconName }[] = [
  { id: 'start', name: 'Start', icon: 'haus' },
  { id: 'essen', name: 'Essen', icon: 'essen' },
  { id: 'vorrat', name: 'Vorrat', icon: 'vorrat' },
  { id: 'produktion', name: 'Produktion', icon: 'topf' },
  { id: 'einkauf', name: 'Einkauf', icon: 'wagen' },
];

export type NavZustand = {
  bereich: Bereich;
  vorrat: { ort: VorratOrt | null; art: Art | null; suche: string };
  essen: { ansicht: 'heute' | 'woche' };
  /** geöffnete Sorte (Detail) – gehört zur Adresse, damit „Zurück“ sie schließt */
  sorte: number | null;
  /** Scrollposition je Bereich */
  scroll: Record<Bereich, number>;
};

export type Route = {
  bereich: Bereich;
  ort: VorratOrt | null;
  art: Art | null;
  ansicht: 'heute' | 'woche';
  sorte: number | null;
};

export type NavAktion =
  | { typ: 'wechsle'; bereich: Bereich; scroll: number }
  | { typ: 'vorrat'; teil: Partial<NavZustand['vorrat']> }
  | { typ: 'essen'; teil: Partial<NavZustand['essen']> }
  | { typ: 'sorte'; id: number | null }
  | { typ: 'route'; route: Route };

export const START: NavZustand = {
  bereich: 'start',
  vorrat: { ort: null, art: null, suche: '' },
  essen: { ansicht: 'heute' },
  sorte: null,
  scroll: { start: 0, essen: 0, vorrat: 0, produktion: 0, einkauf: 0 },
};

const BEREICH_IDS = BEREICHE.map((b) => b.id) as string[];
const ORTE: string[] = ['gefrierfach', 'kuehlschrank', 'vorrat', 'alle'];
const ARTEN: string[] = ['zutat', 'komponente', 'komplettgericht'];

/** Tab antippen: Wechsel merkt sich die Scrollposition; nochmal auf den aktiven Tab = zurück zum Anfang. */
export function navigiere(z: NavZustand, a: NavAktion): NavZustand {
  switch (a.typ) {
    case 'wechsle':
      if (a.bereich === z.bereich) {
        return {
          ...z,
          vorrat: a.bereich === 'vorrat' ? { ...z.vorrat, ort: null, suche: '' } : z.vorrat,
          essen: a.bereich === 'essen' ? { ansicht: 'heute' } : z.essen,
          sorte: null,
          scroll: { ...z.scroll, [a.bereich]: 0 },
        };
      }
      return { ...z, bereich: a.bereich, sorte: null, scroll: { ...z.scroll, [z.bereich]: Math.max(0, a.scroll) } };
    case 'vorrat': {
      const vorrat = { ...z.vorrat, ...a.teil };
      // neuer Lagerort → Art-Filter zurücksetzen und oben anfangen
      const ortNeu = a.teil.ort !== undefined && a.teil.ort !== z.vorrat.ort;
      return {
        ...z,
        vorrat: ortNeu && a.teil.art === undefined ? { ...vorrat, art: null } : vorrat,
        scroll: ortNeu ? { ...z.scroll, vorrat: 0 } : z.scroll,
      };
    }
    case 'essen':
      return { ...z, essen: { ...z.essen, ...a.teil } };
    case 'sorte':
      return { ...z, sorte: a.id };
    case 'route': {
      const r = a.route;
      return {
        ...z,
        bereich: r.bereich,
        vorrat: r.bereich === 'vorrat' ? { ...z.vorrat, ort: r.ort, art: r.ort ? r.art : null } : z.vorrat,
        essen: r.bereich === 'essen' ? { ansicht: r.ansicht } : z.essen,
        sorte: r.sorte,
      };
    }
  }
}

// ───────── Adressen ─────────

/** „#/vorrat/gefrierfach?art=komponente&sorte=12“ → Route. Unbekanntes → Start. */
export function routeAus(hash: string): Route {
  const leer: Route = { bereich: 'start', ort: null, art: null, ansicht: 'heute', sorte: null };
  const [pfad, abfrage = ''] = hash.replace(/^#\/?/, '').split('?');
  const teile = pfad.split('/').filter(Boolean).map((t) => decodeURIComponent(t));
  const q = new Map(abfrage.split('&').filter(Boolean).map((p) => {
    const [k, v = ''] = p.split('=');
    return [k, decodeURIComponent(v)] as const;
  }));
  // „komponenten“ gab es bis Version 3 als eigenen Bereich
  const bereichRoh = teile[0] === 'komponenten' ? 'produktion' : teile[0];
  const bereich = BEREICH_IDS.includes(bereichRoh) ? (bereichRoh as Bereich) : 'start';
  const sorteRoh = Number(q.get('sorte'));
  const sorte = Number.isInteger(sorteRoh) && sorteRoh > 0 ? sorteRoh : null;
  const ort = bereich === 'vorrat' && ORTE.includes(teile[1]) ? (teile[1] as VorratOrt) : null;
  const art = ort && ARTEN.includes(q.get('art') ?? '') ? (q.get('art') as Art) : null;
  return { ...leer, bereich, ort, art, ansicht: bereich === 'essen' && teile[1] === 'woche' ? 'woche' : 'heute', sorte };
}

/** Adresse des aktuellen Zustands. */
export function hashVon(z: NavZustand): string {
  let pfad = `#/${z.bereich}`;
  const q: string[] = [];
  if (z.bereich === 'vorrat' && z.vorrat.ort) {
    pfad += `/${z.vorrat.ort}`;
    if (z.vorrat.art) q.push(`art=${z.vorrat.art}`);
  }
  if (z.bereich === 'essen' && z.essen.ansicht === 'woche') pfad += '/woche';
  if (z.sorte !== null) q.push(`sorte=${z.sorte}`);
  return q.length ? `${pfad}?${q.join('&')}` : pfad;
}

/** Neuer Verlaufseintrag (Zurück führt dorthin zurück) – oder nur die Adresse ersetzen (Filter). */
export function neuerEintrag(alt: NavZustand, neu: NavZustand): boolean {
  return alt.bereich !== neu.bereich || alt.vorrat.ort !== neu.vorrat.ort || alt.essen.ansicht !== neu.essen.ansicht
    || (alt.sorte === null && neu.sorte !== null);
}

// ───────── Gemerkt für den nächsten Start ─────────

/**
 * Gemerkter Zustand: nur Filter (Art im Vorrat, Essen/Woche). Die App öffnet immer mit dem Start –
 * außer ein Link zeigt woandershin (dann bestimmt die Adresse den Bereich).
 */
export function ladeNav(text: string | null, hash = ''): NavZustand {
  let gemerkt: NavZustand = START;
  if (text && text.startsWith('{')) {
    try {
      const d = JSON.parse(text) as Record<string, unknown>;
      const e = (d.essen ?? {}) as Record<string, unknown>;
      gemerkt = { ...START, essen: { ansicht: e.ansicht === 'woche' ? 'woche' : 'heute' } };
    } catch {
      gemerkt = START;
    }
  }
  return hash && hash !== '#' && hash !== '#/' ? navigiere(gemerkt, { typ: 'route', route: routeAus(hash) }) : gemerkt;
}

export function speichereNav(z: NavZustand): string {
  return JSON.stringify({ essen: z.essen });
}
