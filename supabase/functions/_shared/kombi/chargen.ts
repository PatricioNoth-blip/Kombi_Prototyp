// Chargen mit Kosten – dieselbe Reihenfolge und dieselbe Kostenrechnung wie in der Datenbank.
//
//   Entnahme-Reihenfolge (entnehmen()): geöffnet → frühester Ablauf (MHD, sonst Datum + Haltbarkeit)
//                                        → älteste → zuerst angelegte. Ohne MHD/geöffnet: reines FIFO.
//   Wert einer Entnahme (bewegung_kosten): Menge × kosten_cent / kosten_menge der jeweiligen Charge.
//
// Hier wird nur VORAUSGERECHNET (Vorschau „kostet voraussichtlich …“). Gebucht und endgültig
// berechnet wird ausschließlich in der Datenbank – aus den tatsächlich entnommenen Chargen.
import type { Lagerort, PreisStatus } from './typen.ts';

export type ChargeInfo = {
  id: number;
  block_typ_id: number;
  menge_aktuell: number;
  eingefroren_am: string;
  ablauf_am: string | null;
  geoeffnet_am: string | null;
  /** Wert von kosten_menge Einheiten; null = unbekannt */
  kosten_cent: number | null;
  kosten_menge: number | null;
  kosten_status: PreisStatus;
  kosten_quelle: 'sortenpreis' | 'bon' | 'produktion' | null;
  quelle: 'bon' | 'e_bon' | 'produktion' | null;
  /** null = Lagerort der Sorte */
  lagerort: Lagerort | null;
};

function plusTage(iso: string, tage: number): string {
  const [j, m, t] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t + tage)).toISOString().slice(0, 10);
}

/** Chargen in der Reihenfolge, in der entnehmen() sie leert. */
export function entnahmeReihenfolge<T extends Pick<ChargeInfo, 'id' | 'eingefroren_am' | 'ablauf_am' | 'geoeffnet_am'>>(
  chargen: T[],
  haltbarTage: number,
): T[] {
  const ablauf = (c: T) => c.ablauf_am ?? plusTage(c.eingefroren_am, haltbarTage);
  return [...chargen].sort(
    (a, b) =>
      Number(!a.geoeffnet_am) - Number(!b.geoeffnet_am) ||
      ablauf(a).localeCompare(ablauf(b)) ||
      a.eingefroren_am.localeCompare(b.eingefroren_am) ||
      a.id - b.id,
  );
}

/** Preis einer Einheit dieser Charge (ungerundet); null = unbekannt */
export function einheitspreisCharge(c: Pick<ChargeInfo, 'kosten_cent' | 'kosten_menge'>): number | null {
  if (c.kosten_cent === null || c.kosten_menge === null || c.kosten_menge <= 0) return null;
  return Number(c.kosten_cent) / c.kosten_menge;
}

export type EntnahmeTeil = { charge_id: number; menge: number; wert_cent: number | null; kosten_status: PreisStatus };

/** Welche Chargen würden bei einer Entnahme geleert – und was ist das wert? */
export function simuliereEntnahme(
  chargen: ChargeInfo[],
  haltbarTage: number,
  menge: number,
): { teile: EntnahmeTeil[]; fehlt: number } {
  let rest = Math.max(0, menge);
  const teile: EntnahmeTeil[] = [];
  for (const c of entnahmeReihenfolge(chargen.filter((x) => x.menge_aktuell > 0), haltbarTage)) {
    if (rest <= 0) break;
    const nimm = Math.min(rest, c.menge_aktuell);
    const preis = einheitspreisCharge(c);
    teile.push({ charge_id: c.id, menge: nimm, wert_cent: preis === null ? null : nimm * preis, kosten_status: c.kosten_status });
    rest -= nimm;
  }
  return { teile, fehlt: rest };
}

/**
 * Kostenstatus einer Summe von Teilen – wie produzieren() in der Datenbank:
 *   berechnet: alle Teile bekannt und vollständig · teilweise: mindestens einer bekannt · unbekannt: keiner
 */
export function kostenAusTeilen(teile: Pick<EntnahmeTeil, 'wert_cent' | 'kosten_status'>[]): { cent: number | null; status: PreisStatus } {
  const bekannt = teile.filter((t) => t.wert_cent !== null);
  if (teile.length === 0 || bekannt.length === 0) return { cent: null, status: 'unbekannt' };
  const cent = bekannt.reduce((s, t) => s + (t.wert_cent as number), 0);
  const vollstaendig = bekannt.length === teile.length && teile.every((t) => t.kosten_status === 'berechnet');
  return { cent, status: vollstaendig ? 'berechnet' : 'teilweise' };
}

/** Wert des aktuellen Bestands einer Sorte aus ihren Chargen. */
export function bestandsWert(chargen: ChargeInfo[]): { cent: number | null; status: PreisStatus } {
  return kostenAusTeilen(
    chargen
      .filter((c) => c.menge_aktuell > 0)
      .map((c) => {
        const p = einheitspreisCharge(c);
        return { wert_cent: p === null ? null : p * c.menge_aktuell, kosten_status: c.kosten_status };
      }),
  );
}
