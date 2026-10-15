// „Komponenten entdecken“: Welche vorbereitbaren Bausteine würden diesem Haushalt helfen?
//
//   A) verwerten – aus dem, was da ist (z. B. Tomaten + Zwiebeln → Tomaten-Basis)
//   B) neu       – besonders nützlich, aber es fehlt noch etwas („Dafür fehlen noch: …“)
//
// Die KI (oder der Katalog im Demo-Modus) liefert Idee, Zutaten, Mengen und Verwendungen.
// Die Software prüft alles gegen den Vorrat, rechnet Mengen und bewertet die Nutzbarkeit –
// die Sterne sind KEINE Zahl der KI. Gespeichert wird erst nach „Komponente übernehmen“.
import { bildAnfrageFuerKomponente } from './bilder.ts';
import type {
  Einheit, Farbe, Gerichtstyp, KomponentenVorschlag, KomponentenZutat, Lagerort, Nutzbarkeit, RohKomponente, Snapshot,
  SnapshotZutat,
} from './typen.ts';
import { EINHEITEN, GERICHTSTYPEN, GEWUERZRICHTUNGEN } from './typen.ts';
import { GRUNDAUSSTATTUNG } from './snapshot.ts';
import { mengeAusPortionen } from './mengen.ts';
import { bereinigeText, deckungstext, pruefeName } from './wahrheit.ts';
import { fehlendeRollen, GERICHT_NAME, partnerVon, ROLLEN, TYPISCHE_GERICHTE } from './rollen.ts';
import { findeSorte, inSorteneinheit, produktSchluessel, verwendbar, type VorratSorte } from './einkaufsliste.ts';
import { bausteineFuerName, bausteineVon } from './grundbausteine.ts';
import { summiereNaehrwerte } from './naehrwerte.ts';
import { ausListe, kuerze, normalisiere } from './text.ts';

const FARBEN: Farbe[] = ['rot', 'braun', 'gruen', 'gelb', 'weiss', 'schwarz', 'blau'];
const LAGERORTE: Lagerort[] = ['gefrierfach', 'kuehlschrank', 'vorrat'];

/** Standard-Haltbarkeit je Lagerort (Einstellung, im Formular änderbar) – keine Aussage über das Produkt. */
export const HALTBARKEIT_STANDARD: Record<Lagerort, number> = { gefrierfach: 90, kuehlschrank: 4, vorrat: 30 };

const MAX_MENGE = 10_000;

function findeImSnapshot(snapshot: Snapshot, id: unknown, name: unknown): SnapshotZutat | null {
  if (typeof id === 'string') {
    const z = snapshot.zutaten.find((x) => x.id === id);
    if (z) return z;
  }
  if (typeof name === 'string' && name.trim()) {
    const k = produktSchluessel(name);
    return snapshot.zutaten.find((x) => produktSchluessel(x.name) === k) ?? null;
  }
  return null;
}

const dringend = (z: SnapshotZutat) => z.geoeffnet || z.bald_verbrauchen || z.rest || z.aufgetaut;

function zahl(x: unknown): number | null {
  const n = Number(x);
  return x === null || x === undefined || !Number.isFinite(n) || n <= 0 ? null : Math.min(MAX_MENGE, Math.round(n));
}

// ───────── Nutzbarkeit (Software, nachvollziehbar) ─────────

export const NUTZBARKEIT_GEWICHTE = {
  vielseitig: 0.35,
  kombinierbar: 0.2,
  lagerfaehig: 0.15,
  verwertet: 0.1,
  luecke: 0.1,
  machbar: 0.1,
} as const;

