// Einkaufsliste als verbindendes System:
//   geplante Mahlzeiten + vorgemerkte Komponenten + eigene Einträge  →  Bedarf
//   Bedarf − verwendbarer Vorrat (jede Menge nur EINMAL angerechnet)  →  Einkauf
//
// Regeln:
//   • Pläne bekommen den Vorrat in ihrer Reihenfolge (Datum, dann flexibel nach Anlage).
//     Was ein Plan reserviert, steht keinem anderen mehr zur Verfügung.
//   • Abgelaufenes zählt nicht als verwendbar; Geöffnetes schon.
//   • Gleiche Produkte werden zusammengeführt (gleicher Produktschlüssel + gleiche Einheit).
//   • Eigene Einträge (von Hand, Notfall, Mangel …) werden nicht gegen den Vorrat gerechnet:
//     Sie sind ausdrücklich zusätzlich gewünscht.
//   • Preise nur aus bekannten Daten: gespeicherter Preis „X € für N“ = eine Packung.
//     Gekauft werden ganze Packungen – es wird kein Preis für genau 450 g erfunden.
//   • Hier wird nichts gebucht. Einkauf → Vorrat läuft über einkauf_buchen() in der Datenbank.
import type { Art, Einheit, Farbe, Herkunft, Lagerort } from './typen.ts';
import { mengeText } from './mengen.ts';
import { summiereKosten } from './kosten.ts';
import { normalisiere } from './text.ts';

export type VorratSorte = {
  id: number;
  name: string;
  farbe: Farbe;
  art: Art;
  einheit: Einheit;
  portion_menge: number;
  groesse_g: number;
  anzahl: number;
  abgelaufen: number;
  kosten_cent: number | null;
  kosten_menge: number;
  mindestbestand: number;
  lagerort: Lagerort;
  /** gekauft/selbstgemacht – unbekannt, wenn nicht angegeben */
  herkunft?: Herkunft | null;
};

/** Eine benötigte Menge. menge null = Menge unbekannt („Menge offen“). */
export type Bedarf = { name: string; block_typ_id: number | null; menge: number | null; einheit: Einheit | null };

export type PlanBedarf = {
  id: string;
  art: 'mahlzeit' | 'komponente';
  titel: string;
  datum: string | null;
  erstellt_am: string;
  bedarf: Bedarf[];
};

export type ListenEintrag = {
  id: number;
  name: string;
  schluessel: string;
  menge: number | null;
  einheit: Einheit | null;
  kategorie: Farbe | 'sonstiges';
  quelle: 'manuell' | 'rezept' | 'komponente' | 'notfall' | 'mangel';
  grund: string | null;
  block_typ_id: number | null;
};

export type ZeilenStatus = { schluessel: string; einheit: string; status: 'gekauft' | 'zurueckgestellt' | 'ignoriert' };

export type Quelle = {
  art: 'mahlzeit' | 'komponente' | ListenEintrag['quelle'];
  titel: string;
  menge: number | null;
};

export type Einkaufszeile = {
  /** Produktschlüssel + Einheit = eine Zeile */
  schluessel: string;
  einheit: Einheit | null;
  /** Einheit für den Zeilenstatus ('offen', wenn die Menge unbekannt ist) */
  einheit_schluessel: string;
  name: string;
  /** zu kaufende Menge (Summe der bekannten); null = nur unbekannte Mengen */
  menge: number | null;
  /** mindestens ein Teil der Menge ist unbekannt */
  menge_offen: boolean;
  kategorie: Farbe | 'sonstiges';
  quellen: Quelle[];
  /** Bruttobedarf aus Plänen und wie viel davon der Vorrat deckt */
  bedarf_plaene: number | null;
  vom_vorrat: number;
  sorte: VorratSorte | null;
  preis: { packungen: number; cent: number; text: string } | null;
  status: 'offen' | 'gekauft' | 'zurueckgestellt' | 'ignoriert';
  eintrag_ids: number[];
};

export type PlanStand = {
  name: string;
  block_typ_id: number | null;
  einheit: Einheit | null;
  benoetigt: number | null;
  reserviert: number;
  fehlt: number | null;
};

export type Verteilung = {
  /** reservierte Menge je Sorte (in der Einheit der Sorte) */
  reserviert: Map<number, number>;
  /** noch frei je Sorte */
  frei: Map<number, number>;
  pro_plan: Map<string, PlanStand[]>;
};

// ───────── Produkte erkennen ─────────

const FUELLWOERTER = /\b(tk|dose|dosen|glas|packung|frisch|frische|frischer|bio)\b/g;

