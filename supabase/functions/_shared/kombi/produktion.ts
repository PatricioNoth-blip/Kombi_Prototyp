// Produktion: Komponenten und Komplettgerichte vorkochen – prüfen, vorausrechnen, empfehlen.
//
// Hier wird nichts gebucht. produzieren() in der Datenbank entnimmt die Eingänge, berechnet die
// Kosten aus den tatsächlich verwendeten Chargen und bucht die TATSÄCHLICHE Menge als neue Charge.
//
// Woher kennt Kombi ein Produktionsrezept? Nur aus echten Daten – nie erfunden:
//   • letzte Produktion derselben Sorte („wie beim letzten Mal“, mit Mengen)
//   • geplante Produktion (vom Nutzer eingetragen)
//   • hinterlegte Zusammensetzung der Sorte (nur Namen → Mengen bleiben offen)
import type { Art, Einheit, PreisStatus } from './typen.ts';
import type { ChargeInfo } from './chargen.ts';
import { kostenAusTeilen, simuliereEntnahme, type EntnahmeTeil } from './chargen.ts';
import { produktSchluessel } from './einkaufsliste.ts';
import { mengeText } from './mengen.ts';
import { euroText } from './kosten.ts';
import { normalisiere } from './text.ts';

export type ProduktSorte = {
  id: number;
  name: string;
  art: Art;
  einheit: Einheit;
  portion_menge: number;
  anzahl: number;
  abgelaufen: number;
  haltbar_tage: number;
  mindestbestand: number;
  bald_ablaufen: boolean;
  geoeffnet: number;
  zusammensetzung: string[] | null;
  farbe: string;
};

export type Eingang = { block_typ_id: number; menge: number };

export type ProduktionEintrag = {
  id: string;
  block_typ_id: number;
  status: 'geplant' | 'abgeschlossen' | 'rueckgaengig' | 'verworfen';
  zutaten: Eingang[];
  geplante_menge: number | null;
  menge: number | null;
  geplant_fuer: string | null;
  abgeschlossen_am: string | null;
  erstellt_am: string;
};

export type EingangStatus = 'ok' | 'zu_wenig' | 'leer' | 'unbekannt';

export type EingangPruefung = {
  block_typ_id: number;
  name: string;
  einheit: Einheit;
  menge: number;
  verfuegbar: number;
  status: EingangStatus;
  fehlt: number;
  /** voraussichtlicher Wert aus den Chargen, die entnommen würden (FIFO); null = unbekannt */
  wert_cent: number | null;
  kosten_status: PreisStatus;
  teile: EntnahmeTeil[];
};

export type ProduktionsPruefung = {
  eingaenge: EingangPruefung[];
  alles_da: boolean;
  fehlend: { block_typ_id: number; name: string; menge: number; einheit: Einheit }[];
  kosten: {
    cent: number | null;
    status: PreisStatus;
    pro_einheit_cent: number | null;
    /** Kostenherkunft je Eingang */
    herkunft: { name: string; cent: number | null }[];
  };
};

const verwendbar = (s: ProduktSorte) => Math.max(0, s.anzahl - Math.max(0, s.abgelaufen));

/**
 * Prüft eine geplante Produktion gegen den AKTUELLEN Bestand und rechnet die Kosten aus den
 * Chargen voraus, die produzieren() entnehmen würde. menge = geplante Ausbeute (für „pro Portion“).
 */