export function bewerteNutzbarkeit(k: {
  gerichtstypen: Gerichtstyp[];
  partner: string[];
  lagerort: Lagerort;
  verwertet: string[];
  fuelltLuecke: boolean;
  fehlend: number;
  rolle: Farbe;
}): Nutzbarkeit {
  const g = NUTZBARKEIT_GEWICHTE;
  const vielseitig = Math.min(1, k.gerichtstypen.length / 6);
  const kombinierbar = Math.min(1, k.partner.length / 4);
  const lagerfaehig = k.lagerort === 'gefrierfach' ? 1 : k.lagerort === 'vorrat' ? 0.8 : 0.4;
  const machbar = k.fehlend === 0 ? 1 : k.fehlend <= 2 ? 0.6 : 0.3;
  const punkte =
    g.vielseitig * vielseitig + g.kombinierbar * kombinierbar + g.lagerfaehig * lagerfaehig +
    g.verwertet * (k.verwertet.length ? 1 : 0) + g.luecke * (k.fuelltLuecke ? 1 : 0) + g.machbar * machbar;

  const gruende: string[] = [];
  gruende.push(k.gerichtstypen.length
    ? `Für ${k.gerichtstypen.length} Gerichtsarten: ${k.gerichtstypen.map((t) => GERICHT_NAME[t]).join(', ')}.`
    : 'Keine Gerichtsarten bekannt.');
  gruende.push(k.partner.length
    ? `Passt zu ${k.partner.length} Sachen im Vorrat: ${k.partner.slice(0, 4).join(', ')}.`
    : 'Im Vorrat ist gerade nichts, das direkt dazu passt.');
  gruende.push(k.lagerort === 'gefrierfach' ? 'Lässt sich einfrieren und portionsweise nutzen.'
    : k.lagerort === 'vorrat' ? 'Ohne Kühlung lagerbar.' : 'Nur kurz im Kühlschrank haltbar.');
  if (k.verwertet.length) gruende.push(`Verwertet: ${k.verwertet.join(', ')}.`);
  if (k.fuelltLuecke) gruende.push(`Füllt eine Lücke: Es gibt noch keine Komponente „${ROLLEN[k.rolle].name}“.`);
  gruende.push(k.fehlend === 0 ? 'Alles da.' : `Dafür fehlen noch ${k.fehlend} ${k.fehlend === 1 ? 'Zutat' : 'Zutaten'}.`);

  return {
    sterne: Math.max(1, Math.min(5, Math.round(1 + punkte * 4))),
    punkte: Math.round(punkte * 1000) / 1000,
    gruende,
  };
}

// ───────── Prüfung eines Vorschlags ─────────