/** „Zwiebeln“, „Zwiebel“, „TK-Zwiebeln (Beutel)“ → „zwiebel“ – zum Zusammenführen gleicher Produkte. */
export function produktSchluessel(name: string): string {
  const ohneKlammer = name.replace(/\([^)]*\)/g, ' ');
  const woerter = normalisiere(ohneKlammer)
    .replace(FUELLWOERTER, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      if (w.length > 5 && w.endsWith('en')) return w.slice(0, -1); // tomaten → tomate, linsen → linse
      if (w.length > 5 && w.endsWith('ln')) return w.slice(0, -1); // zwiebeln → zwiebel, nudeln → nudel
      if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1); // wraps → wrap
      return w;
    });
  return woerter.join(' ') || normalisiere(name) || name.trim().toLowerCase();
}

export function findeSorte(b: { name: string; block_typ_id: number | null }, sorten: VorratSorte[]): VorratSorte | null {
  if (b.block_typ_id !== null) {
    const s = sorten.find((x) => x.id === b.block_typ_id);
    if (s) return s;
  }
  const k = produktSchluessel(b.name);
  return sorten.find((s) => produktSchluessel(s.name) === k) ?? null;
}

/** Menge in die Einheit der Sorte umrechnen; null = nicht umrechenbar. */
export function inSorteneinheit(menge: number, einheit: Einheit | null, s: VorratSorte): number | null {
  const von = einheit ?? s.einheit;
  if (von === s.einheit) return menge;
  if (von === 'portion') return Math.round(menge * s.portion_menge);
  if (s.einheit === 'portion' && von === 'g' && s.groesse_g > 0) return Math.ceil(menge / s.groesse_g);
  return null;
}

export const verwendbar = (s: VorratSorte) => Math.max(0, s.anzahl - Math.max(0, s.abgelaufen));

const KATEGORIEN: [Farbe, RegExp][] = [
  ['blau', /pizza|lasagne|fertiggericht/],
  ['rot', /sosse|sauce|passata|tomatenmark|gehackte tomate|pesto|kokosmilch|bruehe|basis/],
  ['braun', /linse|bohne|kichererbse|tofu|tempeh|\bei\b|eier|haehnchen|hack|fleisch|fisch|lachs|thunfisch|falafel|seitan|patty/],
  ['gelb', /pasta|nudel|spaghetti|penne|reis|brot|broetchen|wrap|tortilla|kartoffel|couscous|bulgur|hafer|mehl|gnocchi/],
  ['gruen', /tomate|zwiebel|paprika|zucchin|spinat|brokkoli|karott|moehre|gurke|salat|pilz|champignon|lauch|knoblauch|ingwer|avocado|mais|erbse|kohl|aubergin|kuerbis|apfel|banane|zitron|limett|gemuese|sellerie/],
  ['weiss', /gewuerz|kreuzkuemmel|curry|paprikapulver|oregano|salz|pfeffer|zimt|kurkuma|chili|senf|essig|oel|soja|booster/],
  ['schwarz', /nuss|nuesse|kerne|sesam|kraeuter|petersilie|koriander|basilikum|schnittlauch|kaese|feta|joghurt/],
];

/** Kategorie für die Einkaufsliste: aus der Sorte, sonst nach typischen Wörtern, sonst „sonstiges“. */
export function kategorieFuer(name: string, sorte?: VorratSorte | null): Farbe | 'sonstiges' {
  if (sorte) return sorte.farbe;
  const n = normalisiere(name);
  return KATEGORIEN.find(([, re]) => re.test(n))?.[0] ?? 'sonstiges';
}

// ───────── Vorrat auf Pläne verteilen ─────────

const planReihenfolge = (a: PlanBedarf, b: PlanBedarf) =>
  (a.datum ?? '9999-12-31').localeCompare(b.datum ?? '9999-12-31') || a.erstellt_am.localeCompare(b.erstellt_am);

type Fehlend = { plan: PlanBedarf; bedarf: Bedarf; sorte: VorratSorte | null; menge: number | null; einheit: Einheit | null };

