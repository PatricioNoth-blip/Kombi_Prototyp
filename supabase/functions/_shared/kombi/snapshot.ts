// Baut den kontrollierten Daten-Snapshot, den die KI zu sehen bekommt.
// Nur was hier steht, gilt als vorhanden. Unbekanntes bleibt null – es wird nichts ergänzt.
import type {
  Art, Einheit, Farbe, Gerichtstyp, Gewuerzrichtung, Herkunft, Lagerort, PreisInfo, Snapshot, SnapshotZutat,
} from './typen.ts';
import { ARTEN, EINHEITEN, GERICHTSTYPEN, GEWUERZRICHTUNGEN } from './typen.ts';
import { bezugText } from './mengen.ts';
import { normalisiere } from './text.ts';

/**
 * Eine Zeile der View `bestand` (wie sie die App aus Supabase lädt).
 * Die Felder ab `art` gibt es erst mit der Migration „baukasten“ – ohne sie gelten Standardwerte.
 */
export type BestandZeile = {
  id: number;
  name: string;
  farbe: Farbe;
  anzahl: number;
  bald_ablaufen: boolean;
  groesse_g: number;
  kosten_cent: number | null;
  lagerort?: Lagerort | null;
  art?: Art | null;
  herkunft?: Herkunft | null;
  einheit?: Einheit | null;
  portion_menge?: number | null;
  kosten_menge?: number | null;
  zusammensetzung?: string[] | null;
  notiz?: string | null;
  naechster_ablauf?: string | null;
  /** Menge in geöffneten Chargen */
  geoeffnet?: number | null;
  /** Menge mit überschrittenem Ablaufdatum */
  abgelaufen?: number | null;
  // ab Migration „planung_einkauf“:
  gerichtstypen?: string[] | null;
  richtung?: string | null;
  /** aufgetaute Menge (Auftau-Status) */
  aufgetaut?: number | null;
};

/** Nur bekannte Gerichtstypen; leer = nicht hinterlegt (null). */
export function saubereGerichtstypen(liste: unknown): Gerichtstyp[] | null {
  if (!Array.isArray(liste)) return null;
  const typen = [...new Set(liste.filter((x): x is Gerichtstyp => GERICHTSTYPEN.includes(x as Gerichtstyp)))];
  return typen.length ? typen : null;
}

export function saubereRichtung(wert: unknown): Gewuerzrichtung | null {
  return GEWUERZRICHTUNGEN.find((r) => r === wert) ?? null;
}

/** Gilt immer als vorhanden und wird in der App sichtbar angezeigt. */
export const GRUNDAUSSTATTUNG = ['Wasser', 'Salz', 'Pfeffer', 'Öl'] as const;

const MAX_KUEHLSCHRANK = 20;

/** Einordnung wie in der Migration, falls die Datenbank noch keine Art kennt. */
export function artAusAltdaten(z: Pick<BestandZeile, 'farbe' | 'lagerort' | 'name'>): Art {
  if (z.farbe === 'blau') return 'komplettgericht';
  if (z.lagerort === 'vorrat' || z.lagerort === 'kuehlschrank') return 'zutat';
  if (/^tk[- ]/i.test(z.name)) return 'zutat';
  return 'komponente';
}