export function pruefeKomponente(roh: RohKomponente | null | undefined, snapshot: Snapshot, id: string): KomponentenVorschlag | null {
  const rohName = kuerze(roh?.name, 60);
  if (!roh || !rohName) return null;
  const rolle = FARBEN.find((f) => f === normalisiere(String(roh.rolle ?? '')));
  if (!rolle || rolle === 'blau') return null; // Komponenten sind Bausteine, keine Komplettgerichte
  const lagerort = ausListe(roh.lagerort, LAGERORTE, 'gefrierfach');
  const portionen = Math.min(24, Math.max(1, Math.round(Number(roh.portionen)) || 6));
  const pg = Number(roh.portion_g);

  const zutaten: KomponentenZutat[] = [];
  const bestand = snapshot.zutaten;

  for (const rz of (Array.isArray(roh.zutaten) ? roh.zutaten : []).slice(0, 15)) {
    const z = findeImSnapshot(snapshot, rz?.id, rz?.name);
    if (z?.quelle === 'grundausstattung') {
      zutaten.push({ name: z.name, block_typ_id: null, menge: null, einheit: null, quelle: 'grundausstattung', dringend: false });
      continue;
    }
    if (z?.quelle === 'kuehlschrank') {
      zutaten.push({ name: z.name, block_typ_id: null, menge: null, einheit: null, quelle: 'kuehlschrank', dringend: true });
      continue;
    }
    if (z?.quelle === 'bestand' && z.anzahl !== null) {
      const einheitRoh = EINHEITEN.find((e) => e === rz?.einheit);
      const gewuenscht = rz?.portionen != null
        ? mengeAusPortionen(Math.max(0.25, Number(rz.portionen) || 1), z.einheit, z.portion_menge)
        : zahl(rz?.menge) !== null && (einheitRoh === z.einheit || !einheitRoh)
          ? (zahl(rz?.menge) as number)
          : mengeAusPortionen(1, z.einheit, z.portion_menge);
      const nimm = Math.min(gewuenscht, z.anzahl);
      zutaten.push({ name: z.name, block_typ_id: z.block_typ_id, menge: nimm, einheit: z.einheit, quelle: 'bestand', dringend: dringend(z) });
      const rest = gewuenscht - nimm;
      if (rest > 0) {
        // Teilweise da: Rest muss eingekauft werden.
        zutaten.push({ name: z.name, block_typ_id: z.block_typ_id, menge: rest, einheit: z.einheit, quelle: 'einkauf', dringend: false });
      }
      continue;
    }
    // Nicht im Vorrat → Einkauf. Menge und Einheit laut Vorschlag.
    const name = kuerze(rz?.name, 40);
    if (!name) continue;
    zutaten.push({ name, block_typ_id: null, menge: zahl(rz?.menge), einheit: EINHEITEN.find((e) => e === rz?.einheit) ?? null, quelle: 'einkauf', dringend: false });
  }
  if (zutaten.filter((z) => z.quelle !== 'grundausstattung').length === 0) return null;

  // Wahrheit: Name und Beschreibung nur mit Zutaten, die wirklich in der Komponente stecken.
  const deckung = deckungstext([...zutaten.map((z) => z.name), ...GRUNDAUSSTATTUNG]);
  const name = pruefeName(rohName, deckung, { hausgemacht_erlaubt: true });
  if ('fehler' in name) return null;

  const gerichtstypenKi = [...new Set((Array.isArray(roh.gerichtstypen) ? roh.gerichtstypen : [])
    .map((t) => GERICHTSTYPEN.find((g) => g === normalisiere(String(t)).replace(/ /g, '')))
    .filter((t): t is Gerichtstyp => !!t && t !== 'sonstiges' && t !== 'aufwaermen'))];
  // Zu wenig Angaben → typische Gerichtsarten der Rolle (Allgemeinwissen, nicht erfunden).
  const gerichtstypen = gerichtstypenKi.length >= 2 ? gerichtstypenKi : [...new Set([...gerichtstypenKi, ...TYPISCHE_GERICHTE[rolle]])];

  const verwertet = zutaten.filter((z) => z.quelle === 'bestand' && z.dringend).map((z) => z.name)
    .concat(zutaten.filter((z) => z.quelle === 'kuehlschrank').map((z) => z.name));
  const richtung = GEWUERZRICHTUNGEN.find((r) => r === normalisiere(String(roh.richtung ?? ''))) ?? null;
  const partner = partnerVon({ name: name.name, farbe: rolle, gerichtstypen, richtung }, bestand).map((p) => p.name);
  const fehlend = zutaten.filter((z) => z.quelle === 'einkauf');
  const fuelltLuecke = fehlendeRollen(bestand).includes(rolle);
  const nutzbarkeit = bewerteNutzbarkeit({ gerichtstypen, partner, lagerort, verwertet, fuelltLuecke, fehlend: fehlend.length, rolle });

  const vorteil = [
    `Für ${gerichtstypen.length} Gerichtsarten nutzbar`,
    verwertet.length ? `verwertet ${verwertet.slice(0, 2).join(' und ')}` : '',
    fehlend.length ? `dafür fehlen noch ${fehlend.length}` : 'alles da',
  ].filter(Boolean).join(', ') + '.';

  return {
    art: 'komponente',
    id,
    name: name.name,
    beschreibung: kuerze(bereinigeText(kuerze(roh.beschreibung, 240), deckung, { hausgemacht_erlaubt: true }).text, 200),
    rolle,
    richtung,
    gerichtstypen,
    verwendung: (Array.isArray(roh.verwendung) ? roh.verwendung : []).map((v) => kuerze(v, 40)).filter(Boolean).slice(0, 8),
    zutaten,
    portionen,
    portion_g: Number.isFinite(pg) && pg >= 20 && pg <= 1000 ? Math.round(pg) : null,
    lagerort,
    haltbar_tage: HALTBARKEIT_STANDARD[lagerort],
    zeit_min: Math.min(240, Math.max(5, Math.round(Number(roh.zeit_min)) || 30)),
    schritte: (Array.isArray(roh.schritte) ? roh.schritte : [])
      .map((s) => bereinigeText(kuerze(s, 200), deckung, { hausgemacht_erlaubt: true }).text)
      .filter(Boolean)
      .slice(0, 10),
    nutzbarkeit,
    naehrwerte: summiereNaehrwerte(zutaten.map((z) => ({
      name: z.name,
      menge: z.quelle === 'bestand' || (z.quelle === 'einkauf' && z.block_typ_id !== null) ? z.menge : null,
      naehrwert: z.block_typ_id !== null ? bestand.find((b) => b.block_typ_id === z.block_typ_id)?.naehrwert ?? null : null,
    })), portionen),
    verwertet,
    partner,
    typ: fehlend.length ? 'neu' : 'verwerten',
    vorteil,
    bild: bildAnfrageFuerKomponente({ name: name.name, zutaten }, roh.image_request),
  };
}

