// KI-Benchmark: misst je Anbieter/Modell und Szenario, was die KI liefert – und was die Kombi-Engine
// davon übrig lässt. Fair: Erfundenes bringt nie Punkte, es kostet nur. Bewertet wird, was die
// Prüfung besteht; Halluzinationen werden aus der ROHANTWORT gezählt, bevor die Engine sie entfernt.
import type { KiAnbieter, KiAnfrage, RohAntwort, RohGericht, RohKomponente, Snapshot } from '../../supabase/functions/_shared/kombi/typen.ts';
import { baueSnapshot } from '../../supabase/functions/_shared/kombi/snapshot.ts';
import { bearbeite } from '../../supabase/functions/_shared/kombi/engine.ts';
import { behauptungenIn, flach, namensQualitaet } from '../../supabase/functions/_shared/kombi/wahrheit.ts';
import { normalisiere } from '../../supabase/functions/_shared/kombi/text.ts';
import { STICHTAG, type Szenario } from './szenarien.ts';

export type Messung = {
  anbieter: string;
  szenario: string;
  aufgabe: string;
  ms: number;
  fehler: string | null;
  json_gueltig: boolean;
  schema_gueltig: boolean;
  roh: number;
  bestanden: number;
  verworfen: string[];
  // Halluzinationen (aus der Rohantwort)
  erfundene_zutaten: number;
  erfundene_mengen: number;
  erfundene_preise: number;
  erfundene_naehrwerte: number;
  bestandsbehauptungen: number;
  erfundene_bildquellen: number;
  // Nutzung und Qualität (aus geprüften Vorschlägen)
  anteil_vorhanden: number | null;
  anteil_mit_komponenten: number | null;
  dringend_genutzt: number | null;
  kreativitaet: number | null;
  generische_namen: number;
  vielfalt: number | null;
  bildanforderungen: number;
  bildanforderungen_plausibel: number;
  namen: string[];
  punkte: number;
};

/** Standardnamen, die Kombi vermeiden will („Tomaten-Pasta“, „Gemüse-Reis“, „Pasta mit Gemüse“). */
export function istGenerisch(name: string): boolean {
  const n = flach(name);
  const zutat = '(tomaten?|gemuese|joghurt|linsen|reis|nudel|nudeln|pasta|kartoffel|kartoffeln|bohnen|kichererbsen|spinat|brokkoli|tofu)';
  const typ = '(pasta|reis|bowl|pfanne|curry|suppe|eintopf|salat|wrap|auflauf|nudeln|toast)';
  return new RegExp(`^${zutat} ${typ}$`).test(n) || new RegExp(`^${typ} mit ${zutat}( und ${zutat})?$`).test(n) || /^einfach(e|es)? /.test(n);
}

export function anfrageFuer(s: Szenario): KiAnfrage {
  const snapshot: Snapshot = baueSnapshot(s.bestand, s.kuehlschrank ?? '', STICHTAG);
  return {
    snapshot,
    optionen: { personen: 2, max_minuten: 30, guenstig: true, ...s.optionen },
    gesehen: s.gesehen ?? [],
    feedback: s.feedback ?? [],
    modus: s.modus ?? { art: 'normal' },
    anzahl: s.anzahl ?? 3,
    aufgabe: s.aufgabe ?? 'gerichte',
  };
}

const TEXTE = (r: RohGericht | RohKomponente) =>
  [r.name, r.beschreibung, (r as RohGericht).begruendung, ...(Array.isArray(r.schritte) ? r.schritte : [])].filter((t): t is string => typeof t === 'string');

