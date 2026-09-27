// Testdaten: die 17 Seed-Sorten (Stand Kochtag) plus Hilfen für Anfragen.
import type { BestandZeile } from '../../supabase/functions/_shared/kombi/snapshot.ts';
import { baueSnapshot } from '../../supabase/functions/_shared/kombi/snapshot.ts';
import type {
  Eigenschaften, FeedbackEintrag, GerichtKurz, KiAnbieter, KiAnfrage, KiAuftrag, Optionen, RohAntwort, Snapshot,
} from '../../supabase/functions/_shared/kombi/typen.ts';

const zeile = (id: number, name: string, farbe: BestandZeile['farbe'], groesse_g: number, kosten_cent: number, anzahl: number, extra: Partial<BestandZeile> = {}): BestandZeile =>
  ({ id, name, farbe, groesse_g, kosten_cent, anzahl, bald_ablaufen: false, lagerort: 'gefrierfach', ...extra });

export const SEED: BestandZeile[] = [
  zeile(1, 'Tomatensoße', 'rot', 100, 17, 6),
  zeile(2, 'Curry-Basis Kokos', 'rot', 100, 33, 6),
  zeile(3, 'Linsen gekocht', 'braun', 100, 8, 6),
  zeile(4, 'Kichererbsen', 'braun', 100, 8, 6),
  zeile(5, 'Bohnen-Patty', 'braun', 80, 30, 4),
  zeile(6, 'TK-Gemüsemix', 'gruen', 100, 20, 10),
  zeile(7, 'TK-Spinat', 'gruen', 100, 22, 4),
  zeile(8, 'Brötchen', 'gelb', 80, 10, 12),
  zeile(9, 'Wrap', 'gelb', 60, 6, 4),
  zeile(10, 'Booster Italien', 'weiss', 30, 20, 6),
  zeile(11, 'Booster Indien', 'weiss', 30, 25, 6),
  zeile(12, 'Booster Mexiko', 'weiss', 30, 23, 6),
  zeile(13, 'Pizza', 'blau', 400, 150, 4),
  zeile(14, 'Linsensuppe', 'blau', 250, 50, 8),
  zeile(15, 'Lasagne-Portion', 'blau', 350, 85, 6),
  zeile(16, 'Burrito', 'blau', 250, 80, 8),
  zeile(17, 'Chili-Reis-Box', 'blau', 400, 100, 4),
];

export const OPTIONEN: Optionen = { personen: 2, max_minuten: 15, guenstig: true };

export function snapshot(bestand: BestandZeile[] = SEED, kuehlschrank = ''): Snapshot {
  return baueSnapshot(bestand, kuehlschrank, '2026-09-28');
}

export function anfrage(teil: Partial<KiAnfrage> = {}): KiAnfrage {
  return {
    snapshot: snapshot(),
    optionen: OPTIONEN,
    gesehen: [],
    feedback: [],
    modus: { art: 'normal' },
    anzahl: 3,
    ...teil,
  };
}

/** Fortlaufende, vorhersagbare IDs statt zufälliger UUIDs. */
export function ids(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

// ───────── Attrappen ─────────

/** KI-Attrappe: liefert feste Antworten und merkt sich, was sie bekommen hat. */
export function festerAnbieter(antwort: RohAntwort | ((a: KiAuftrag) => RohAntwort)): KiAnbieter & { auftraege: KiAuftrag[] } {
  const auftraege: KiAuftrag[] = [];
  return {
    name: 'test',
    auftraege,
    async vorschlagen(a: KiAuftrag) {
      auftraege.push(a);
      return typeof antwort === 'function' ? antwort(a) : antwort;
    },
  };
}

export function eigenschaften(teil: Partial<Eigenschaften> = {}): Eigenschaften {
  return {
    gerichtstyp: 'pfanne', hauptzutat: 'linsen', geschmack: 'herzhaft', schaerfe: 0, konsistenz: 'stueckig',
    sattmacher: 'reis', gewuerzrichtung: 'neutral', zubereitung: 'pfanne', ...teil,
  };
}

export function kurzGericht(name: string, teil: Partial<Eigenschaften> = {}, zutaten: string[] = []): GerichtKurz {
  return { name, eigenschaften: eigenschaften(teil), zutaten };
}

export function fb(aktion: FeedbackEintrag['aktion'], name: string, teil: Partial<Eigenschaften> = {}): FeedbackEintrag {
  return { ...kurzGericht(name, teil), aktion, vorschlag_id: `v-${name}` };
}

/** Friert ein Objekt rekursiv ein – jede Änderung würfe dann einen Fehler. */
export function tiefGefroren<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) tiefGefroren(v);
    Object.freeze(o);
  }
  return o;
}