/** Datensatz für „Komponente übernehmen“ – erst nach Bestätigung im Formular gespeichert. */
export function komponenteAlsSorte(k: KomponentenVorschlag) {
  return {
    name: k.name,
    art: 'komponente' as const,
    farbe: k.rolle,
    lagerort: k.lagerort,
    einheit: 'portion' as const,
    groesse_g: k.portion_g ?? 100,
    haltbar_tage: k.haltbar_tage,
    herkunft: 'selbstgemacht' as const,
    zusammensetzung: [...new Set(k.zutaten.filter((z) => z.quelle !== 'grundausstattung').map((z) => z.name))],
    gerichtstypen: k.gerichtstypen,
    richtung: k.richtung,
  };
}

// ───────── Katalog für den Demo-Modus (ohne KI) ─────────

type KatalogZutat = { name: string; menge: number; einheit: Einheit };
type Katalog = {
  name: string; rolle: Farbe; richtung: string; gerichtstypen: Gerichtstyp[]; verwendung: string[];
  zutaten: KatalogZutat[]; portionen: number; portion_g: number; lagerort: Lagerort; zeit_min: number;
  beschreibung: string; schritte: string[];
};

/**
 * Vorkochbare Komponenten (Mengen für eine Charge): zuerst die vorbereiteten Basen und gekochten
 * Hülsenfrüchte aus dem Grundvorrat des Food-Baukastens, dann weitere klassische Kombi-Komponenten.
 */