/** Zählt erfundene Fakten in der Rohantwort – unabhängig davon, was die Engine später entfernt. */
export function zaehleHalluzinationen(roh: RohAntwort | null, snapshot: Snapshot) {
  const e = { zutaten: 0, mengen: 0, preise: 0, naehrwerte: 0, bestand: 0, bildquellen: 0 };
  if (!roh) return e;
  const eintraege: (RohGericht | RohKomponente)[] = [...(Array.isArray(roh.vorschlaege) ? roh.vorschlaege : []), ...(Array.isArray(roh.komponenten) ? roh.komponenten : [])];
  const namen = new Set(snapshot.zutaten.map((z) => normalisiere(z.name)));
  for (const r of eintraege) {
    if (!r || typeof r !== 'object') continue;
    for (const rz of Array.isArray(r.zutaten) ? r.zutaten : []) {
      const z = typeof rz?.id === 'string' ? snapshot.zutaten.find((x) => x.id === rz.id) : undefined;
      // mit id: muss es geben. ohne id (nur bei Komponenten-Einkauf erlaubt): als „vorhanden“ ausgegebener Name, den es nicht gibt
      if (typeof rz?.id === 'string' && !z) e.zutaten++;
      if (!rz?.id && typeof rz?.name === 'string' && namen.has(normalisiere(rz.name)) === false && !('menge' in rz && 'einheit' in rz)) e.zutaten++;
      const portionen = Number(rz?.portionen ?? rz?.bloecke);
      if (z && z.anzahl !== null && Number.isFinite(portionen) && portionen * z.portion_menge > z.anzahl) e.mengen++;
    }
    for (const t of TEXTE(r)) {
      for (const b of behauptungenIn(t)) {
        if (b === 'Preisangabe') e.preise++;
        else if (b === 'Nährwertangabe') e.naehrwerte++;
        else if (b === 'Bestandsmenge') e.bestand++;
        else if (b === 'Link/Bildquelle') e.bildquellen++;
      }
    }
    const felder = r as Record<string, unknown>;
    for (const k of ['kcal', 'kalorien', 'naehrwerte', 'calories']) if (k in felder) e.naehrwerte++;
    for (const k of ['preis', 'kosten', 'price', 'cost', 'preis_cent']) if (k in felder) e.preise++;
    if (/https?:\/\/|www\./i.test(JSON.stringify(r.image_request ?? '')) || 'image_url' in felder || 'bild_url' in felder) e.bildquellen++;
  }
  return e;
}

const anteil = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) / 100 : null);