export function pruefeProduktion(
  eingaenge: Eingang[],
  menge: number,
  sorten: ProduktSorte[],
  chargen: ChargeInfo[],
): ProduktionsPruefung {
  // gleiche Sorte zweimal → zusammen prüfen (so bucht es auch die Datenbank)
  const summiert = new Map<number, number>();
  for (const e of eingaenge) if (e.menge > 0) summiert.set(e.block_typ_id, (summiert.get(e.block_typ_id) ?? 0) + e.menge);

  const geprueft: EingangPruefung[] = [...summiert].map(([id, m]) => {
    const s = sorten.find((x) => x.id === id);
    if (!s) {
      return { block_typ_id: id, name: 'Unbekannte Sorte', einheit: 'portion', menge: m, verfuegbar: 0, status: 'unbekannt', fehlt: m, wert_cent: null, kosten_status: 'unbekannt', teile: [] };
    }
    const da = verwendbar(s);
    const status: EingangStatus = da <= 0 ? 'leer' : da < m ? 'zu_wenig' : 'ok';
    // abgelaufene Chargen werden hier nicht eingeplant
    const sim = simuliereEntnahme(chargen.filter((c) => c.block_typ_id === id), s.haltbar_tage, Math.min(m, da));
    const k = kostenAusTeilen(sim.teile);
    return {
      block_typ_id: id, name: s.name, einheit: s.einheit, menge: m, verfuegbar: da, status, fehlt: Math.max(0, m - da),
      wert_cent: status === 'ok' ? k.cent : null, kosten_status: status === 'ok' ? k.status : 'unbekannt', teile: sim.teile,
    };
  });

  const fehlend = geprueft.filter((e) => e.fehlt > 0).map((e) => ({ block_typ_id: e.block_typ_id, name: e.name, menge: e.fehlt, einheit: e.einheit }));
  type Teil = Pick<EntnahmeTeil, 'wert_cent' | 'kosten_status'>;
  const teile = geprueft.flatMap((e): Teil[] => (e.status === 'ok' ? e.teile : [{ wert_cent: null, kosten_status: 'unbekannt' }]));
  const k = kostenAusTeilen(teile);
  return {
    eingaenge: geprueft,
    alles_da: geprueft.length > 0 && fehlend.length === 0,
    fehlend,
    kosten: {
      cent: k.cent,
      status: k.status,
      pro_einheit_cent: k.cent !== null && menge > 0 ? k.cent / menge : null,
      herkunft: geprueft.map((e) => ({ name: e.name, cent: e.wert_cent })),
    },
  };
}

/** Mengen eines Rezepts auf eine andere Ausbeute umrechnen (g/ml runden, Stück/Portionen aufrunden). */
export function skaliere(eingaenge: Eingang[], von: number, auf: number, sorten: ProduktSorte[]): Eingang[] {
  if (von <= 0 || auf <= 0 || von === auf) return eingaenge.map((e) => ({ ...e }));
  const f = auf / von;
  return eingaenge.map((e) => {
    const einheit = sorten.find((s) => s.id === e.block_typ_id)?.einheit ?? 'g';
    const roh = e.menge * f;
    const menge = einheit === 'g' || einheit === 'ml' ? Math.round(roh) : Math.ceil(roh - 1e-9);
    return { block_typ_id: e.block_typ_id, menge: Math.max(1, menge) };
  });
}

/** Rezept „wie beim letzten Mal“: jüngste abgeschlossene Produktion der Sorte. */
export function letztesRezept(sorteId: number, produktionen: ProduktionEintrag[]): { eingaenge: Eingang[]; menge: number } | null {
  const letzte = produktionen
    .filter((p) => p.block_typ_id === sorteId && p.status === 'abgeschlossen' && p.zutaten.length > 0 && (p.menge ?? 0) > 0)
    .sort((a, b) => (b.abgeschlossen_am ?? '').localeCompare(a.abgeschlossen_am ?? ''))[0];
  return letzte ? { eingaenge: letzte.zutaten.map((z) => ({ ...z })), menge: letzte.menge as number } : null;
}

// ───────── Empfehlungen „Jetzt sinnvoll“ ─────────

export type ZutatVorhanden = { name: string; vorhanden: boolean; block_typ_id: number | null };

export type ProduktionsEmpfehlung = {
  block_typ_id: number;
  name: string;
  art: 'komponente' | 'komplettgericht';
  einheit: Einheit;
  /** geplante Ausbeute in der Einheit der Sorte; null = offen */
  menge: number | null;
  quelle: 'geplant' | 'letzte_produktion' | 'zusammensetzung';
  produktion_id: string | null;
  eingaenge: Eingang[];
  pruefung: ProduktionsPruefung | null;
  /** nur bei Quelle „zusammensetzung“: welche Bestandteile es im Bestand gibt (Mengen offen) */
  bestandteile: ZutatVorhanden[];
  status: 'alles_da' | 'fehlt_etwas' | 'mengen_offen';
  gruende: string[];
  punkte: number;
};

function findeNachName(name: string, sorten: ProduktSorte[]): ProduktSorte | null {
  const k = produktSchluessel(name);
  const n = normalisiere(name);
  return (
    sorten.find((s) => produktSchluessel(s.name) === k) ??
    sorten.find((s) => {
      const sk = produktSchluessel(s.name);
      return sk.length >= 4 && (sk.startsWith(k) || k.startsWith(sk) || normalisiere(s.name).includes(n));
    }) ??
    null
  );
}

/**
 * Was lohnt sich jetzt zu produzieren? Nur aus echten Daten:
 *   geplante Produktionen, letzte Produktionen (Rezept + Menge), hinterlegte Zusammensetzungen.
 * neuGekauft: Sorten aus einem gerade bestätigten Bon – Empfehlungen, die sie nutzen, kommen nach vorn.
 * Kombi schlägt nur vor. Produziert wird erst, wenn der Nutzer es bestätigt.
 */
