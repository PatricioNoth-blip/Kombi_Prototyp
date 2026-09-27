// Batch-Cooking: Lohnt es sich, eine Komponente beim nächsten Mal in größerer Menge vorzubereiten?
// Nur auf Grundlage echter Buchungen (View `nutzung`, ohne rückgängig gemachte Buchungen).
// Zu wenig Daten → keine Empfehlung. Nichts wird geschätzt.
import type { Art, Einheit, Herkunft } from './typen.ts';
import { mengeText } from './mengen.ts';

export type NutzungZeile = {
  block_typ_id: number;
  verbrauch_28: number;
  verbrauchstage_28: number;
  herstellungen_56: number;
  mittlere_menge: number;
  letzte_herstellung: string | null;
};

export type BatchSorte = {
  id: number;
  name: string;
  art: Art;
  herkunft: Herkunft | null;
  einheit: Einheit;
  haltbar_tage: number;
  lagerort: string;
};

export type BatchEmpfehlung = {
  block_typ_id: number;
  name: string;
  bisher: number;
  neu: number;
  einheit: Einheit;
  gruende: string[];
};

/** Mindestens so viel echte Nutzung, bevor etwas empfohlen wird. */
export const MIN_HERSTELLUNGEN = 2;
export const MIN_VERBRAUCH = 4;

export function batchEmpfehlungen(sorten: BatchSorte[], nutzung: NutzungZeile[]): BatchEmpfehlung[] {
  const ergebnis: BatchEmpfehlung[] = [];
  for (const s of sorten) {
    if (s.art === 'zutat' || s.herkunft === 'gekauft') continue; // nur Selbstgemachtes
    const n = nutzung.find((x) => x.block_typ_id === s.id);
    if (!n || n.herstellungen_56 < MIN_HERSTELLUNGEN || n.verbrauch_28 < MIN_VERBRAUCH || n.mittlere_menge <= 0) continue;

    const proWoche = n.verbrauch_28 / 4;
    // Reicht eine Charge schon ~2 Wochen, ist alles gut.
    if (n.mittlere_menge >= 2 * proWoche) continue;
    let ziel = Math.ceil(2 * proWoche);
    // Nicht mehr, als innerhalb der Haltbarkeit verbraucht wird – und höchstens das Dreifache.
    ziel = Math.min(ziel, Math.floor((proWoche * s.haltbar_tage) / 7), n.mittlere_menge * 3);
    if (ziel < n.mittlere_menge + 1) continue;

    const m = (x: number) => mengeText(x, s.einheit);
    ergebnis.push({
      block_typ_id: s.id,
      name: s.name,
      bisher: n.mittlere_menge,
      neu: ziel,
      einheit: s.einheit,
      gruende: [
        `In den letzten 8 Wochen ${n.herstellungen_56}× hergestellt, im Schnitt ${m(n.mittlere_menge)}.`,
        `In 4 Wochen ${m(n.verbrauch_28)} verbraucht (≈ ${m(Math.round(proWoche * 10) / 10)} pro Woche).`,
        `${m(ziel)} reichen etwa 2 Wochen – innerhalb der Haltbarkeit von ${s.haltbar_tage} Tagen.`,
        s.lagerort === 'gefrierfach' ? 'Platz im Gefrierfach bitte selbst prüfen – den kennt Kombi nicht.' : 'Lagerplatz bitte selbst prüfen.',
      ],
    });
  }
  return ergebnis.sort((a, b) => b.neu - b.bisher - (a.neu - a.bisher));
}

/** Häufig verwendete Komponenten (für Hinweise wie „Tomaten-Basis wurde oft verwendet“). */
export function oftVerwendet(sorten: BatchSorte[], nutzung: NutzungZeile[], max = 3): { name: string; verbrauch_28: number; einheit: Einheit }[] {
  return sorten
    .filter((s) => s.art === 'komponente')
    .map((s) => ({ s, n: nutzung.find((x) => x.block_typ_id === s.id) }))
    .filter((x) => x.n && x.n.verbrauch_28 >= MIN_VERBRAUCH && x.n.verbrauchstage_28 >= 2)
    .sort((a, b) => b.n!.verbrauch_28 - a.n!.verbrauch_28)
    .slice(0, max)
    .map((x) => ({ name: x.s.name, verbrauch_28: x.n!.verbrauch_28, einheit: x.s.einheit }));
}
