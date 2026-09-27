// Was nach einer Nutzerentscheidung passieren darf.
// Vorschläge selbst ändern nie etwas. Datenbankänderungen laufen nur über diese Funktionen,
// und die App ruft sie erst nach ausdrücklicher Bestätigung auf.
import type { Aktion, Art, Einheit, Gericht, GerichtZutat } from './typen.ts';
import { mengeText } from './mengen.ts';

export type EntnahmePosten = {
  block_typ_id: number;
  name: string;
  /** Menge in `einheit` (so wird entnommen) */
  menge: number;
  einheit: Einheit;
  art: Art | null;
};

/** Ältere gespeicherte Rezepte kennen nur „bloecke“ (= Portionen/Blöcke). */
function mengeVon(z: GerichtZutat & { bloecke?: number | null }): number | null {
  return z.menge ?? z.bloecke ?? null;
}

/** Was „Heute kochen“ aus dem Bestand austragen würde – nur Bestandszutaten mit Menge. */
export function entnahmePlan(g: Gericht): EntnahmePosten[] {
  return g.zutaten
    .filter((z) => z.quelle === 'bestand' && z.block_typ_id !== null && (mengeVon(z) ?? 0) > 0)
    .map((z) => ({
      block_typ_id: z.block_typ_id as number,
      name: z.name,
      menge: mengeVon(z) as number,
      einheit: z.einheit ?? 'portion',
      art: z.art ?? null,
    }));
}

/** Text für die Bestätigung: „2 Portionen Pizza“ bzw. „250 g Spaghetti“ */
export function postenText(p: Pick<EntnahmePosten, 'menge' | 'einheit' | 'name'>): string {
  return `${mengeText(p.menge, p.einheit)} ${p.name}`;
}

export type EntnahmeStatus =
  | { status: 'ok'; verfuegbar: number }
  | { status: 'zu_wenig'; verfuegbar: number }
  | { status: 'leer'; verfuegbar: 0 }
  | { status: 'unbekannt'; verfuegbar: 0 };

/**
 * Prüft einen Plan gegen den AKTUELLEN Bestand (z. B. bei einem gespeicherten Rezept,
 * das vor Tagen erstellt wurde): Gibt es die Sorte noch, ist genug da, schon verbraucht?
 */
export function pruefeEntnahme(
  posten: EntnahmePosten[],
  bestand: { id: number; anzahl: number }[],
): EntnahmeStatus[] {
  return posten.map((p) => {
    const b = bestand.find((x) => x.id === p.block_typ_id);
    if (!b) return { status: 'unbekannt', verfuegbar: 0 };
    if (b.anzahl <= 0) return { status: 'leer', verfuegbar: 0 };
    if (b.anzahl < p.menge) return { status: 'zu_wenig', verfuegbar: b.anzahl };
    return { status: 'ok', verfuegbar: b.anzahl };
  });
}

/** Schnittstelle zur Datenbank – in der App über Supabase, in Tests als Attrappe. */
export type BuchungsPort = {
  entnehmen(blockTypId: number, anzahl: number): Promise<number[]>;
};

export type KochErgebnis = { bewegungIds: number[]; fehler: { name: string; meldung: string }[] };

/** Trägt die bestätigten Posten aus (über die bestehende Funktion entnehmen(): geöffnet → Ablauf → FIFO). */
export async function kochenBestaetigen(posten: EntnahmePosten[], port: BuchungsPort): Promise<KochErgebnis> {
  const ergebnis: KochErgebnis = { bewegungIds: [], fehler: [] };
  for (const p of posten) {
    if (p.menge <= 0) continue;
    try {
      ergebnis.bewegungIds.push(...(await port.entnehmen(p.block_typ_id, p.menge)));
    } catch (e) {
      ergebnis.fehler.push({ name: p.name, meldung: e instanceof Error ? e.message : String(e) });
    }
  }
  return ergebnis;
}

export type RezeptDatensatz = {
  name: string;
  daten: Gericht;
  gerichtstyp: string;
  portionen: number;
  zutaten: { name: string; menge: number | null; einheit: Einheit | null; art: Art | null; sorte_id: number | null; fehlt: boolean }[];
  schritte: string[];
  bestandsarten: Art[];
  tags: string[];
  kosten_pro_portion_cent: number | null;
  kosten_status: Gericht['kosten']['status'];
  feedback: Aktion[];
};

const RICHTUNG: Record<string, string> = {
  italienisch: 'italienisch', indisch: 'indisch', mexikanisch: 'mexikanisch', asiatisch: 'asiatisch',
  orientalisch: 'orientalisch', deutsch: 'deutsch',
};

/** Datensatz für „Rezept speichern“ (Tabelle rezept) – strukturiert, Kosten von der Software. */
export function rezeptDatensatz(g: Gericht, feedback: Aktion[] = []): RezeptDatensatz {
  const tags: string[] = [];
  if (g.zeit_min <= 15) tags.push('schnell');
  if (g.fehlt.length === 0) tags.push('ohne einkauf');
  if (g.gerichtsart !== 'rezept') tags.push('komplettgericht');
  if (g.rettet?.length) tags.push('rettet lebensmittel');
  const richtung = RICHTUNG[g.eigenschaften.gewuerzrichtung];
  if (richtung) tags.push(richtung);

  const arten = [...new Set(g.zutaten.map((z) => z.art).filter((a): a is Art => !!a && a !== null))];
  return {
    name: g.name,
    daten: g,
    gerichtstyp: g.eigenschaften.gerichtstyp,
    portionen: g.portionen ?? g.kosten.personen,
    zutaten: [
      ...g.zutaten
        .filter((z) => z.quelle !== 'grundausstattung')
        .map((z) => ({ name: z.name, menge: z.menge, einheit: z.menge === null ? null : z.einheit, art: z.art, sorte_id: z.block_typ_id, fehlt: false })),
      ...g.fehlt.map((f) => ({ name: f.name, menge: f.menge, einheit: f.einheit, art: null, sorte_id: null, fehlt: true })),
    ],
    schritte: g.schritte.slice(0, 20),
    bestandsarten: arten,
    tags,
    kosten_pro_portion_cent: g.kosten.pro_portion_cent,
    kosten_status: g.kosten.status,
    feedback: [...new Set(feedback)].slice(0, 10),
  };
}