export function produktionsEmpfehlungen(e: {
  sorten: ProduktSorte[];
  chargen: ChargeInfo[];
  produktionen: ProduktionEintrag[];
  neuGekauft?: number[];
}): ProduktionsEmpfehlung[] {
  const neu = new Set(e.neuGekauft ?? []);
  const ergebnis: ProduktionsEmpfehlung[] = [];
  const gesehen = new Set<number>();

  const bewerte = (s: ProduktSorte, basis: Omit<ProduktionsEmpfehlung, 'gruende' | 'punkte' | 'status' | 'name' | 'art' | 'einheit' | 'block_typ_id'>) => {
    const gruende: string[] = [];
    let punkte = 0;
    const p = basis.pruefung;
    const status: ProduktionsEmpfehlung['status'] = p ? (p.alles_da ? 'alles_da' : 'fehlt_etwas') : 'mengen_offen';
    if (basis.quelle === 'geplant') {
      punkte += 3;
      gruende.push('Geplant');
    }
    if (s.anzahl < s.mindestbestand) {
      punkte += 3;
      gruende.push(`Nur noch ${mengeText(s.anzahl, s.einheit)} da (Mindestbestand ${mengeText(s.mindestbestand, s.einheit)})`);
    } else if (s.anzahl === 0) {
      punkte += 1.5;
      gruende.push('Gerade nichts davon da');
    }
    if (status === 'alles_da') {
      punkte += 3;
      gruende.push('Alle Zutaten vorhanden');
    } else if (status === 'fehlt_etwas' && p) {
      punkte += 0.5;
      gruende.push(p.fehlend.length === 1 ? `Es fehlt: ${mengeText(p.fehlend[0].menge, p.fehlend[0].einheit)} ${p.fehlend[0].name}` : `${p.fehlend.length} Zutaten fehlen`);
    } else {
      const da = basis.bestandteile.filter((b) => b.vorhanden).length;
      punkte += basis.bestandteile.length ? (1.5 * da) / basis.bestandteile.length : 0;
      gruende.push(`${da} von ${basis.bestandteile.length} Zutaten da – Mengen noch offen`);
    }
    const ids = basis.eingaenge.length ? basis.eingaenge.map((x) => x.block_typ_id) : basis.bestandteile.map((b) => b.block_typ_id).filter((x): x is number => x !== null);
    const nutzt = e.sorten.filter((x) => ids.includes(x.id));
    const frisch = nutzt.filter((x) => neu.has(x.id));
    if (frisch.length) {
      punkte += 2 + frisch.length * 0.5;
      gruende.push(`Nutzt frisch gekaufte ${frisch.map((x) => x.name).join(', ')}`);
    }
    const retten = nutzt.filter((x) => x.bald_ablaufen || x.geoeffnet > 0);
    if (retten.length) {
      punkte += 2;
      gruende.push(`Verbraucht ${retten.map((x) => x.name).join(', ')} rechtzeitig`);
    }
    if (p && p.kosten.pro_einheit_cent !== null && p.kosten.status === 'berechnet' && s.einheit === 'portion') {
      gruende.push(`ca. ${euroText(p.kosten.pro_einheit_cent)} / Portion`);
    }
    ergebnis.push({
      ...basis,
      block_typ_id: s.id,
      name: s.name,
      art: s.art === 'komplettgericht' ? 'komplettgericht' : 'komponente',
      einheit: s.einheit,
      status,
      gruende,
      punkte: Math.round(punkte * 100) / 100,
    });
    gesehen.add(s.id);
  };

  const produzierbar = e.sorten.filter((s) => s.art === 'komponente' || s.art === 'komplettgericht');

  // 1. Geplante Produktionen
  for (const pr of e.produktionen.filter((x) => x.status === 'geplant')) {
    const s = produzierbar.find((x) => x.id === pr.block_typ_id);
    if (!s || gesehen.has(s.id)) continue;
    const menge = pr.geplante_menge ?? letztesRezept(s.id, e.produktionen)?.menge ?? null;
    bewerte(s, {
      menge, quelle: 'geplant', produktion_id: pr.id, eingaenge: pr.zutaten,
      pruefung: pr.zutaten.length ? pruefeProduktion(pr.zutaten, menge ?? 1, e.sorten, e.chargen) : null, bestandteile: [],
    });
  }
  // 2. Wie beim letzten Mal
  for (const s of produzierbar) {
    if (gesehen.has(s.id)) continue;
    const r = letztesRezept(s.id, e.produktionen);
    if (!r) continue;
    bewerte(s, { menge: r.menge, quelle: 'letzte_produktion', produktion_id: null, eingaenge: r.eingaenge, pruefung: pruefeProduktion(r.eingaenge, r.menge, e.sorten, e.chargen), bestandteile: [] });
  }
  // 3. Bekannte Zusammensetzung (nur Namen)
  for (const s of produzierbar) {
    if (gesehen.has(s.id) || !s.zusammensetzung?.length) continue;
    const bestandteile = s.zusammensetzung.map((name) => {
      const t = findeNachName(name, e.sorten.filter((x) => x.id !== s.id));
      return { name, vorhanden: !!t && verwendbar(t) > 0, block_typ_id: t?.id ?? null };
    });
    bewerte(s, { menge: null, quelle: 'zusammensetzung', produktion_id: null, eingaenge: [], pruefung: null, bestandteile });
  }

  return ergebnis.sort((a, b) => b.punkte - a.punkte || a.name.localeCompare(b.name, 'de'));
}