function verteileIntern(plaene: PlanBedarf[], sorten: VorratSorte[]) {
  const frei = new Map(sorten.map((s) => [s.id, verwendbar(s)]));
  const reserviert = new Map<number, number>();
  const brutto = new Map<number, number>();
  const proPlan = new Map<string, PlanStand[]>();
  const fehlend: Fehlend[] = [];

  for (const plan of [...plaene].sort(planReihenfolge)) {
    const stand: PlanStand[] = [];
    for (const b of plan.bedarf) {
      const sorte = findeSorte(b, sorten);
      const menge = sorte && b.menge !== null ? inSorteneinheit(b.menge, b.einheit, sorte) : null;

      if (sorte && b.menge !== null && menge === null) {
        // Einheit passt nicht zur Sorte (z. B. Stück ↔ g) → nicht verrechenbar, ehrlich als Bedarf.
        fehlend.push({ plan, bedarf: b, sorte: null, menge: b.menge, einheit: b.einheit });
        stand.push({ name: b.name, block_typ_id: sorte.id, einheit: b.einheit, benoetigt: b.menge, reserviert: 0, fehlt: b.menge });
        continue;
      }
      if (!sorte) {
        fehlend.push({ plan, bedarf: b, sorte: null, menge: b.menge, einheit: b.einheit });
        stand.push({ name: b.name, block_typ_id: null, einheit: b.einheit, benoetigt: b.menge, reserviert: 0, fehlt: b.menge });
        continue;
      }
      const da = frei.get(sorte.id) ?? 0;
      if (menge === null) {
        // Menge unbekannt: Ist etwas frei, gilt es als gedeckt – sonst fehlt es (Menge offen).
        if (da <= 0) fehlend.push({ plan, bedarf: b, sorte, menge: null, einheit: sorte.einheit });
        stand.push({ name: sorte.name, block_typ_id: sorte.id, einheit: sorte.einheit, benoetigt: null, reserviert: 0, fehlt: da > 0 ? 0 : null });
        continue;
      }
      const nimm = Math.min(menge, da);
      frei.set(sorte.id, da - nimm);
      reserviert.set(sorte.id, (reserviert.get(sorte.id) ?? 0) + nimm);
      brutto.set(sorte.id, (brutto.get(sorte.id) ?? 0) + menge);
      const rest = menge - nimm;
      if (rest > 0) fehlend.push({ plan, bedarf: b, sorte, menge: rest, einheit: sorte.einheit });
      stand.push({ name: sorte.name, block_typ_id: sorte.id, einheit: sorte.einheit, benoetigt: menge, reserviert: nimm, fehlt: rest });
    }
    proPlan.set(plan.id, stand);
  }
  return { frei, reserviert, brutto, proPlan, fehlend };
}

/** Welche Pläne welchen Vorrat reservieren – jede Menge nur einmal. */
export function verteile(plaene: PlanBedarf[], sorten: VorratSorte[]): Verteilung {
  const v = verteileIntern(plaene, sorten);
  return { reserviert: v.reserviert, frei: v.frei, pro_plan: v.proPlan };
}

// ───────── Preise ─────────

/** Kaufpreis in ganzen Packungen (gespeicherter Preis „X € für N“ = eine Packung). */
export function packungspreis(menge: number | null, sorte: VorratSorte | null): Einkaufszeile['preis'] {
  if (!sorte || sorte.kosten_cent === null || menge === null || menge <= 0) return null;
  const packung = Math.max(1, sorte.kosten_menge);
  const packungen = Math.ceil(menge / packung - 1e-9);
  return {
    packungen,
    cent: packungen * sorte.kosten_cent,
    text: packung === 1 ? mengeText(packungen, sorte.einheit) : `${packungen} × ${mengeText(packung, sorte.einheit)}`,
  };
}

// ───────── Die Liste ─────────

export type Einkaufsliste = {
  zeilen: Einkaufszeile[];
  /** Kosten der offenen und abgehakten Zeilen – nur aus bekannten Preisen */
  kosten: { bekannt_cent: number | null; unbekannt: number; status: 'berechnet' | 'teilweise' | 'unbekannt' | 'leer' };
  verteilung: Verteilung;
};

const REIHENFOLGE: (Farbe | 'sonstiges')[] = ['gruen', 'braun', 'gelb', 'rot', 'schwarz', 'weiss', 'blau', 'sonstiges'];

