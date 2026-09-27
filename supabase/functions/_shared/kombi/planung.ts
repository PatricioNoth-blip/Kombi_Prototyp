// Planung: Was braucht ein geplantes Gericht bzw. eine vorgemerkte Komponente, und was bleibt
// danach für weitere Vorschläge übrig? Geplantes verändert den Bestand NICHT – es reserviert nur.
import type { Einheit, Gericht, KomponentenVorschlag, Snapshot } from './typen.ts';
import { type Bedarf, type PlanBedarf, verteile, type VorratSorte } from './einkaufsliste.ts';

/** Bedarf eines Gerichts: Vorrat mit Mengen + Fehlendes (Kühlschrank-Reste und Grundausstattung nicht). */
export function bedarfAusGericht(g: Gericht): Bedarf[] {
  const ausVorrat: Bedarf[] = g.zutaten
    .filter((z) => z.quelle === 'bestand' && z.menge !== null)
    .map((z) => ({ name: z.name, block_typ_id: z.block_typ_id, menge: z.menge, einheit: z.einheit }));
  const fehlt: Bedarf[] = g.fehlt
    // „zu wenig“ ist schon in der Vorrats-Menge enthalten (die Verteilung erkennt den Rest selbst)
    .filter((f) => f.grund === 'nicht_im_bestand')
    .map((f) => ({ name: f.name, block_typ_id: null, menge: f.menge, einheit: f.einheit }));
  const zuWenig = g.fehlt.filter((f) => f.grund === 'zu_wenig');
  // Bei „zu wenig“ wurde die Vorrats-Menge gekappt – der volle Bedarf ist Vorrat + Rest.
  for (const f of zuWenig) {
    const z = ausVorrat.find((b) => b.name === f.name);
    if (z && z.menge !== null && f.menge !== null) z.menge += f.menge;
  }
  return [...ausVorrat, ...fehlt];
}

/** Bedarf einer vorgemerkten Komponente: alle Zutaten außer Grundausstattung und Kühlschrank-Resten. */
export function bedarfAusKomponente(k: KomponentenVorschlag): Bedarf[] {
  const bedarf: Bedarf[] = [];
  for (const z of k.zutaten) {
    if (z.quelle === 'grundausstattung' || z.quelle === 'kuehlschrank') continue;
    const schon = bedarf.find((b) => b.name === z.name && b.einheit === z.einheit);
    if (schon && schon.menge !== null && z.menge !== null) {
      schon.menge += z.menge;
      continue;
    }
    bedarf.push({ name: z.name, block_typ_id: z.block_typ_id, menge: z.menge, einheit: z.einheit });
  }
  return bedarf;
}

/** Snapshot ohne reservierte Mengen – Grundlage für Vorschläge, die Geplantes nicht verplanen. */
export function restSnapshot(snapshot: Snapshot, reserviert: Map<number, number>): Snapshot {
  const zutaten = snapshot.zutaten
    .map((z) => {
      if (z.quelle !== 'bestand' || z.block_typ_id === null || z.anzahl === null) return z;
      const weg = reserviert.get(z.block_typ_id) ?? 0;
      return weg > 0 ? { ...z, anzahl: z.anzahl - weg } : z;
    })
    .filter((z) => z.anzahl === null || z.anzahl > 0);
  return { ...snapshot, zutaten };
}

/** Reservierung eines (noch nicht gespeicherten) Gerichts – für die Auswahl mehrerer Mahlzeiten. */
export function reservierungVon(g: Gericht): Map<number, number> {
  const m = new Map<number, number>();
  for (const z of g.zutaten) {
    if (z.quelle === 'bestand' && z.block_typ_id !== null && z.menge !== null) {
      m.set(z.block_typ_id, (m.get(z.block_typ_id) ?? 0) + z.menge);
    }
  }
  return m;
}

// ───────── Auftauen ─────────

export type AuftauEintrag = {
  id: number;
  block_typ_id: number;
  menge: number;
  auftauen_am: string;
  plan_id: string | null;
  status: 'geplant' | 'aufgetaut' | 'verbraucht' | 'abgebrochen';
};

export type AuftauVorschlag = {
  plan_id: string;
  titel: string;
  datum: string;
  block_typ_id: number;
  name: string;
  menge: number;
  einheit: Einheit;
  auftauen_am: string;
};

const tagDavor = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Welche Gefrierfach-Portionen sollten für geplante Mahlzeiten heute herausgenommen werden?
 * Regel: einen Tag vorher auftauen. Nur Pläne mit Datum heute oder morgen, nur Reserviertes aus dem
 * Gefrierfach, nur wenn dafür noch keine Auftau-Vormerkung existiert. Vorschläge ändern nichts.
 */
export function auftauVorschlaege(
  plaene: PlanBedarf[],
  sorten: VorratSorte[],
  auftauen: AuftauEintrag[],
  heute: string,
): AuftauVorschlag[] {
  const morgen = (() => {
    const d = new Date(`${heute}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const v = verteile(plaene, sorten);
  const vorschlaege: AuftauVorschlag[] = [];
  for (const p of plaene) {
    if (!p.datum || p.datum < heute || p.datum > morgen) continue;
    for (const s of v.pro_plan.get(p.id) ?? []) {
      const sorte = sorten.find((x) => x.id === s.block_typ_id);
      if (!sorte || sorte.lagerort !== 'gefrierfach' || s.reserviert <= 0) continue;
      const schon = auftauen.some((a) => a.plan_id === p.id && a.block_typ_id === sorte.id && (a.status === 'geplant' || a.status === 'aufgetaut'));
      if (schon) continue;
      vorschlaege.push({
        plan_id: p.id, titel: p.titel, datum: p.datum, block_typ_id: sorte.id, name: sorte.name,
        menge: s.reserviert, einheit: sorte.einheit, auftauen_am: tagDavor(p.datum) < heute ? heute : tagDavor(p.datum),
      });
    }
  }
  return vorschlaege;
}

/** Was heute aus dem Gefrierfach genommen werden sollte (vorgemerkt und fällig). */
export function heuteAuftauen(auftauen: AuftauEintrag[], heute: string): AuftauEintrag[] {
  return auftauen.filter((a) => a.status === 'geplant' && a.auftauen_am <= heute);
}