/** Tage von `von` bis `bis` (beide YYYY-MM-DD); null bei ungültigem Datum. */
export function tageZwischen(von: string, bis: string): number | null {
  const a = Date.parse(`${von.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${bis.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** Bekannte Bestandteile säubern; leere Liste = unbekannt (null). */
export function saubereZusammensetzung(liste: unknown): string[] | null {
  if (!Array.isArray(liste)) return null;
  const teile = liste
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 30);
  return teile.length ? teile : null;
}

/**
 * Zerlegt die freie Kühlschrank-Eingabe in einzelne Einträge.
 * „Ich habe noch eine halbe Paprika, etwas Frischkäse und Mais.“
 *   → ['eine halbe Paprika', 'etwas Frischkäse', 'Mais']
 */
export function kuehlschrankEintraege(text: string): string[] {
  const teile = text
    .replace(/^\s*(ich\s+)?(hab|habe|haben)\s+(noch\s+)?/i, '')
    .split(/[,;\n]+|\s+und\s+|\s+sowie\s+|\s+plus\s+/i)
    .map((t) => t.replace(/^\s*(noch\s+)/i, '').replace(/[.!?]+\s*$/, '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 1)
    .map((t) => (t.length > 60 ? t.slice(0, 60) : t));
  const gesehen = new Set<string>();
  return teile
    .filter((t) => {
      const n = normalisiere(t);
      if (gesehen.has(n)) return false;
      gesehen.add(n);
      return true;
    })
    .slice(0, MAX_KUEHLSCHRANK);
}

function einheitVon(z: BestandZeile): Einheit {
  return EINHEITEN.find((e) => e === z.einheit) ?? 'portion';
}

export function baueSnapshot(bestand: BestandZeile[], kuehlschrankText: string, datum: string): Snapshot {
  const zutaten: SnapshotZutat[] = [];
  const abgelaufen: Snapshot['abgelaufen'] = [];

  for (const z of bestand) {
    const einheit = einheitVon(z);
    const weg = Math.max(0, z.abgelaufen ?? 0);
    if (weg > 0 && z.anzahl > 0) abgelaufen.push({ name: z.name, menge: Math.min(weg, z.anzahl), einheit });
    // Abgelaufenes wird nicht eingeplant.
    const verwendbar = z.anzahl - weg;
    if (verwendbar <= 0) continue;

    const portionMenge = einheit === 'portion' ? 1 : Math.max(1, Math.round(z.portion_menge ?? 1));
    const lagerort = z.lagerort ?? 'gefrierfach';
    const geoeffnet = (z.geoeffnet ?? 0) > 0;
    const verderblich = geoeffnet || lagerort === 'kuehlschrank' || einheit === 'g' || einheit === 'ml';
    zutaten.push({
      id: `b${z.id}`,
      quelle: 'bestand',
      name: z.name,
      farbe: z.farbe,
      lagerort,
      art: ARTEN.find((a) => a === z.art) ?? artAusAltdaten(z),
      herkunft: z.herkunft === 'selbstgemacht' || z.herkunft === 'gekauft' ? z.herkunft : null,
      einheit,
      anzahl: verwendbar,
      portion_menge: portionMenge,
      groesse_g: z.groesse_g,
      kosten_cent: z.kosten_cent ?? null,
      kosten_menge: Math.max(1, Math.round(z.kosten_menge ?? 1)),
      zusammensetzung: saubereZusammensetzung(z.zusammensetzung),
      notiz: z.notiz ? z.notiz.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null,
      bald_verbrauchen: z.bald_ablaufen,
      geoeffnet,
      rest: verderblich && verwendbar < 2 * portionMenge,
      tage_bis_ablauf: z.naechster_ablauf ? tageZwischen(datum, z.naechster_ablauf) : null,
      aufgetaut: (z.aufgetaut ?? 0) > 0,
      gerichtstypen: saubereGerichtstypen(z.gerichtstypen),
      richtung: saubereRichtung(z.richtung),
      block_typ_id: z.id,
    });
  }

  kuehlschrankEintraege(kuehlschrankText).forEach((name, i) => {
    zutaten.push({
      id: `k${i + 1}`,
      quelle: 'kuehlschrank',
      name,
      farbe: null,
      lagerort: 'kuehlschrank',
      art: null,
      herkunft: null,
      einheit: 'portion',
      anzahl: null,
      portion_menge: 1,
      groesse_g: null,
      kosten_cent: null,
      kosten_menge: 1,
      zusammensetzung: null,
      notiz: null,
      // Spontan genannte Reste sind meist angebrochen – bevorzugt verbrauchen.
      bald_verbrauchen: true,
      geoeffnet: false,
      rest: true,
      tage_bis_ablauf: null,
      aufgetaut: false,
      gerichtstypen: null,
      richtung: null,
      block_typ_id: null,
    });
  });

  for (const name of GRUNDAUSSTATTUNG) {
    zutaten.push({
      id: `g-${normalisiere(name)}`,
      quelle: 'grundausstattung',
      name,
      farbe: null,
      lagerort: null,
      art: 'zutat',
      herkunft: null,
      einheit: 'portion',
      anzahl: null,
      portion_menge: 1,
      groesse_g: null,
      kosten_cent: null,
      kosten_menge: 1,
      zusammensetzung: null,
      notiz: null,
      bald_verbrauchen: false,
      geoeffnet: false,
      rest: false,
      tage_bis_ablauf: null,
      aufgetaut: false,
      gerichtstypen: null,
      richtung: null,
      block_typ_id: null,
    });
  }

  const preise: PreisInfo[] = bestand
    .filter((z) => z.kosten_cent !== null && z.kosten_cent !== undefined)
    .map((z) => {
      const einheit = einheitVon(z);
      return {
        name: z.name,
        kosten_cent: z.kosten_cent as number,
        kosten_menge: Math.max(1, Math.round(z.kosten_menge ?? 1)),
        einheit,
        portion_menge: einheit === 'portion' ? 1 : Math.max(1, Math.round(z.portion_menge ?? 1)),
      };
    });

  return { datum, zutaten, preise, abgelaufen };
}

/** Bekannter Preis nach Namen (auch von gerade leeren Sorten) – sonst null. */
export function bekannterPreisInfo(snapshot: Snapshot, name: string): PreisInfo | null {
  const n = normalisiere(name);
  if (!n) return null;
  return (
    snapshot.preise.find((p) => normalisiere(p.name) === n) ??
    snapshot.preise.find((p) => {
      const pn = normalisiere(p.name);
      return pn.length >= 4 && (n.includes(pn) || pn.includes(n));
    }) ??
    null
  );
}

/** Bekannter Preis (für die gespeicherte Bezugsmenge) nach Namen – sonst null. */
export function bekannterPreis(snapshot: Snapshot, name: string): number | null {
  return bekannterPreisInfo(snapshot, name)?.kosten_cent ?? null;
}

/** „für 500 g“ usw. zum bekannten Preis – sonst null. */
export function bekannterPreisBezug(snapshot: Snapshot, name: string): string | null {
  const p = bekannterPreisInfo(snapshot, name);
  return p ? bezugText(p.kosten_menge, p.einheit) : null;
}

/** Grobe Prüfung: Lässt sich aus dem Vorhandenen überhaupt eine Mahlzeit bauen? */
export function kannMahlzeit(snapshot: Snapshot): boolean {
  const bestand = snapshot.zutaten.filter((z) => z.quelle === 'bestand');
  const da = (farbe: Farbe) => bestand.some((z) => z.farbe === farbe && z.art !== 'komplettgericht');
  const kuehlschrank = snapshot.zutaten.some((z) => z.quelle === 'kuehlschrank');
  if (bestand.some((z) => z.art === 'komplettgericht')) return true; // Komplettgericht geht immer
  const belag = da('braun') || da('rot') || da('gruen') || kuehlschrank;
  if (da('gelb') && belag) return true;
  if (da('braun') && da('rot')) return true; // z. B. Chili oder Eintopf ohne Beilage
  return false;
}
