// „Komponenten entdecken“: Welche vorbereitbaren Bausteine würden diesem Haushalt helfen?
//
//   A) verwerten – aus dem, was da ist (z. B. Tomaten + Zwiebeln → Tomaten-Basis)
//   B) neu       – besonders nützlich, aber es fehlt noch etwas („Dafür fehlen noch: …“)
//
// Die KI (oder der Katalog im Demo-Modus) liefert Idee, Zutaten, Mengen und Verwendungen.
// Die Software prüft alles gegen den Vorrat, rechnet Kosten und bewertet die Nutzbarkeit –
// die Sterne sind KEINE Zahl der KI. Gespeichert wird erst nach „Komponente übernehmen“.
import type {
  Einheit, Farbe, Gerichtstyp, KomponentenVorschlag, KomponentenZutat, Lagerort, Nutzbarkeit, RohKomponente, Snapshot,
  SnapshotZutat,
} from './typen.ts';
import { EINHEITEN, GERICHTSTYPEN, GEWUERZRICHTUNGEN } from './typen.ts';
import { GRUNDAUSSTATTUNG, bekannterPreisInfo } from './snapshot.ts';
import { mengeAusPortionen } from './mengen.ts';
import { type KostenPosten, summiereKosten, verbrauchswert } from './kosten.ts';
import { bereinigeText, deckungstext, pruefeName } from './wahrheit.ts';
import { fehlendeRollen, GERICHT_NAME, partnerVon, ROLLEN, TYPISCHE_GERICHTE } from './rollen.ts';
import { produktSchluessel } from './einkaufsliste.ts';
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
  const posten: KostenPosten[] = [];
  const einkauf: KostenPosten[] = [];
  const bestand = snapshot.zutaten;

  for (const rz of (Array.isArray(roh.zutaten) ? roh.zutaten : []).slice(0, 15)) {
    const z = findeImSnapshot(snapshot, rz?.id, rz?.name);
    if (z?.quelle === 'grundausstattung') {
      zutaten.push({ name: z.name, block_typ_id: null, menge: null, einheit: null, quelle: 'grundausstattung', kosten_cent: null, dringend: false });
      continue;
    }
    if (z?.quelle === 'kuehlschrank') {
      zutaten.push({ name: z.name, block_typ_id: null, menge: null, einheit: null, quelle: 'kuehlschrank', kosten_cent: null, dringend: true });
      posten.push({ name: z.name, cent: null });
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
      const wert = verbrauchswert(nimm, z);
      zutaten.push({ name: z.name, block_typ_id: z.block_typ_id, menge: nimm, einheit: z.einheit, quelle: 'bestand', kosten_cent: wert, dringend: dringend(z) });
      posten.push({ name: z.name, cent: wert });
      const rest = gewuenscht - nimm;
      if (rest > 0) {
        // Teilweise da: Rest muss eingekauft werden.
        const w = verbrauchswert(rest, z);
        zutaten.push({ name: z.name, block_typ_id: z.block_typ_id, menge: rest, einheit: z.einheit, quelle: 'einkauf', kosten_cent: w, dringend: false });
        posten.push({ name: z.name, cent: w });
        einkauf.push({ name: z.name, cent: z.kosten_cent === null ? null : Math.ceil(rest / Math.max(1, z.kosten_menge)) * z.kosten_cent });
      }
      continue;
    }
    // Nicht im Vorrat → Einkauf. Menge und Einheit laut Vorschlag, Preis nur, wenn bekannt.
    const name = kuerze(rz?.name, 40);
    if (!name) continue;
    const menge = zahl(rz?.menge);
    const einheit = EINHEITEN.find((e) => e === rz?.einheit) ?? null;
    const preis = bekannterPreisInfo(snapshot, name);
    const passend = preis && menge !== null && einheit === preis.einheit;
    zutaten.push({
      name, block_typ_id: null, menge: menge, einheit, quelle: 'einkauf',
      kosten_cent: passend ? verbrauchswert(menge as number, preis) : null, dringend: false,
    });
    posten.push({ name, cent: passend ? verbrauchswert(menge as number, preis) : null });
    einkauf.push({ name, cent: passend ? Math.ceil((menge as number) / Math.max(1, preis.kosten_menge)) * preis.kosten_cent : null });
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
    kosten: summiereKosten(posten, portionen),
    einkauf: summiereKosten(einkauf, 1),
    verwertet,
    partner,
    typ: fehlend.length ? 'neu' : 'verwerten',
    vorteil,
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
    // Herstellungskosten nur, wenn vollständig berechnet: „X € für N Portionen“
    kosten_cent: k.kosten.status === 'berechnet' ? k.kosten.gesamt_cent : null,
    kosten_menge: k.portionen,
  };
}

// ───────── Katalog für den Demo-Modus (ohne KI) ─────────

type KatalogZutat = { name: string; menge: number; einheit: Einheit };
type Katalog = {
  name: string; rolle: Farbe; richtung: string; gerichtstypen: Gerichtstyp[]; verwendung: string[];
  zutaten: KatalogZutat[]; portionen: number; portion_g: number; lagerort: Lagerort; zeit_min: number;
  beschreibung: string; schritte: string[];
};