/** Ein Szenario mit einem Anbieter: Zeit, JSON/Schema, Prüfung, Halluzinationen, Nutzung, Qualität. */
export async function messe(anbieter: KiAnbieter, s: Szenario, jetzt: () => number = () => performance.now()): Promise<Messung> {
  const anfrage = anfrageFuer(s);
  let roh: RohAntwort | null = null;
  let gefragt = false;
  const messend: KiAnbieter = { name: anbieter.name, async vorschlagen(a) { gefragt = true; roh = await anbieter.vorschlagen(a); return roh; } };
  const start = jetzt();
  let fehler: string | null = null;
  let ergebnis: Awaited<ReturnType<typeof bearbeite>> | null = null;
  try {
    ergebnis = await bearbeite(messend, anfrage);
  } catch (e) {
    fehler = e instanceof Error ? e.message : String(e);
  }
  const ms = Math.round(jetzt() - start);
  const r = roh as RohAntwort | null;
  const h = zaehleHalluzinationen(r, anfrage.snapshot);
  const rohListe = r ? [...(Array.isArray(r.vorschlaege) ? r.vorschlaege : []), ...(Array.isArray(r.komponenten) ? r.komponenten : [])] : [];
  const bestandsnamen = anfrage.snapshot.zutaten.map((z) => z.name);

  let bestanden = 0;
  let namen: string[] = [];
  let anteilVorhanden: number | null = null;
  let mitKomponenten: number | null = null;
  let dringendGenutzt: number | null = null;
  let vielfalt: number | null = null;
  let bildPlausibel = 0;
  const verworfen = ergebnis ? ergebnis.verworfen.map((v) => `${v.name}: ${v.grund}`) : [];
  if (ergebnis && ergebnis.aufgabe === 'komponenten') {
    bestanden = ergebnis.komponenten.length;
    namen = ergebnis.komponenten.map((k) => k.name);
    const zutaten = ergebnis.komponenten.flatMap((k) => k.zutaten.filter((z) => z.quelle !== 'grundausstattung'));
    anteilVorhanden = anteil(zutaten.filter((z) => z.quelle === 'bestand' || z.quelle === 'kuehlschrank').length, zutaten.length);
    bildPlausibel = ergebnis.komponenten.filter((k) => k.bild?.begriff_von === 'ki').length;
  } else if (ergebnis) {
    const gerichte = ergebnis.gerichte;
    bestanden = gerichte.length;
    namen = gerichte.map((g) => g.name);
    const echte = gerichte.flatMap((g) => g.zutaten.filter((z) => z.quelle !== 'grundausstattung'));
    anteilVorhanden = anteil(echte.length, echte.length + gerichte.reduce((n, g) => n + g.fehlt.length, 0));
    mitKomponenten = anteil(gerichte.filter((g) => g.zutaten.some((z) => z.art === 'komponente')).length, gerichte.length);
    if (s.dringend?.length) {
      const genutzt = new Set(gerichte.flatMap((g) => g.zutaten.map((z) => z.name)));
      dringendGenutzt = anteil(s.dringend.filter((d) => genutzt.has(d)).length, s.dringend.length);
    }
    vielfalt = anteil(new Set(gerichte.map((g) => g.eigenschaften.gerichtstyp)).size, gerichte.length);
    bildPlausibel = gerichte.filter((g) => g.bild?.begriff_von === 'ki').length;
  }
  const kreativ = namen.length ? Math.round((namen.reduce((s2, n) => s2 + namensQualitaet(n, bestandsnamen), 0) / namen.length) * 100) / 100 : null;
  const generisch = namen.filter(istGenerisch).length;
  const bildanforderungen = rohListe.filter((x) => x && typeof x === 'object' && x.image_request && typeof x.image_request === 'object').length;
  // Die Engine fragt die KI gar nicht, wenn es nichts zu tun gibt (z. B. Reste ohne Dringendes) – das ist kein Formatfehler.
  const json_gueltig = fehler === null || !/kein JSON|kein gültiges JSON/i.test(fehler);
  const schema_gueltig = !gefragt ? fehler === null : r !== null && (Array.isArray(r.vorschlaege) || Array.isArray(r.komponenten));

  const m: Messung = {
    anbieter: anbieter.name, szenario: s.id, aufgabe: anfrage.aufgabe ?? 'gerichte', ms, fehler, json_gueltig, schema_gueltig,
    roh: rohListe.length, bestanden, verworfen,
    erfundene_zutaten: h.zutaten, erfundene_mengen: h.mengen, erfundene_preise: h.preise, erfundene_naehrwerte: h.naehrwerte,
    bestandsbehauptungen: h.bestand, erfundene_bildquellen: h.bildquellen,
    anteil_vorhanden: anteilVorhanden, anteil_mit_komponenten: mitKomponenten, dringend_genutzt: dringendGenutzt,
    kreativitaet: kreativ, generische_namen: generisch, vielfalt,
    bildanforderungen, bildanforderungen_plausibel: bildPlausibel, namen, punkte: 0,
  };
  m.punkte = punkte(m, s);
  return m;
}

/**
 * Punkte 0–100. Positiv zählt nur, was die Prüfung bestanden hat; jede erfundene Tatsache kostet
 * 5 Punkte. Szenarien, in denen „nichts“ die richtige Antwort ist (leer, Reste ohne Dringendes),
 * belohnen Zurückhaltung statt Menge.
 */
