// Notfall-Einkauf: nicht „kauf Tomaten“, sondern die EINE günstige Zutat,
// die möglichst viele weitere Kombi-Gerichte möglich macht.
import type { Einkaufsvorschlag, Farbe, RohEinkauf, Snapshot } from './typen.ts';
import { bekannterPreis } from './snapshot.ts';
import { kuerze, normalisiere } from './text.ts';

type MultiUse = { name: string; schluessel: string; rolle: Farbe; passt_zu: string[] };

/** Vielseitige Grundzutaten. Welche davon vorgeschlagen wird, hängt vom Bestand ab. */
export const MULTI_USE: MultiUse[] = [
  { name: 'Gehackte Tomaten (Dose)', schluessel: 'tomate', rolle: 'rot', passt_zu: ['Linsen-Ragù', 'Chili', 'Tomaten-Curry', 'Tomatensuppe', 'Bohnen-Wrap', 'Schnelle Pizza', 'Tomaten-Kartoffelpfanne', 'Shakshuka'] },
  { name: 'Tomatenmark', schluessel: 'tomatenmark', rolle: 'rot', passt_zu: ['Tomatensoße', 'Chili', 'Curry', 'Linsen-Ragù', 'Pizza-Toast'] },
  { name: 'Reis', schluessel: 'reis', rolle: 'gelb', passt_zu: ['Reispfanne', 'Curry mit Reis', 'Chili mit Reis', 'Burrito-Bowl', 'Gemüsereis', 'Gefüllte Wraps', 'Reissuppe'] },
  { name: 'Pasta', schluessel: 'pasta', rolle: 'gelb', passt_zu: ['Tomatenpasta', 'Linsen-Bolognese', 'Curry-Pasta', 'Nudelpfanne', 'Pasta-Auflauf', 'Nudelsalat', 'Minestrone'] },
  { name: 'Kartoffeln', schluessel: 'kartoffel', rolle: 'gelb', passt_zu: ['Bratkartoffeln', 'Kartoffel-Curry', 'Kartoffelsuppe', 'Ofenkartoffeln', 'Kartoffel-Wrap', 'Kartoffelpfanne'] },
  { name: 'Wraps', schluessel: 'wrap', rolle: 'gelb', passt_zu: ['Bohnen-Wrap', 'Curry-Wrap', 'Wrap-Pizza', 'Quesadilla', 'Linsen-Wrap'] },
  { name: 'Rote Linsen', schluessel: 'linsen', rolle: 'braun', passt_zu: ['Linsen-Dal', 'Linsen-Bolognese', 'Linsensuppe', 'Linsen-Curry', 'Linsen-Wrap', 'Linsen-Bratlinge'] },
  { name: 'Kichererbsen (Dose)', schluessel: 'kichererbse', rolle: 'braun', passt_zu: ['Kichererbsen-Curry', 'Hummus-Wrap', 'Geröstete Kichererbsen', 'Orientalische Pfanne', 'Kichererbsen-Salat'] },
  { name: 'Kidneybohnen (Dose)', schluessel: 'bohne', rolle: 'braun', passt_zu: ['Chili', 'Bohnen-Wrap', 'Burrito-Bowl', 'Bohnen-Eintopf', 'Bohnen-Tomaten-Toast'] },
  { name: 'TK-Gemüsemix', schluessel: 'gemuese', rolle: 'gruen', passt_zu: ['Gemüsepfanne', 'Gemüse-Curry', 'Nudelpfanne', 'Gemüsesuppe', 'Reispfanne', 'Gemüse-Wrap'] },
  { name: 'Zwiebeln', schluessel: 'zwiebel', rolle: 'gruen', passt_zu: ['Tomatensoße', 'Chili', 'Curry', 'Bratkartoffeln', 'Zwiebelsuppe', 'Linsen-Ragù'] },
  { name: 'Haferflocken', schluessel: 'hafer', rolle: 'gelb', passt_zu: ['Gemüse-Bratlinge', 'Herzhafter Porridge', 'Bindung für Soßen'] },
];

const MIN_MOEGLICHKEITEN = 3;

/** Wählt die Multi-Use-Zutat mit dem größten Nutzen für den aktuellen Bestand. */
export function waehleMultiUse(snapshot: Snapshot, id: string): Einkaufsvorschlag {
  const hatRolle = (farbe: Farbe) => snapshot.zutaten.some((z) => z.quelle === 'bestand' && z.farbe === farbe);
  const hatSchon = (m: MultiUse) =>
    snapshot.zutaten.some((z) => z.quelle !== 'grundausstattung' && normalisiere(z.name).includes(m.schluessel));

  const bewertet = MULTI_USE
    .filter((m) => !hatSchon(m))
    .map((m) => {
      const preis = bekannterPreis(snapshot, m.name);
      // Eine fehlende Rolle (z. B. gar kein Sattmacher) zu füllen, eröffnet am meisten.
      const nutzen = m.passt_zu.length * (hatRolle(m.rolle) ? 1 : 2);
      return { m, preis, nutzen };
    })
    .sort((a, b) => b.nutzen - a.nutzen || (a.preis ?? 999) - (b.preis ?? 999));

  const beste = bewertet[0] ?? { m: MULTI_USE[0], preis: bekannterPreis(snapshot, MULTI_USE[0].name) };
  return {
    art: 'einkauf',
    id,
    name: beste.m.name,
    preis_cent: beste.preis,
    ermoeglicht: beste.m.passt_zu,
    begruendung: `Damit sind mindestens ${beste.m.passt_zu.length} weitere Kombi-Gerichte möglich.`,
  };
}

/** Prüft einen Einkaufsvorschlag der KI. Preise nur aus dem Bestand – nie geschätzt. */
export function pruefeEinkauf(roh: RohEinkauf | null | undefined, snapshot: Snapshot, id: string): Einkaufsvorschlag | null {
  if (!roh || typeof roh.name !== 'string' || !roh.name.trim()) return null;
  const ermoeglicht = (Array.isArray(roh.ermoeglicht) ? roh.ermoeglicht : [])
    .map((e) => kuerze(e, 60))
    .filter(Boolean)
    .slice(0, 12);
  if (ermoeglicht.length < MIN_MOEGLICHKEITEN) return null; // kein Multi-Use → lieber eigener Vorschlag
  const name = kuerze(roh.name, 60);
  return {
    art: 'einkauf',
    id,
    name,
    preis_cent: bekannterPreis(snapshot, name),
    ermoeglicht,
    begruendung: kuerze(roh.begruendung, 240) || `Damit sind ${ermoeglicht.length} weitere Gerichte möglich.`,
  };
}