/** Klassische vorkochbare Kombi-Komponenten (Mengen für eine Charge). */
export const KATALOG: Katalog[] = [
  {
    name: 'Tomaten-Basis', rolle: 'rot', richtung: 'italienisch', gerichtstypen: ['pasta', 'pizza', 'wrap', 'suppe', 'auflauf', 'eintopf'],
    verwendung: ['Pasta', 'Pizza', 'Wraps', 'Shakshuka', 'Suppe', 'Auflauf'],
    zutaten: [{ name: 'Gehackte Tomaten (Dose)', menge: 800, einheit: 'g' }, { name: 'Zwiebeln', menge: 150, einheit: 'g' }, { name: 'Knoblauch', menge: 10, einheit: 'g' }],
    portionen: 6, portion_g: 150, lagerort: 'gefrierfach', zeit_min: 30,
    beschreibung: 'Tomaten mit Zwiebeln und Knoblauch langsam eingekocht – die Grundlage für viele Gerichte.',
    schritte: ['Zwiebeln und Knoblauch fein würfeln und in Öl glasig dünsten.', 'Tomaten dazugeben und 20 Minuten einkochen.', 'Mit Salz und Pfeffer abschmecken, portionsweise einfrieren.'],
  },
  {
    name: 'Linsen-Bolognese', rolle: 'rot', richtung: 'italienisch', gerichtstypen: ['pasta', 'auflauf', 'wrap', 'reisgericht'],
    verwendung: ['Pasta', 'Lasagne', 'Gefüllte Wraps', 'Reis-Pfanne'],
    zutaten: [{ name: 'Rote Linsen', menge: 250, einheit: 'g' }, { name: 'Gehackte Tomaten (Dose)', menge: 400, einheit: 'g' }, { name: 'Zwiebeln', menge: 100, einheit: 'g' }, { name: 'Karotten', menge: 150, einheit: 'g' }],
    portionen: 6, portion_g: 180, lagerort: 'gefrierfach', zeit_min: 35,
    beschreibung: 'Herzhafte Soße aus roten Linsen, Tomaten, Zwiebeln und Karotten.',
    schritte: ['Zwiebeln und Karotten klein schneiden und anbraten.', 'Linsen und Tomaten mit etwas Wasser dazugeben.', '20 Minuten köcheln, abschmecken, portionieren.'],
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
    name: 'Ofengemüse', rolle: 'gruen', richtung: 'neutral', gerichtstypen: ['bowl', 'pasta', 'wrap', 'salat', 'auflauf'],
    verwendung: ['Bowl', 'Ofengemüse-Pasta', 'Wrap', 'Auflauf'],
    zutaten: [{ name: 'Paprika', menge: 3, einheit: 'stueck' }, { name: 'Zucchini', menge: 2, einheit: 'stueck' }, { name: 'Zwiebeln', menge: 150, einheit: 'g' }],
    portionen: 4, portion_g: 150, lagerort: 'gefrierfach', zeit_min: 35,
    beschreibung: 'Paprika, Zucchini und Zwiebeln im Ofen geröstet.',
    schritte: ['Gemüse in Stücke schneiden, mit Öl und Salz mischen.', 'Bei 200 °C etwa 25 Minuten rösten.', 'Abkühlen lassen und portionsweise einfrieren.'],
  },
  {
    name: 'Portionsreis', rolle: 'gelb', richtung: 'neutral', gerichtstypen: ['reisgericht', 'curry', 'bowl', 'pfanne', 'wrap'],
    verwendung: ['Curry mit Reis', 'Bowl', 'Gebratener Reis', 'Burrito'],
    zutaten: [{ name: 'Reis', menge: 500, einheit: 'g' }],
    portionen: 6, portion_g: 180, lagerort: 'gefrierfach', zeit_min: 25,
    beschreibung: 'Reis vorgekocht und portioniert – in 3 Minuten aufgewärmt.',
    schritte: ['Reis nach Packung kochen.', 'Schnell abkühlen lassen.', 'Portionsweise einfrieren.'],
  },
  {
    name: 'Linsen gekocht', rolle: 'braun', richtung: 'neutral', gerichtstypen: ['bowl', 'salat', 'curry', 'suppe', 'wrap', 'pasta'],
    verwendung: ['Linsen-Bowl', 'Salat', 'Dal', 'Suppe'],
    zutaten: [{ name: 'Rote Linsen', menge: 500, einheit: 'g' }],
    portionen: 8, portion_g: 100, lagerort: 'gefrierfach', zeit_min: 20,
    beschreibung: 'Rote Linsen vorgekocht – Protein für viele Gerichte.',
    schritte: ['Linsen waschen und in Salzwasser 12 Minuten kochen.', 'Abgießen und abkühlen lassen.', 'Portionsweise einfrieren.'],
  },
];

/** Katalog als Rohvorschläge – bevorzugt, was der Vorrat schon hergibt. */
export function katalogVorschlaege(snapshot: Snapshot, max = 6): RohKomponente[] {
  const vorhanden = new Set(snapshot.zutaten.filter((z) => z.quelle === 'bestand').map((z) => produktSchluessel(z.name)));
  const bewertet = KATALOG
    .filter((k) => !vorhanden.has(produktSchluessel(k.name)))
    .map((k) => {
      const zutaten = k.zutaten.map((z) => {
        const s = findeImSnapshot(snapshot, null, z.name);
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
