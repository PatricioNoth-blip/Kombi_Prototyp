// Die EINE Stelle, an der Kosten entstehen. Deterministisch, ohne KI.
//
//   Einheitspreis  = gespeicherter Preis / Menge, auf die er sich bezieht
//                    (2,00 € für 4 Portionen → 0,50 € pro Portion; 1,29 € für 500 g → 0,258 ct pro g)
//   Verbrauchswert = verbrauchte Menge × Einheitspreis
//                    (2 Portionen → 1,00 €; 125 g → 32 ct)
//   Gerundet wird erst ganz am Ende auf ganze Cent.
//
// Unbekannter Preis bleibt unbekannt: Er wird nie geschätzt und nie als 0 gezählt, sondern
// als „Preis unbekannt“ ausgewiesen. Die KI liefert keine Preise – Preisangaben in ihren
// Texten werden entfernt (siehe wahrheit.ts).
import type { Kosten, PreisStatus } from './typen.ts';

type Preisangabe = { kosten_cent: number | null; kosten_menge: number };

/** Preis einer Einheit in Cent (ungerundet); null = unbekannt */
export function einheitspreis(p: Preisangabe): number | null {
  if (p.kosten_cent === null || p.kosten_cent === undefined || !Number.isFinite(p.kosten_cent)) return null;
  return p.kosten_cent / Math.max(1, p.kosten_menge || 1);
}

/** Wert einer verbrauchten Menge in Cent (ungerundet); null = unbekannt */
export function verbrauchswert(menge: number, p: Preisangabe): number | null {
  const e = einheitspreis(p);
  return e === null ? null : menge * e;
}

/** Preis einer Portion in Cent (ungerundet); null = unbekannt */
export function portionspreis(p: Preisangabe & { portion_menge: number }): number | null {
  return verbrauchswert(Math.max(1, p.portion_menge || 1), p);
}

/** Auf ganze Cent runden (mit kleiner Toleranz gegen Gleitkomma-Rauschen wie 49,999999). */
export function rundeCent(cent: number): number {
  return Math.round(cent + 1e-9);
}

/** Ein Kostenposten: cent = null heißt Preis unbekannt. */
export type KostenPosten = { name: string; cent: number | null };

function status(bekannt: number, unbekannt: number): PreisStatus {
  if (unbekannt === 0) return 'berechnet';
  return bekannt > 0 ? 'teilweise' : 'unbekannt';
}

/**
 * Summiert die Posten eines Gerichts.
 * posten  – verwendete Zutaten (Grundausstattung gar nicht erst übergeben)
 * einkauf – fehlende Zutaten mit bekanntem oder unbekanntem Preis
 */
export function summiereKosten(posten: KostenPosten[], personen: number, einkauf: KostenPosten[] = []): Kosten {
  const p = Math.max(1, Math.round(personen) || 1);
  const bekannt = posten.filter((x) => x.cent !== null);
  const unbekannt = posten.filter((x) => x.cent === null).map((x) => x.name);
  const summe = bekannt.reduce((s, x) => s + (x.cent as number), 0);
  const st = status(bekannt.length, unbekannt.length);

  const einkaufBekannt = einkauf.filter((x) => x.cent !== null);
  return {
    status: st,
    gesamt_cent: st === 'unbekannt' ? null : rundeCent(summe),
    pro_portion_cent: st === 'unbekannt' ? null : rundeCent(summe / p),
    personen: p,
    unbekannt: [...new Set(unbekannt)],
    einkauf_cent: einkaufBekannt.length ? rundeCent(einkaufBekannt.reduce((s, x) => s + (x.cent as number), 0)) : null,
    einkauf_unbekannt: [...new Set(einkauf.filter((x) => x.cent === null).map((x) => x.name))],
  };
}

export function euroText(cent: number): string {
  return `${(rundeCent(cent) / 100).toFixed(2).replace('.', ',')} €`;
}

/**
 * Anzeige für eine Karte:
 *   berechnet → „ca. 0,62 € / Portion“
 *   teilweise → „ab 0,40 € / Portion“ (Rest unbekannt, siehe Kosten.unbekannt)
 *   unbekannt → „Preis unbekannt“
 */
export function kostenText(k: Kosten): string {
  if (k.status === 'unbekannt' || k.pro_portion_cent === null) return 'Preis unbekannt';
  const betrag = `${euroText(k.pro_portion_cent)} / Portion`;
  return k.status === 'berechnet' ? `ca. ${betrag}` : `ab ${betrag}`;
}
