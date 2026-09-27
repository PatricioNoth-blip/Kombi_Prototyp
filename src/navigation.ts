// Navigation: vier Bereiche. Was man in einem Bereich geöffnet, gefiltert oder gescrollt hat,
// bleibt beim Wechsel erhalten – und wird für den nächsten Start gemerkt.
// Rein und ohne Laufzeit-Importe, damit es sich ohne Browser testen lässt.
import type { Art, Farbe } from '../supabase/functions/_shared/kombi/typen.ts';
import type { IconName } from './Icon';

export type Bereich = 'essen' | 'vorrat' | 'komponenten' | 'einkauf';
export type VorratOrt = 'gefrierfach' | 'kuehlschrank' | 'vorrat' | 'alle';
export type EinkaufFilter = 'alle' | 'geplant' | 'komponente' | 'manuell' | 'mangel';

export const BEREICHE: { id: Bereich; name: string; titel: string; icon: IconName }[] = [
  { id: 'essen', name: 'Essen', titel: 'Essen', icon: 'essen' },
  { id: 'vorrat', name: 'Vorrat', titel: 'Vorrat', icon: 'vorrat' },
  { id: 'komponenten', name: 'Komponenten', titel: 'Komponenten', icon: 'baustein' },
  { id: 'einkauf', name: 'Einkauf', titel: 'Einkauf', icon: 'wagen' },
];

export type NavZustand = {
  bereich: Bereich;
  vorrat: { ort: VorratOrt | null; art: Art | null; suche: string };
  essen: { ansicht: 'heute' | 'woche' };
  komponenten: { rolle: Farbe | null };
  einkauf: { filter: EinkaufFilter; sortierung: 'kategorie' | 'name' };
  /** Scrollposition je Bereich */
  scroll: Record<Bereich, number>;
};

export type NavAktion =
  | { typ: 'wechsle'; bereich: Bereich; scroll: number }
  | { typ: 'vorrat'; teil: Partial<NavZustand['vorrat']> }
  | { typ: 'essen'; teil: Partial<NavZustand['essen']> }
  | { typ: 'komponenten'; teil: Partial<NavZustand['komponenten']> }
  | { typ: 'einkauf'; teil: Partial<NavZustand['einkauf']> };

export const START: NavZustand = {
  bereich: 'vorrat',
  vorrat: { ort: null, art: null, suche: '' },
  essen: { ansicht: 'heute' },
  komponenten: { rolle: null },
  einkauf: { filter: 'alle', sortierung: 'kategorie' },
  scroll: { essen: 0, vorrat: 0, komponenten: 0, einkauf: 0 },
};

const BEREICH_IDS = BEREICHE.map((b) => b.id) as string[];
const ORTE: string[] = ['gefrierfach', 'kuehlschrank', 'vorrat', 'alle'];
const ARTEN: string[] = ['zutat', 'komponente', 'komplettgericht'];
const FARBEN: string[] = ['rot', 'braun', 'gruen', 'gelb', 'weiss', 'schwarz', 'blau'];
const FILTER: string[] = ['alle', 'geplant', 'komponente', 'manuell', 'mangel'];

/** Tab antippen: Wechsel merkt sich die Scrollposition; nochmal auf den aktiven Tab = zurück zum Anfang. */
export function navigiere(z: NavZustand, a: NavAktion): NavZustand {
  switch (a.typ) {
    case 'wechsle':
      if (a.bereich === z.bereich) {
        return {
          ...z,
          vorrat: a.bereich === 'vorrat' ? { ...z.vorrat, ort: null, suche: '' } : z.vorrat,
          scroll: { ...z.scroll, [a.bereich]: 0 },
        };
      }
      return { ...z, bereich: a.bereich, scroll: { ...z.scroll, [z.bereich]: Math.max(0, a.scroll) } };
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
    case 'komponenten':
      return { ...z, komponenten: { ...z.komponenten, ...a.teil } };
    case 'einkauf':
      return { ...z, einkauf: { ...z.einkauf, ...a.teil } };
  }
}

/** Gemerkten Zustand lesen – tolerant: Unbekanntes fällt auf den Start zurück, alte Werte werden übernommen. */
export function ladeNav(text: string | null): NavZustand {
  if (!text) return START;
  // bis Version 2 wurde nur der Reiter als Text gespeichert
  if (text === 'essen') return { ...START, bereich: 'essen' };
  if (text === 'bestand' || text === 'sorten') return START;
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(text);
  } catch {
    return START;
  }
  if (!d || typeof d !== 'object') return START;
  const v = (d.vorrat ?? {}) as Record<string, unknown>;
  const e = (d.essen ?? {}) as Record<string, unknown>;
  const k = (d.komponenten ?? {}) as Record<string, unknown>;
  const ek = (d.einkauf ?? {}) as Record<string, unknown>;
  return {
    bereich: BEREICH_IDS.includes(d.bereich as string) ? (d.bereich as Bereich) : START.bereich,
    vorrat: {
      ort: ORTE.includes(v.ort as string) ? (v.ort as VorratOrt) : null,
      art: ARTEN.includes(v.art as string) ? (v.art as Art) : null,
      suche: '',
    },
    essen: { ansicht: e.ansicht === 'woche' ? 'woche' : 'heute' },
    komponenten: { rolle: FARBEN.includes(k.rolle as string) ? (k.rolle as Farbe) : null },
    einkauf: {
      filter: FILTER.includes(ek.filter as string) ? (ek.filter as EinkaufFilter) : 'alle',
      sortierung: ek.sortierung === 'name' ? 'name' : 'kategorie',
    },
    scroll: START.scroll,
  };
}

/** Was gemerkt wird: Bereich und Filter – keine Suche, keine Scrollposition. */
export function speichereNav(z: NavZustand): string {
  return JSON.stringify({
    bereich: z.bereich,
    vorrat: { ort: z.vorrat.ort, art: z.vorrat.art },
    essen: z.essen,
    komponenten: z.komponenten,
    einkauf: z.einkauf,
  });
}