export function punkte(m: Messung, s: Szenario): number {
  const halluzinationen = m.erfundene_zutaten + m.erfundene_mengen + m.erfundene_preise + m.erfundene_naehrwerte +
    m.bestandsbehauptungen + m.erfundene_bildquellen;
  const zurueckhaltung = s.id === 'leer' || s.id === 'reste-nichts';
  let p: number;
  if (!m.json_gueltig || !m.schema_gueltig) p = 0;
  else if (zurueckhaltung) p = m.bestanden === 0 ? 100 : 40;
  else {
    const gewuenscht = s.aufgabe === 'woche' ? s.anzahl ?? 3 : Math.min(s.anzahl ?? 3, 3);
    const menge = Math.min(1, m.bestanden / Math.max(1, gewuenscht));
    const quote = m.roh ? m.bestanden / m.roh : 0;
    p = 100 * (
      0.25 * menge + 0.15 * quote + 0.15 * (m.anteil_vorhanden ?? 0) + 0.1 * (m.dringend_genutzt ?? m.anteil_vorhanden ?? 0) +
      0.1 * (m.vielfalt ?? 0) + 0.1 * (m.kreativitaet ?? 0) * (m.bestanden ? 1 - m.generische_namen / m.bestanden : 0) +
      0.15 * (m.bestanden ? m.bildanforderungen_plausibel / m.bestanden : 0)
    );
  }
  return Math.max(0, Math.round(p - 5 * halluzinationen));
}

export type Zusammenfassung = {
  anbieter: string;
  szenarien: number;
  punkte: number;
  ms_median: number;
  json_gueltig: number;
  schema_gueltig: number;
  bestanden: number;
  roh: number;
  halluzinationen: number;
  generische_namen: number;
  bildanforderungen_plausibel: number;
};

export function fasseZusammen(ms: Messung[]): Zusammenfassung[] {
  const nach = new Map<string, Messung[]>();
  for (const m of ms) nach.set(m.anbieter, [...(nach.get(m.anbieter) ?? []), m]);
  return [...nach.entries()].map(([anbieter, l]) => {
    const zeiten = l.map((m) => m.ms).sort((a, b) => a - b);
    const summe = (f: (m: Messung) => number) => l.reduce((s, m) => s + f(m), 0);
    return {
      anbieter,
      szenarien: l.length,
      punkte: Math.round(summe((m) => m.punkte) / l.length),
      ms_median: zeiten[Math.floor(zeiten.length / 2)] ?? 0,
      json_gueltig: summe((m) => Number(m.json_gueltig)),
      schema_gueltig: summe((m) => Number(m.schema_gueltig)),
      bestanden: summe((m) => m.bestanden),
      roh: summe((m) => m.roh),
      halluzinationen: summe((m) => m.erfundene_zutaten + m.erfundene_mengen + m.erfundene_preise + m.erfundene_naehrwerte + m.bestandsbehauptungen + m.erfundene_bildquellen),
      generische_namen: summe((m) => m.generische_namen),
      bildanforderungen_plausibel: summe((m) => m.bildanforderungen_plausibel),
    };
  }).sort((a, b) => b.punkte - a.punkte);
}

/**
 * Attrappe, die absichtlich halluziniert (erfundene Zutaten, Mengen, Preise, kcal, Bild-URLs) –
 * nur zum Nachweis, dass der Benchmark so etwas bestraft. Nie ein echter Anbieter.
 */
export function halluzinierer(): KiAnbieter {
  return {
    name: 'attrappe:halluzinierer',
    async vorschlagen(a) {
      const erstes = a.snapshot.zutaten.find((z) => z.quelle === 'bestand');
      const gericht: RohGericht = {
        name: 'Steak mit Trüffel-Pommes',
        beschreibung: 'Du hast noch 3 Steaks im Kühlschrank. Nur 450 kcal und kostet 1,50 €. Bild: https://bilder.example/steak.jpg',
        zutaten: [{ id: 'b999', portionen: 2 }, ...(erstes ? [{ id: erstes.id, portionen: 99 }] : []), { name: 'Rinderfilet' }],
        schritte: ['Steak braten.'],
        eigenschaften: { gerichtstyp: 'pfanne' },
        image_request: { needed: true, query: 'https://bilder.example/steak.jpg' },
      };
      return a.aufgabe === 'komponenten'
        ? { komponenten: [{ name: 'Trüffel-Basis', rolle: 'rot', zutaten: [{ id: 'b999', portionen: 1 }] }] }
        : { vorschlaege: [gericht, { ...gericht, name: 'Pasta mit Gemüse' }] };
    },
  };
}