export const KATALOG: Katalog[] = [
  {
    name: 'Tomaten-Gemüse-Basis', rolle: 'rot', richtung: 'italienisch', gerichtstypen: ['pasta', 'reisgericht', 'eintopf', 'auflauf', 'suppe'],
    verwendung: ['Nudeln mit Tomatensoße', 'Tomatenreis', 'Linsen-Tomaten-Reis', 'Eintopf'],
    zutaten: [{ name: 'Passierte Tomaten', menge: 1000, einheit: 'g' }, { name: 'Zwiebeln', menge: 150, einheit: 'g' }, { name: 'Möhren', menge: 200, einheit: 'g' }, { name: 'Knoblauch', menge: 10, einheit: 'g' }],
    portionen: 5, portion_g: 250, lagerort: 'gefrierfach', zeit_min: 35,
    beschreibung: 'Passierte Tomaten mit Zwiebeln, Möhren und Knoblauch eingekocht – die Grundlage für viele Gerichte.',
    schritte: ['Zwiebeln, Möhren und Knoblauch fein würfeln und in etwas Öl weich dünsten.', 'Tomaten dazugeben und 20 Minuten einkochen.', 'Abschmecken, rasch abkühlen, portionsweise einfrieren und mit Inhalt und Datum beschriften.'],
  },
  {
    name: 'Linsen-Bolognese-Basis', rolle: 'rot', richtung: 'italienisch', gerichtstypen: ['pasta', 'auflauf', 'reisgericht', 'eintopf'],
    verwendung: ['Linsen-Bolognese mit Nudeln', 'Linsen-Lasagne', 'Reis-Pfanne'],
    zutaten: [{ name: 'Rote Linsen', menge: 250, einheit: 'g' }, { name: 'Passierte Tomaten', menge: 1000, einheit: 'g' }, { name: 'Zwiebeln', menge: 150, einheit: 'g' }, { name: 'Möhren', menge: 200, einheit: 'g' }],
    portionen: 6, portion_g: 250, lagerort: 'gefrierfach', zeit_min: 35,
    beschreibung: 'Herzhafte Soße aus roten Linsen, Tomaten, Zwiebeln und Möhren.',
    schritte: ['Zwiebeln und Möhren klein schneiden und kurz dünsten.', 'Linsen abspülen, mit den Tomaten und etwa 500 ml Wasser dazugeben.', '20 Minuten köcheln, bis die Linsen weich sind; abschmecken.', 'Rasch abkühlen, portionsweise einfrieren und beschriften.'],
  },
  {
    name: 'Neutrale Gemüse-Basis', rolle: 'gruen', richtung: 'neutral', gerichtstypen: ['pasta', 'eintopf', 'curry', 'reisgericht', 'pfanne'],
    verwendung: ['Gemüse-Nudel-Pfanne', 'Linsen-Gemüse-Eintopf', 'Gemüse-Kokos-Curry'],
    zutaten: [{ name: 'Möhren', menge: 300, einheit: 'g' }, { name: 'Zwiebeln', menge: 150, einheit: 'g' }, { name: 'Paprika', menge: 2, einheit: 'stueck' }, { name: 'Zucchini', menge: 1, einheit: 'stueck' }],
    portionen: 4, portion_g: 200, lagerort: 'gefrierfach', zeit_min: 25,
    beschreibung: 'Vorbereitetes Gemüse ohne starke Würze – passt in Pfannen, Eintöpfe und Currys.',
    schritte: ['Gemüse waschen und in mundgerechte Stücke schneiden.', 'In etwas Öl 5 Minuten anbraten oder 2 Minuten blanchieren – es soll noch Biss haben.', 'Rasch abkühlen, portionsweise einfrieren und beschriften.'],
  },
  {
    name: 'Gekochte Kichererbsen', rolle: 'braun', richtung: 'neutral', gerichtstypen: ['curry', 'pasta', 'eintopf', 'reisgericht', 'pfanne'],
    verwendung: ['Reis mit Kichererbsen und Tomate', 'Nudeln mit Kichererbsen-Tomatensoße', 'Kartoffel-Kichererbsen-Topf'],
    zutaten: [{ name: 'Kichererbsen, trocken', menge: 500, einheit: 'g' }],
    portionen: 5, portion_g: 240, lagerort: 'gefrierfach', zeit_min: 100,
    beschreibung: 'Kichererbsen aus dem Vorrat eingeweicht und weich gekocht – Protein für viele Gerichte.',
    schritte: ['Kichererbsen mindestens 12 Stunden in reichlich Wasser einweichen.', 'Einweichwasser weggießen, in frischem Wasser 60–90 Minuten vollständig weich kochen.', 'Abgießen, rasch abkühlen, portionsweise einfrieren und beschriften.'],
  },
  {
    name: 'Gekochte Kidneybohnen', rolle: 'braun', richtung: 'mexikanisch', gerichtstypen: ['eintopf', 'reisgericht', 'wrap', 'bowl'],
    verwendung: ['Chili sin Carne', 'Kidneybohnen-Tomaten-Topf', 'Bowl'],
    zutaten: [{ name: 'Kidneybohnen, trocken', menge: 500, einheit: 'g' }],
    portionen: 5, portion_g: 250, lagerort: 'gefrierfach', zeit_min: 100,
    beschreibung: 'Kidneybohnen aus dem Vorrat eingeweicht und vollständig gekocht – roh sind sie giftig.',
    schritte: ['Bohnen mindestens 12 Stunden in reichlich Wasser einweichen.', 'Einweichwasser weggießen. In frischem Wasser 10 Minuten sprudelnd kochen, dann 60–90 Minuten vollständig weich garen.', 'Abgießen, rasch abkühlen, portionsweise einfrieren und beschriften.'],
  },
  {
    name: 'Gekochte Linsen', rolle: 'braun', richtung: 'neutral', gerichtstypen: ['eintopf', 'reisgericht', 'pasta', 'salat', 'bowl'],
    verwendung: ['Linsen-Gemüse-Eintopf', 'Linsen-Tomaten-Reis', 'Linsen-Bolognese'],
    zutaten: [{ name: 'Braune Linsen', menge: 250, einheit: 'g' }],
    portionen: 4, portion_g: 250, lagerort: 'gefrierfach', zeit_min: 30,
    beschreibung: 'Braune oder grüne Linsen bissfest gegart – Protein für Eintopf, Reis und Soßen.',
    schritte: ['Linsen abspülen und in reichlich Wasser 20–25 Minuten bissfest kochen.', 'Abgießen, rasch abkühlen.', 'Portionsweise einfrieren und beschriften.'],
  },
  {
    name: 'Falafel-Masse', rolle: 'braun', richtung: 'orientalisch', gerichtstypen: ['wrap', 'bowl', 'salat', 'burger', 'snack'],
    verwendung: ['Falafel-Wrap', 'Bowl', 'Salat', 'Burger'],
    zutaten: [{ name: 'Kichererbsen (Dose)', menge: 500, einheit: 'g' }, { name: 'Zwiebeln', menge: 80, einheit: 'g' }, { name: 'Haferflocken', menge: 60, einheit: 'g' }, { name: 'Knoblauch', menge: 10, einheit: 'g' }, { name: 'Kreuzkümmel', menge: 5, einheit: 'g' }],
    portionen: 6, portion_g: 100, lagerort: 'gefrierfach', zeit_min: 25,
    beschreibung: 'Kichererbsen mit Zwiebeln, Knoblauch und Kreuzkümmel, mit Haferflocken gebunden – roh portioniert, später knusprig braten.',
    schritte: ['Kichererbsen abtropfen lassen.', 'Mit Zwiebeln, Knoblauch, Haferflocken und Kreuzkümmel grob pürieren.', 'Zu Bällchen formen und roh einfrieren.'],
  },
  {
    name: 'Mexikanische Bohnen-Basis', rolle: 'braun', richtung: 'mexikanisch', gerichtstypen: ['wrap', 'bowl', 'reisgericht', 'eintopf', 'toast'],
    verwendung: ['Burrito', 'Bowl', 'Chili', 'Quesadilla'],
    zutaten: [{ name: 'Kidneybohnen (Dose)', menge: 500, einheit: 'g' }, { name: 'Gehackte Tomaten (Dose)', menge: 400, einheit: 'g' }, { name: 'Zwiebeln', menge: 100, einheit: 'g' }, { name: 'Paprika', menge: 2, einheit: 'stueck' }, { name: 'Kreuzkümmel', menge: 5, einheit: 'g' }],
    portionen: 6, portion_g: 170, lagerort: 'gefrierfach', zeit_min: 30,
    beschreibung: 'Bohnen, Tomaten, Paprika und Zwiebeln mit Kreuzkümmel geschmort.',
    schritte: ['Zwiebeln und Paprika würfeln und anbraten.', 'Bohnen, Tomaten und Kreuzkümmel dazugeben.', '15 Minuten schmoren, abschmecken, portionieren.'],
  },
  {
    name: 'Kokos-Curry-Basis', rolle: 'rot', richtung: 'indisch', gerichtstypen: ['curry', 'reisgericht', 'suppe', 'bowl'],
    verwendung: ['Gemüse-Curry', 'Linsen-Curry', 'Curry-Suppe', 'Reis-Bowl'],
    zutaten: [{ name: 'Kokosmilch (Dose)', menge: 400, einheit: 'ml' }, { name: 'Zwiebeln', menge: 100, einheit: 'g' }, { name: 'Currypaste', menge: 40, einheit: 'g' }, { name: 'Tomatenmark', menge: 40, einheit: 'g' }],
    portionen: 4, portion_g: 130, lagerort: 'gefrierfach', zeit_min: 20,
    beschreibung: 'Cremige Basis aus Kokosmilch, Zwiebeln, Currypaste und Tomatenmark.',
    schritte: ['Zwiebeln fein würfeln und anschwitzen.', 'Currypaste und Tomatenmark kurz mitrösten.', 'Mit Kokosmilch aufkochen, portionieren.'],
  },
  {
    name: 'Portionsreis', rolle: 'gelb', richtung: 'neutral', gerichtstypen: ['reisgericht', 'curry', 'bowl', 'pfanne', 'wrap'],
    verwendung: ['Curry mit Reis', 'Bowl', 'Gebratener Reis', 'Burrito'],
    zutaten: [{ name: 'Reis', menge: 500, einheit: 'g' }],
    portionen: 6, portion_g: 180, lagerort: 'gefrierfach', zeit_min: 25,
    beschreibung: 'Reis vorgekocht und portioniert – in 3 Minuten aufgewärmt.',
    schritte: ['Reis nach Packung kochen.', 'Schnell abkühlen lassen.', 'Portionsweise einfrieren.'],
  },
];

