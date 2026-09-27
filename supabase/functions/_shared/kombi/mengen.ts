// Mengen und Einheiten: Portionen ↔ Bestandseinheit, verständliche Texte.
// Der Bestand zählt immer ganze Zahlen der Einheit (4 Portionen, 6 Stück, 500 g, 750 ml).
import type { Einheit } from './typen.ts';

/**
 * Portionen → Menge in der Bestandseinheit.
 * Portion/Stück: auf ganze Einheiten aufrunden (ein halber Block lässt sich nicht buchen).
 * Gramm/ml: auf ganze Gramm/ml runden.
 */
export function mengeAusPortionen(portionen: number, einheit: Einheit, portionMenge: number): number {
  const roh = portionen * Math.max(1, portionMenge);
  if (einheit === 'g' || einheit === 'ml') return Math.max(1, Math.round(roh));
  return Math.max(1, Math.ceil(roh - 1e-9));
}

/** Menge in der Bestandseinheit → Portionen (auf zwei Nachkommastellen). */
export function portionenAusMenge(menge: number, portionMenge: number): number {
  return Math.round((menge / Math.max(1, portionMenge)) * 100) / 100;
}

const zahl = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

/** 1 Portion, 3 Portionen, 2 Stück, 250 g, 1,5 kg, 750 ml, 1 l */
export function mengeText(menge: number, einheit: Einheit): string {
  switch (einheit) {
    case 'g':
      return menge >= 1000 && menge % 100 === 0 ? `${zahl(menge / 1000)} kg` : `${menge} g`;
    case 'ml':
      return menge >= 1000 && menge % 100 === 0 ? `${zahl(menge / 1000)} l` : `${menge} ml`;
    case 'stueck':
      return `${menge} Stück`;
    default:
      return menge === 1 ? '1 Portion' : `${zahl(menge)} Portionen`;
  }
}

export function portionenText(portionen: number): string {
  return portionen === 1 ? '1 Portion' : `${zahl(portionen)} Portionen`;
}

/** Worauf sich ein gespeicherter Preis bezieht: „pro Portion“, „für 4 Portionen“, „für 500 g“ */
export function bezugText(kostenMenge: number, einheit: Einheit): string {
  if (kostenMenge === 1) {
    return { portion: 'pro Portion', stueck: 'pro Stück', g: 'pro g', ml: 'pro ml' }[einheit];
  }
  return `für ${mengeText(kostenMenge, einheit)}`;
}