export function berechneEinkaufsliste(e: {
  sorten: VorratSorte[];
  plaene: PlanBedarf[];
  eintraege: ListenEintrag[];
  status: ZeilenStatus[];
}): Einkaufsliste {
  const v = verteileIntern(e.plaene, e.sorten);
  const zeilen = new Map<string, Einkaufszeile>();

  const zeile = (name: string, sorte: VorratSorte | null, einheit: Einheit | null, kategorie?: Farbe | 'sonstiges') => {
    const schluessel = produktSchluessel(sorte?.name ?? name);
    const key = `${schluessel}|${einheit ?? 'offen'}`;
    let z = zeilen.get(key);
    if (!z) {
      z = {
        schluessel, einheit, einheit_schluessel: einheit ?? 'offen', name: sorte?.name ?? name, menge: null, menge_offen: false,
        kategorie: kategorie && kategorie !== 'sonstiges' ? kategorie : kategorieFuer(name, sorte),
        quellen: [], bedarf_plaene: null, vom_vorrat: 0, sorte, preis: null,
        status: 'offen', eintrag_ids: [],
      };
      zeilen.set(key, z);
    }
    return z;
  };
  const addiere = (z: Einkaufszeile, menge: number | null) => {
    if (menge === null) z.menge_offen = true;
    else z.menge = (z.menge ?? 0) + menge;
  };

  for (const f of v.fehlend) {
    const z = zeile(f.bedarf.name, f.sorte, f.einheit);
    addiere(z, f.menge);
    z.quellen.push({ art: f.plan.art, titel: f.plan.titel, menge: f.menge });
    if (f.sorte) {
      z.bedarf_plaene = v.brutto.get(f.sorte.id) ?? null;
      z.vom_vorrat = v.reserviert.get(f.sorte.id) ?? 0;
    }
  }

  for (const eintrag of e.eintraege) {
    const sorte = findeSorte({ name: eintrag.name, block_typ_id: eintrag.block_typ_id }, e.sorten);
    const umgerechnet = sorte && eintrag.menge !== null ? inSorteneinheit(eintrag.menge, eintrag.einheit, sorte) : null;
    const passt = sorte && (eintrag.menge === null || umgerechnet !== null);
    const z = passt
      ? zeile(eintrag.name, sorte, sorte!.einheit)
      : zeile(eintrag.name, null, eintrag.einheit, eintrag.kategorie);
    addiere(z, passt ? umgerechnet : eintrag.menge);
    z.quellen.push({ art: eintrag.quelle, titel: eintrag.grund ?? 'von Hand', menge: eintrag.menge });
    z.eintrag_ids.push(eintrag.id);
  }

  for (const z of zeilen.values()) {
    const s = e.status.find((x) => x.schluessel === z.schluessel && x.einheit === z.einheit_schluessel);
    if (s) z.status = s.status;
    z.preis = z.menge_offen ? null : packungspreis(z.menge, z.sorte);
  }

  const liste = [...zeilen.values()].sort(
    (a, b) => REIHENFOLGE.indexOf(a.kategorie) - REIHENFOLGE.indexOf(b.kategorie) || a.name.localeCompare(b.name, 'de'),
  );
  const aktiv = liste.filter((z) => z.status === 'offen' || z.status === 'gekauft');
  const k = summiereKosten(aktiv.map((z) => ({ name: z.name, cent: z.preis?.cent ?? null })), 1);
  return {
    zeilen: liste,
    kosten: {
      bekannt_cent: k.gesamt_cent,
      unbekannt: k.unbekannt.length,
      status: aktiv.length === 0 ? 'leer' : k.status,
    },
    verteilung: { reserviert: v.reserviert, frei: v.frei, pro_plan: v.proPlan },
  };
}

/** Sorten unter Mindestbestand, die noch nicht auf der Liste stehen: kaufen (Zutaten) oder nachkochen. */
export function mangelVorschlaege(sorten: VorratSorte[], zeilen: Einkaufszeile[]): { sorte: VorratSorte; menge: number; aktion: 'kaufen' | 'nachkochen' }[] {
  const aufListe = new Set(zeilen.filter((z) => z.status !== 'ignoriert').map((z) => z.schluessel));
  return sorten
    .filter((s) => s.mindestbestand > 0 && s.anzahl < s.mindestbestand && !aufListe.has(produktSchluessel(s.name)))
    .map((s) => ({ sorte: s, menge: s.mindestbestand - s.anzahl, aktion: s.art === 'zutat' ? 'kaufen' as const : 'nachkochen' as const }));
}

// ───────── Eingabe von Hand ─────────

/**
 * „500 g Zwiebeln“, „2 Paprika“, „1,5 kg Kartoffeln“, „Basilikum“ → Name, Menge, Einheit.
 * kg/l werden in g/ml umgerechnet. Ohne Zahl bleibt die Menge offen (null).
 */
export function leseEingabe(text: string): { name: string; menge: number | null; einheit: Einheit | null } {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = /^(\d+(?:[.,]\d+)?)\s*(kg|g|gramm|l|liter|ml|stk\.?|stück|stueck|x|×|portionen|portion|port\.?)?\s+(.+)$/i.exec(t);
  if (!m) return { name: t.slice(0, 80), menge: null, einheit: null };
  const zahl = Number(m[1].replace(',', '.'));
  const e = (m[2] ?? '').toLowerCase().replace('.', '');
  const name = m[3].trim().slice(0, 80);
  const ganz = (n: number) => Math.max(1, Math.round(n));
  if (e === 'kg') return { name, menge: ganz(zahl * 1000), einheit: 'g' };
  if (e === 'g' || e === 'gramm') return { name, menge: ganz(zahl), einheit: 'g' };
  if (e === 'l' || e === 'liter') return { name, menge: ganz(zahl * 1000), einheit: 'ml' };
  if (e === 'ml') return { name, menge: ganz(zahl), einheit: 'ml' };
  if (e.startsWith('port')) return { name, menge: ganz(zahl), einheit: 'portion' };
  return { name, menge: ganz(zahl), einheit: 'stueck' };
}