/** Sorte, die derselbe Grundbaustein ist („Rote Linsen“ ↔ „Rote Linsen, trocken“). */
function gleicherGrundbaustein(snapshot: Snapshot, name: string): SnapshotZutat | null {
  const ids = bausteineFuerName(name).map((b) => b.id);
  if (!ids.length) return null;
  return snapshot.zutaten.find((x) => x.quelle === 'bestand' && bausteineVon(x).some((b) => ids.includes(b.id))) ?? null;
}

/** Katalog als Rohvorschläge – bevorzugt, was der Vorrat schon hergibt. */
export function katalogVorschlaege(snapshot: Snapshot, max = 6): RohKomponente[] {
  const vorhanden = new Set(snapshot.zutaten.filter((z) => z.quelle === 'bestand').map((z) => produktSchluessel(z.name)));
  const bewertet = KATALOG
    .filter((k) => !vorhanden.has(produktSchluessel(k.name)))
    .map((k) => {
      const zutaten = k.zutaten.map((z) => {
        const s = findeImSnapshot(snapshot, null, z.name) ?? gleicherGrundbaustein(snapshot, z.name);
        return s && s.quelle !== 'grundausstattung' ? { id: s.id, menge: z.menge, einheit: z.einheit } : { name: z.name, menge: z.menge, einheit: z.einheit };
      });
      const treffer = zutaten.filter((z) => 'id' in z).length;
      return { k, zutaten, treffer };
    })
    .sort((a, b) => b.treffer - a.treffer || a.k.name.localeCompare(b.k.name));
  return bewertet.slice(0, max).map(({ k, zutaten }) => ({
    name: k.name, beschreibung: k.beschreibung, rolle: k.rolle, richtung: k.richtung, gerichtstypen: k.gerichtstypen,
    verwendung: k.verwendung, zutaten: [...zutaten, { id: 'g-oel' }, { id: 'g-salz' }], portionen: k.portionen,
    portion_g: k.portion_g, lagerort: k.lagerort, zeit_min: k.zeit_min, schritte: k.schritte,
  }));
}