/** Nach einem Bon-Import: nur Empfehlungen, die frisch Gekauftes nutzen (höchstens n). */
export function empfehlungenNachEinkauf(e: Parameters<typeof produktionsEmpfehlungen>[0], n = 3): ProduktionsEmpfehlung[] {
  const neu = new Set(e.neuGekauft ?? []);
  return produktionsEmpfehlungen(e)
    .filter((x) => x.eingaenge.some((z) => neu.has(z.block_typ_id)) || x.bestandteile.some((b) => b.block_typ_id !== null && neu.has(b.block_typ_id)))
    .slice(0, n);
}

// ───────── Einkaufsliste für Fehlendes ─────────

export type EinkaufsEintragNeu = {
  name: string;
  schluessel: string;
  menge: number;
  einheit: Einheit;
  kategorie: string;
  quelle: 'komponente';
  grund: string;
  block_typ_id: number;
};

/** Fehlende Zutaten einer Produktion als Einträge für die Einkaufsliste (Tabelle einkauf_eintrag). */
export function fehlendeAufEinkaufsliste(p: ProduktionsPruefung, produktName: string, sorten: ProduktSorte[]): EinkaufsEintragNeu[] {
  return p.fehlend.map((f) => {
    const s = sorten.find((x) => x.id === f.block_typ_id);
    return {
      name: f.name.slice(0, 80),
      schluessel: produktSchluessel(f.name).slice(0, 80) || f.name.toLowerCase().slice(0, 80),
      menge: f.menge,
      einheit: f.einheit,
      kategorie: s?.farbe ?? 'sonstiges',
      quelle: 'komponente',
      grund: `Für ${produktName}`.slice(0, 200),
      block_typ_id: f.block_typ_id,
    };
  });
}

// ───────── Kostenherkunft einer abgeschlossenen Produktion ─────────

export type EingangZeile = { block_typ_id: number; menge: number; wert_cent: number | string | null; kosten_status: PreisStatus };

/** „TK-Pizza – 1,20 €/Portion: Teig 0,20 € · Tomaten-Basis 0,24 € …“ aus produktion_eingang. */
export function kostenHerkunft(zeilen: EingangZeile[], menge: number, sorten: { id: number; name: string; einheit: Einheit }[]) {
  const je = new Map<number, { name: string; menge: number; einheit: Einheit; cent: number | null; status: PreisStatus[] }>();
  for (const z of zeilen) {
    const s = sorten.find((x) => x.id === z.block_typ_id);
    const alt = je.get(z.block_typ_id) ?? { name: s?.name ?? 'Unbekannt', menge: 0, einheit: s?.einheit ?? 'portion', cent: 0, status: [] };
    const wert = z.wert_cent === null ? null : Number(z.wert_cent);
    alt.menge += z.menge;
    alt.cent = alt.cent === null || wert === null ? null : alt.cent + wert;
    alt.status.push(z.kosten_status);
    je.set(z.block_typ_id, alt);
  }
  const posten = [...je.values()].map((x) => ({
    name: x.name,
    menge: x.menge,
    einheit: x.einheit,
    cent: x.cent,
    status: (x.cent === null ? 'unbekannt' : x.status.every((st) => st === 'berechnet') ? 'berechnet' : 'teilweise') as PreisStatus,
  }));
  const gesamt = kostenAusTeilen(zeilen.map((z) => ({ wert_cent: z.wert_cent === null ? null : Number(z.wert_cent), kosten_status: z.kosten_status })));
  return { posten, gesamt, pro_einheit_cent: gesamt.cent !== null && menge > 0 ? gesamt.cent / menge : null };
}
