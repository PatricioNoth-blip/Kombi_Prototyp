// Was nach einer Nutzerentscheidung passieren darf.
// Vorschläge selbst ändern nie etwas. Datenbankänderungen laufen nur über diese Funktionen,
// und die App ruft sie erst nach ausdrücklicher Bestätigung auf.
import type { Gericht } from './typen.ts';

export type EntnahmePosten = { block_typ_id: number; name: string; anzahl: number };

/** Was „Heute kochen“ aus dem Bestand austragen würde – nur Bestandszutaten mit Blöcken. */
export function entnahmePlan(g: Gericht): EntnahmePosten[] {
  return g.zutaten
    .filter((z) => z.quelle === 'bestand' && z.block_typ_id !== null && (z.bloecke ?? 0) > 0)
    .map((z) => ({ block_typ_id: z.block_typ_id as number, name: z.name, anzahl: z.bloecke as number }));
}

/** Schnittstelle zur Datenbank – in der App über Supabase, in Tests als Attrappe. */
export type BuchungsPort = {
  entnehmen(blockTypId: number, anzahl: number): Promise<number[]>;
};

export type KochErgebnis = { bewegungIds: number[]; fehler: { name: string; meldung: string }[] };

/** Trägt die bestätigten Posten aus (über die bestehende FIFO-Funktion entnehmen()). */
export async function kochenBestaetigen(posten: EntnahmePosten[], port: BuchungsPort): Promise<KochErgebnis> {
  const ergebnis: KochErgebnis = { bewegungIds: [], fehler: [] };
  for (const p of posten) {
    if (p.anzahl <= 0) continue;
    try {
      ergebnis.bewegungIds.push(...(await port.entnehmen(p.block_typ_id, p.anzahl)));
    } catch (e) {
      ergebnis.fehler.push({ name: p.name, meldung: e instanceof Error ? e.message : String(e) });
    }
  }
  return ergebnis;
}

/** Datensatz für „Rezept speichern“ (Tabelle rezept). */
export function rezeptDatensatz(g: Gericht): { name: string; daten: Gericht } {
  return { name: g.name, daten: g };
}