/** Gibt es diese Komponente schon im Vorrat (gleicher Produktname)? */
export function schonVorhanden(name: string, snapshot: Snapshot): boolean {
  const k = produktSchluessel(name);
  return snapshot.zutaten.some((z) => z.quelle === 'bestand' && produktSchluessel(z.name) === k);
}

// ───────── Produktion: Menge wählen, Zutaten skalieren, gegen den Vorrat prüfen ─────────

export type ProduktionsZeile = {
  name: string;
  /** passende Sorte im Vorrat (sonst wird die Zutat nicht gebucht) */
  sorte: VorratSorte | null;
  /** benötigte Menge – in der Einheit der Sorte, sonst in der Einheit des Rezepts; null = unbekannt */
  benoetigt: number | null;
  einheit: Einheit | null;
  vorhanden: number | null;
  /** was eingekauft werden müsste; null = Menge unbekannt */
  fehlt: number | null;
  status: 'da' | 'teilweise' | 'fehlt' | 'nicht_erfasst' | 'immer_da';
};

export type Produktion = {
  portionen: number;
  zeilen: ProduktionsZeile[];
  /** wird beim Bestätigen entnommen (höchstens, was da ist) */
  posten: { block_typ_id: number; name: string; menge: number; einheit: Einheit; art: VorratSorte['art'] }[];
  /** Zutaten, die nicht als Sorte geführt werden – sie werden nicht gebucht */
  nicht_erfasst: string[];
  fehlt: { name: string; menge: number | null; einheit: Einheit | null }[];
};

/** Rezeptmenge auf andere Portionen umrechnen (g/ml gerundet, Portionen/Stück aufgerundet). */
export function skaliereMenge(menge: number, einheit: Einheit | null, von: number, auf: number): number {
  const roh = (menge * auf) / Math.max(1, von);
  return einheit === 'g' || einheit === 'ml' ? Math.max(1, Math.round(roh)) : Math.max(1, Math.ceil(roh - 1e-9));
}

/**
 * Produktion vorbereiten: Zutaten der Komponente für `portionen` skalieren und gegen den AKTUELLEN
 * Vorrat prüfen – vorhanden, benötigt, fehlt. Ändert nichts; gebucht wird erst nach Bestätigung.
 */
export function bereiteProduktionVor(k: Pick<KomponentenVorschlag, 'zutaten' | 'portionen'>, portionen: number, sorten: VorratSorte[], zielId: number | null): Produktion {
  // Rezeptmengen je Zutat zusammenfassen (ein Teil aus dem Vorrat + Rest aus dem Einkauf = eine Zutat)
  const zutaten: { name: string; block_typ_id: number | null; menge: number | null; einheit: Einheit | null; quelle: KomponentenZutat['quelle'] }[] = [];
  for (const z of k.zutaten) {
    const schon = zutaten.find((x) => x.name === z.name && x.einheit === z.einheit);
    if (schon) {
      schon.menge = schon.menge !== null && z.menge !== null ? schon.menge + z.menge : null;
      if (z.quelle === 'bestand') schon.quelle = 'bestand';
      schon.block_typ_id = schon.block_typ_id ?? z.block_typ_id;
      continue;
    }
    zutaten.push({ name: z.name, block_typ_id: z.block_typ_id, menge: z.menge, einheit: z.einheit, quelle: z.quelle });
  }

  const p = Math.max(1, Math.round(portionen));
  const ergebnis: Produktion = { portionen: p, zeilen: [], posten: [], nicht_erfasst: [], fehlt: [] };
  for (const z of zutaten) {
    if (z.quelle === 'grundausstattung') {
      ergebnis.zeilen.push({ name: z.name, sorte: null, benoetigt: null, einheit: null, vorhanden: null, fehlt: null, status: 'immer_da' });
      continue;
    }
    const benoetigt = z.menge === null ? null : skaliereMenge(z.menge, z.einheit, k.portionen, p);
    const sorte = z.quelle === 'kuehlschrank' ? null : findeSorte({ name: z.name, block_typ_id: z.block_typ_id }, sorten);
    const inSorte = sorte && benoetigt !== null ? inSorteneinheit(benoetigt, z.einheit, sorte) : null;
    if (!sorte || sorte.id === zielId || (benoetigt !== null && inSorte === null)) {
      ergebnis.nicht_erfasst.push(z.name);
      ergebnis.fehlt.push({ name: z.name, menge: benoetigt, einheit: z.einheit });
      ergebnis.zeilen.push({ name: z.name, sorte: null, benoetigt, einheit: z.einheit, vorhanden: null, fehlt: benoetigt, status: 'nicht_erfasst' });
      continue;
    }
    const da = verwendbar(sorte);
    if (inSorte === null) {
      // Menge unbekannt: ist etwas da, gilt es als gedeckt – gebucht wird dann nichts (keine erfundene Menge)
      ergebnis.zeilen.push({ name: sorte.name, sorte, benoetigt: null, einheit: sorte.einheit, vorhanden: da, fehlt: da > 0 ? 0 : null, status: da > 0 ? 'da' : 'fehlt' });
      if (da <= 0) ergebnis.fehlt.push({ name: sorte.name, menge: null, einheit: sorte.einheit });
      continue;
    }
    const nimm = Math.min(inSorte, da);
    const rest = inSorte - nimm;
    if (nimm > 0) ergebnis.posten.push({ block_typ_id: sorte.id, name: sorte.name, menge: nimm, einheit: sorte.einheit, art: sorte.art });
    if (rest > 0) ergebnis.fehlt.push({ name: sorte.name, menge: rest, einheit: sorte.einheit });
    ergebnis.zeilen.push({
      name: sorte.name, sorte, benoetigt: inSorte, einheit: sorte.einheit, vorhanden: da, fehlt: rest,
      status: rest === 0 ? 'da' : nimm > 0 ? 'teilweise' : 'fehlt',
    });
  }
  return ergebnis;
}
