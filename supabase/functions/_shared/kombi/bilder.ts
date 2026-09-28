// Bildsystem: Welches Bild zeigt ein Gericht, eine Komponente oder eine Zutat?
//
//   EIGENES/GEPRÜFTES BILD → ECHT GEFUNDENES BILD → GENERIERTES BILD → LOKALES FALLBACK → KEIN BILD
//
// Grundsätze:
//   • Die KI liefert höchstens eine BILDANFORDERUNG (Suchbegriff, Stil, Format) – nie eine URL.
//     Sie behauptet nie, ein Bild gefunden zu haben. Ihr Suchbegriff wird wie ihre Texte geprüft:
//     Nennt er etwas, das nicht im Gericht steckt („steak“ bei einer Gurken-Bowl), wird er verworfen.
//   • Suchbegriff und Bildbeschreibung für eine Generierung entstehen aus den STRUKTURIERTEN
//     Rezeptdaten (verwendete Sorten, bekannte Zusammensetzung, Gerichtstyp).
//   • Eine URL wird nur gezeigt, wenn sie https ist und – für gefundene/generierte Bilder – von
//     einer bekannten, dauerhaften Quelle stammt (Wikimedia Commons, eigener Supabase-Speicher).
//   • Ein gefundenes Foto passt nur, wenn seine Beschreibung das Gesuchte nennt und keine Zutaten
//     zeigt, die nicht im Gericht sind. Lieber das lokale Bild als ein falsches Foto.
//   • Bilder sind Illustration: Mengen, Preise, Inhalte kommen nie aus einem Bild.
import type { Gericht, Gerichtstyp, KomponentenVorschlag } from './typen.ts';
import { englischeZutaten, gedeckteZutaten, zutatFuer, zutatMitId } from './zutaten.ts';
import { flach, ungedeckt, deckungstext } from './wahrheit.ts';
import { kuerze, normalisiere } from './text.ts';

export type BildQuelle = 'eigen' | 'gefunden' | 'generiert' | 'lokal' | 'keins';
export type BildStatus = 'ok' | 'ausstehend' | 'fehler' | 'fehlt';
export const BILD_PRIORITAET: readonly BildQuelle[] = ['eigen', 'gefunden', 'generiert', 'lokal', 'keins'];
export const SEITENVERHAELTNISSE = ['4:3', '1:1', '3:2', '16:9'] as const;
export type Seitenverhaeltnis = (typeof SEITENVERHAELTNISSE)[number];

/** Ein gespeichertes Bild (Spalten image_* der Sorte bzw. eine Zeile im Bild-Cache). */
export type BildDaten = {
  image_url: string | null;
  image_source: BildQuelle;
  image_status: BildStatus;
  image_query: string | null;
  image_alt: string | null;
  image_generated: boolean;
  image_updated_at: string | null;
  /** Lizenz- und Quelleninformation, soweit bekannt (bei gefundenen Bildern Pflicht) */
  lizenz: string | null;
  urheber: string | null;
  quelle_seite: string | null;
};

/** Was für ein Bild gebraucht wird – von der Software gebaut, nicht von der KI. */
export type BildAnfrage = {
  /** Cache-Schlüssel: gleicher Inhalt → dasselbe Bild, es wird nicht erneut gesucht/generiert */
  schluessel: string;
  art: 'gericht' | 'komponente' | 'zutat';
  /** kurzer Suchbegriff (englisch – so findet die Bildsuche am meisten) */
  suchbegriff: string;
  /** Pflichtwörter: mindestens `mindestens` davon müssen in der Beschreibung eines gefundenen Fotos stehen */
  pflicht: string[];
  mindestens: number;
  /** semantische Zutaten, die das Bild zeigen darf (alles andere macht ein Foto unpassend) */
  erlaubt: string[];
  /** Was das Bild zeigt – nur Katalog-Zutaten (ids) und kurze Namen; daraus entsteht die Beschreibung */
  motiv: BildMotiv;
  /** Beschreibung für eine Bildgenerierung – nur aus dem Motiv gebaut (die Edge Function baut sie neu) */
  prompt: string;
  stil: string;
  format: Seitenverhaeltnis;
  /** Alternativtext (deutsch) */
  alt: string;
  /** Herkunft des Suchbegriffs: geprüfter KI-Vorschlag oder aus den Daten gebaut */
  begriff_von: 'ki' | 'software';
  /** Grund, falls die Bildanforderung der KI verworfen wurde (für Benchmark und Tests) */
  ki_verworfen: string | null;
};

/**
 * Motiv einer Bildgenerierung: was (Gerichtstyp/Lebensmittel, englisch), welche bekannten Zutaten
 * (Katalog-ids) und welche Bestandteile unbekannten Inhalts (Namen, max. 3). Mehr nicht – so kann
 * über die öffentliche Funktion kein beliebiges Bild erzeugt werden.
 */
export type BildMotiv = { was: string; zutaten: string[]; unbekannt: string[] };

/** Rohform der KI (ungeprüft!) – Schlüssel wie im KI-Vertrag. */
export type RohBildAnfrage = { needed?: unknown; query?: unknown; style?: unknown; aspect_ratio?: unknown };

export const STANDARD_STIL = 'appetizing food photography';
const STILE = ['appetizing food photography', 'rustic food photography', 'bright food photography', 'overhead food photography'];

// ───────── URLs ─────────

/** Dauerhafte Quellen für gefundene und generierte Bilder. */
const VERTRAUT = [
  /^https:\/\/upload\.wikimedia\.org\//,
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\//,
];

/**
 * Nur Bild-URLs, die sicher gezeigt werden dürfen: https, keine Zugangsdaten, keine Leerzeichen,
 * begrenzte Länge. Gefundene und generierte Bilder zusätzlich nur von vertrauten Hosts
 * (keine zufälligen Hotlinks); eigene Bilder darf der Haushalt von jedem https-Host eintragen.
 */
export function sichereBildUrl(url: unknown, quelle: BildQuelle): string | null {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (u.length < 12 || u.length > 2000 || /\s/.test(u)) return null;
  let p: URL;
  try {
    p = new URL(u);
  } catch {
    return null;
  }
  if (p.protocol !== 'https:' || p.username || p.password) return null;
  if (quelle === 'gefunden' || quelle === 'generiert') return VERTRAUT.some((re) => re.test(u)) ? u : null;
  return quelle === 'eigen' ? u : null;
}

// ───────── Auswahl nach Priorität ─────────

export type GewaehltesBild =
  | { art: 'url'; quelle: 'eigen' | 'gefunden' | 'generiert'; url: string; daten: BildDaten }
  | { art: 'lokal'; quelle: 'lokal' }
  | { art: 'keins'; quelle: 'keins' };

/**
 * Wählt das beste verfügbare Bild: eigenes → gefundenes → generiertes → lokales Fallback → keins.
 * Kaputte (Status „fehler“), ausstehende und unsichere Einträge werden übersprungen.
 */
export function waehleBild(kandidaten: (BildDaten | null | undefined)[], lokalVorhanden: boolean): GewaehltesBild {
  const brauchbar = kandidaten
    .filter((b): b is BildDaten => !!b && b.image_status === 'ok')
    .map((b) => ({ b, url: sichereBildUrl(b.image_url, b.image_source) }))
    .filter((x): x is { b: BildDaten; url: string } => x.url !== null)
    .sort((x, y) => BILD_PRIORITAET.indexOf(x.b.image_source) - BILD_PRIORITAET.indexOf(y.b.image_source));
  const erstes = brauchbar[0];
  if (erstes && (erstes.b.image_source === 'eigen' || erstes.b.image_source === 'gefunden' || erstes.b.image_source === 'generiert')) {
    return { art: 'url', quelle: erstes.b.image_source, url: erstes.url, daten: erstes.b };
  }
  return lokalVorhanden ? { art: 'lokal', quelle: 'lokal' } : { art: 'keins', quelle: 'keins' };
}

/** Neuester brauchbarer Eintrag je Schlüssel (der Cache behält alte Einträge, löscht nie). */
export function neuestesJeSchluessel<T extends BildDaten & { schluessel: string }>(zeilen: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const z of [...zeilen].sort((a, b) => (b.image_updated_at ?? '').localeCompare(a.image_updated_at ?? ''))) {
    if (!m.has(z.schluessel)) m.set(z.schluessel, z);
  }
  return m;
}

// ───────── Bildanforderung aus strukturierten Daten ─────────

const TYP_EN: Record<Gerichtstyp, string> = {
  pasta: 'pasta dish', curry: 'curry', wrap: 'wrap', pfanne: 'skillet dish', suppe: 'soup', eintopf: 'stew', bowl: 'bowl',
  toast: 'open sandwich', reisgericht: 'rice dish', auflauf: 'casserole', salat: 'salad', pizza: 'pizza', burger: 'burger',
  snack: 'snack plate', aufwaermen: 'dish', sonstiges: 'dish',
};
/** Gerichtstyp-Wörter sind keine Zutaten („bean burger“ zeigt kein Hackfleisch, „wrap“ gehört zum Wrap). */
const TYP_ZUTATEN: Partial<Record<Gerichtstyp, string[]>> = {
  wrap: ['wraps'], toast: ['toast', 'brot'], burger: ['broetchen'], pizza: [], pasta: ['pasta'], reisgericht: ['reis'],
};

/** Nur Wörter aus Buchstaben (keine Ziffern, keine Zeichen) – so besteht jede Anfrage die Prüfung der Function. */
export function woerter(text: string, max = 8): string[] {
  return text.toLowerCase().replace(/[^a-zäöüß-]+/g, ' ').split(' ').map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= 2 && w.length <= 24).slice(0, max);
}

/** Stabiler Schlüssel aus Art, Typ und Inhalt – unabhängig vom (kreativen) Namen. */
export function bildSchluessel(art: BildAnfrage['art'], typ: string, inhalt: string[]): string {
  const teile = [...new Set(inhalt.map((x) => normalisiere(x).replace(/ /g, '-')).filter(Boolean))].sort().slice(0, 6);
  return `${art}:${normalisiere(typ).replace(/ /g, '-') || 'x'}:${teile.join('+') || 'leer'}`.slice(0, 200).replace(/[+-]+$/, '');
}

type Inhalt = { name: string; zusammensetzung: string[] | null; zutat_id?: string | null };

/** Englische Begriffe der Hauptzutaten (nur bekannte – Unbekanntes wird nicht übersetzt oder geraten). */
function englisch(inhalt: Inhalt[]): { begriffe: string[]; ids: string[]; unbekannt: string[] } {
  const begriffe: string[] = [];
  const ids: string[] = [];
  const unbekannt: string[] = [];
  for (const x of inhalt) {
    const z = zutatFuer(x.name, x.zutat_id);
    if (z) {
      if (!ids.includes(z.id)) {
        ids.push(z.id);
        begriffe.push(z.en);
      }
    } else {
      unbekannt.push(x.name);
    }
  }
  return { begriffe, ids, unbekannt };
}

/**
 * Bildbeschreibung für eine Generierung: nur, was wirklich drin ist. Bei unbekannter
 * Zusammensetzung wird nichts ergänzt („contents not specified“ statt „salami pizza“).
 */
export function bildPrompt(m: BildMotiv, stil: string = STANDARD_STIL): string {
  const zutaten = m.zutaten.map((id) => zutatMitId(id)?.en).filter((x): x is string => !!x);
  const teile = [`${STILE.includes(stil) ? stil : STANDARD_STIL} of ${m.was}`];
  if (zutaten.length) teile.push(`made only with: ${zutaten.join(', ')}`);
  if (m.unbekannt.length) teile.push(`contents of ${m.unbekannt.join(', ')} not specified - do not add visible toppings or fillings`);
  teile.push('no other foods, no meat or fish unless listed, no text, no logos, no hands, natural light, ceramic plate');
  return kuerze(teile.join('. '), 600);
}

/** Motiv für die Generierung – englische Wörter und kurze Namen, Länge begrenzt. */
function motiv(was: string, zutatenIds: string[], unbekannt: string[]): BildMotiv {
  return {
    was: kuerze(was.toLowerCase().replace(/[^a-zäöüß\s-]/g, ' ').replace(/\s+/g, ' ').trim(), 40) || 'dish',
    zutaten: [...new Set(zutatenIds.filter((id) => zutatMitId(id)))].slice(0, 8),
    unbekannt: unbekannt.map((u) => kuerze(u.replace(/[^\p{L}\s-]/gu, ' ').replace(/\s+/g, ' ').trim(), 40)).filter(Boolean).slice(0, 3),
  };
}

/**
 * Prüft die Bildanforderung der KI. Erlaubt: 1–8 englische oder deutsche Wörter, keine URL,
 * keine Zutat außerhalb des Gerichts. Liefert den sauberen Begriff oder den Grund der Ablehnung.
 */
export function pruefeBildAnfrage(
  roh: RohBildAnfrage | null | undefined, erlaubt: Set<string>, deckungDe: string,
): { begriff: string | null; stil: string; format: Seitenverhaeltnis; grund: string | null } {
  const format = SEITENVERHAELTNISSE.find((f) => f === roh?.aspect_ratio) ?? '4:3';
  const stilRoh = typeof roh?.style === 'string' ? roh.style.toLowerCase().trim() : '';
  const stil = STILE.find((s) => s === stilRoh) ?? STANDARD_STIL;
  if (!roh || typeof roh !== 'object') return { begriff: null, stil, format, grund: 'keine Bildanforderung' };
  if (roh.needed === false) return { begriff: null, stil, format, grund: 'kein Bild angefordert' };
  if (typeof roh.query !== 'string' || !roh.query.trim()) return { begriff: null, stil, format, grund: 'Suchbegriff fehlt' };
  const q = roh.query.trim();
  if (/https?:|www\.|\.(com|org|net|de|jpg|jpeg|png|webp)\b|\//i.test(q)) return { begriff: null, stil, format, grund: 'enthält eine URL – Bildquellen erfindet die KI nicht' };
  const sauber = q.toLowerCase().replace(/[^a-zäöüß\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const woerter = sauber.split(' ').filter(Boolean);
  if (woerter.length === 0 || woerter.length > 8 || sauber.length > 80) return { begriff: null, stil, format, grund: 'Suchbegriff zu lang oder leer' };
  const fremdEn = englischeZutaten(sauber).filter((id) => !erlaubt.has(id));
  const fremdDe = ungedeckt(sauber, deckungDe);
  if (fremdEn.length || fremdDe.length) {
    return { begriff: null, stil, format, grund: `nennt ${[...fremdEn, ...fremdDe].join(', ')} – ist aber nicht im Gericht` };
  }
  return { begriff: sauber, stil, format, grund: null };
}

/** Bildanforderung für ein geprüftes Gericht (KI-Vorschlag nur, wenn er die Prüfung besteht). */
export function bildAnfrageFuerGericht(
  g: Pick<Gericht, 'name' | 'zutaten' | 'fehlt' | 'eigenschaften' | 'gerichtsart'>,
  roh?: RohBildAnfrage | null,
): BildAnfrage {
  const echte = g.zutaten.filter((z) => z.quelle !== 'grundausstattung');
  const typ = g.eigenschaften.gerichtstyp;
  // Ein Komplettgericht pur: das Gericht selbst (Zusammensetzung meist unbekannt → nichts ergänzen)
  const komplett = g.gerichtsart === 'komplett' ? echte.filter((z) => z.art === 'komplettgericht') : [];
  const inhalt: Inhalt[] = echte.map((z) => ({ name: z.name, zusammensetzung: z.zusammensetzung }));
  const bekannt = echte.flatMap((z) => (z.zusammensetzung ?? []).map((n) => ({ name: n, zusammensetzung: null })));
  const en = englisch([...inhalt, ...bekannt]);
  // Unbekannter Inhalt: Komplettgerichte und Komponenten ohne Zusammensetzung, deren Art nicht
  // schon aus dem Namen klar ist (Gewürz-Booster sind im Bild ohnehin nicht zu sehen).
  const unbekannt = echte
    .filter((z) => z.art !== 'zutat' && z.zusammensetzung === null && z.farbe !== 'weiss')
    .filter((z) => z.art === 'komplettgericht' || !zutatFuer(z.name))
    .map((z) => z.name);
  const erlaubt = gedeckteZutaten([
    ...echte.map((z) => z.name), ...echte.flatMap((z) => z.zusammensetzung ?? []), ...g.fehlt.map((f) => f.name),
  ]);
  for (const id of TYP_ZUTATEN[typ] ?? []) erlaubt.add(id);
  const deckungDe = deckungstext([...echte.map((z) => z.name), ...echte.flatMap((z) => z.zusammensetzung ?? []), ...g.fehlt.map((f) => f.name)]);
  const ki = pruefeBildAnfrage(roh, erlaubt, deckungDe);

  const was = komplett.length === 1 && !zutatFuer(komplett[0].name)
    ? normalisiere(komplett[0].name).replace(/\btk\b/g, '').trim() || TYP_EN[typ]
    : TYP_EN[typ];
  const softwareBegriff = woerter([...en.begriffe.slice(0, 3), was].join(' ')).join(' ') || 'dish';
  const m = motiv(was, en.ids, unbekannt);
  const pflicht = komplett.length === 1 ? [normalisiere(komplett[0].name).split(' ').filter((w) => w.length > 2 && w !== 'tk')[0] ?? was]
    : [...en.begriffe.slice(0, 3).map((b) => b.split(' ').pop()!), TYP_EN[typ].split(' ')[0]];
  const pflichtSauber = [...new Set(pflicht.flatMap((p) => woerter(p, 1)))];
  return {
    schluessel: bildSchluessel('gericht', typ, [...en.ids, ...en.unbekannt, ...(komplett.length ? komplett.map((z) => z.name) : [])]),
    art: 'gericht',
    suchbegriff: ki.begriff ?? softwareBegriff,
    pflicht: pflichtSauber,
    // ein zusammengesetztes Gericht braucht zwei Treffer – eine einzelne Tomate ist noch keine Bowl
    mindestens: Math.min(2, pflichtSauber.length),
    erlaubt: [...erlaubt].sort(),
    motiv: m,
    prompt: bildPrompt(m, ki.stil),
    stil: ki.stil,
    format: ki.format,
    alt: kuerze(`Foto: ${g.name}`, 200),
    begriff_von: ki.begriff ? 'ki' : 'software',
    ki_verworfen: ki.begriff ? null : ki.grund,
  };
}

/**
 * Bildanforderung für eine Komponente (Vorschlag oder Sorte im Vorrat). null, wenn weder das
 * Lebensmittel selbst noch eine seiner Zutaten bekannt ist – dann ließe sich kein Foto als passend
 * prüfen, und die App zeigt ihr lokales Bild.
 */
export function bildAnfrageFuerKomponente(
  k: { name: string; zutaten: { name: string; quelle?: string }[]; zusammensetzung?: string[] | null; zutat_id?: string | null },
  roh?: RohBildAnfrage | null,
): BildAnfrage | null {
  const bestandteile = [...k.zutaten.filter((z) => z.quelle !== 'grundausstattung').map((z) => z.name), ...(k.zusammensetzung ?? [])];
  const selbst = zutatFuer(k.name, k.zutat_id);
  const en = englisch(bestandteile.map((n) => ({ name: n, zusammensetzung: null })));
  if (!selbst && en.ids.length === 0) return null;
  const erlaubt = gedeckteZutaten([k.name, ...bestandteile]);
  const deckungDe = deckungstext([k.name, ...bestandteile]);
  const ki = pruefeBildAnfrage(roh, erlaubt, deckungDe);
  const was = selbst?.en ?? (en.begriffe.length ? `${en.begriffe.slice(0, 2).join(' and ')} ${bestandteile.length ? 'preparation' : ''}`.trim() : normalisiere(k.name));
  const unbekannt = bestandteile.length === 0 && !selbst ? [k.name] : [];
  const m = motiv(was, selbst ? [selbst.id, ...en.ids] : en.ids, unbekannt);
  // bekannte Komponente („tomato sauce“): alle ihre Wörter; sonst zwei ihrer Bestandteile
  const pflicht = selbst
    ? woerter(selbst.en)
    : [...new Set(en.begriffe.slice(0, 3).flatMap((b) => woerter(b).slice(-1)))];
  return {
    schluessel: bildSchluessel('komponente', selbst?.id ?? normalisiere(k.name), selbst ? [] : en.ids),
    art: 'komponente',
    suchbegriff: ki.begriff ?? (woerter(was).join(' ') || 'food'),
    pflicht,
    mindestens: selbst ? pflicht.length : Math.min(2, pflicht.length),
    erlaubt: [...erlaubt].sort(),
    motiv: m,
    prompt: bildPrompt(m, ki.stil),
    stil: ki.stil,
    format: ki.format,
    alt: kuerze(`Foto: ${k.name}`, 200),
    begriff_von: ki.begriff ? 'ki' : 'software',
    ki_verworfen: ki.begriff ? null : ki.grund,
  };
}

/** Bildanforderung für eine einzelne Zutat – nur, wenn sie semantisch bekannt ist (sonst lokales Bild). */
export function bildAnfrageFuerZutat(name: string, zutatId?: string | null): BildAnfrage | null {
  const z = zutatFuer(name, zutatId);
  if (!z) return null;
  return {
    schluessel: bildSchluessel('zutat', z.id, []),
    art: 'zutat',
    suchbegriff: z.en,
    pflicht: [z.en.split(' ').pop()!],
    mindestens: 1,
    erlaubt: [z.id],
    motiv: motiv(z.en, [z.id], []),
    prompt: bildPrompt(motiv(z.en, [z.id], [])),
    stil: STANDARD_STIL,
    format: '4:3',
    alt: `Foto: ${z.name}`,
    begriff_von: 'software',
    ki_verworfen: null,
  };
}

/** Komponenten-Vorschlag → Bildanforderung (für Produktion); null = nur lokales Bild. */
export const bildAnfrageFuerVorschlag = (k: KomponentenVorschlag): BildAnfrage | null =>
  bildAnfrageFuerKomponente({ name: k.name, zutaten: k.zutaten });

// ───────── Bildsuche: Wikimedia Commons ─────────

export type Fundstueck = {
  url: string;
  quelle_seite: string;
  lizenz: string;
  urheber: string | null;
  titel: string;
  punkte: number;
};

/** Suchadresse der Commons-API (Dateien, mit Vorschaubild in begrenzter Breite und Lizenzangaben). */
export function commonsSuchUrl(begriff: string, breite = 800): string {
  const p = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6', gsrlimit: '12',
    gsrsearch: `${begriff} filetype:bitmap`, prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: String(breite),
  });
  return `https://commons.wikimedia.org/w/api.php?${p.toString()}`;
}

const KEIN_ESSEN = / (plant|plants|pflanze|flower|flowers|blossom|bl(ü|ue)te|field|farm|seedling|leaf|leaves|tree|harvest|logo|icon|diagram|map|drawing|illustration|painting|cartoon|clipart|svg|sign|packaging|package|label|stamp|advertisement|menu|shop|market|stall) /;
const FREIE_LIZENZ = /^(cc0|cc[ -]by(-sa)?([ -]\d(\.\d)?)?|public domain|pd\b|attribution)/i;
const ohneHtml = (t: unknown) => (typeof t === 'string' ? t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '');

/**
 * Wertet eine Commons-Antwort aus: nur Fotos (jpeg/png/webp) mit freier Lizenz, deren Titel oder
 * Beschreibung ein Pflichtwort nennt und keine Zutat zeigt, die nicht im Gericht ist.
 * Bestes Fundstück zuerst; leere Liste = nichts Passendes (dann lieber lokal/generiert).
 */
export function werteCommonsAus(antwort: unknown, anfrage: Pick<BildAnfrage, 'pflicht' | 'mindestens' | 'erlaubt'>): Fundstueck[] {
  const seiten = (antwort as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!seiten || typeof seiten !== 'object') return [];
  const erlaubt = new Set(anfrage.erlaubt);
  const pflicht = anfrage.pflicht.map((p) => p.toLowerCase()).filter(Boolean);
  const funde: Fundstueck[] = [];
  for (const s of Object.values(seiten)) {
    const seite = s as { title?: string; imageinfo?: Record<string, unknown>[] };
    const info = seite.imageinfo?.[0] as {
      thumburl?: string; url?: string; descriptionurl?: string; mime?: string;
      extmetadata?: Record<string, { value?: unknown }>;
    } | undefined;
    if (!info) continue;
    if (!/^image\/(jpeg|png|webp)$/.test(info.mime ?? '')) continue;
    const url = sichereBildUrl(info.thumburl ?? info.url, 'gefunden');
    const seiteUrl = typeof info.descriptionurl === 'string' && info.descriptionurl.startsWith('https://') ? info.descriptionurl : null;
    if (!url || !seiteUrl) continue;
    const meta = info.extmetadata ?? {};
    const lizenz = ohneHtml(meta.LicenseShortName?.value);
    if (!FREIE_LIZENZ.test(lizenz)) continue;
    const text = `${seite.title ?? ''} ${ohneHtml(meta.ObjectName?.value)} ${ohneHtml(meta.ImageDescription?.value)}`.slice(0, 1500);
    const klein = ` ${text.toLowerCase().replace(/[^a-zäöüß]+/g, ' ')} `;
    const treffer = pflicht.filter((p) => klein.includes(` ${p}`)).length;
    if (treffer === 0 || treffer < anfrage.mindestens) continue;
    // Das Motiv soll Essen zeigen – keine Pflanze auf dem Feld, kein Logo, keine Grafik
    if (KEIN_ESSEN.test(klein)) continue;
    // Zeigt das Foto etwas, das nicht ins Gericht gehört? (englisch und deutsch geprüft)
    const fremd = englischeZutaten(klein).filter((id) => !erlaubt.has(id));
    const fremdDe = ungedeckt(flach(text), deckungstext([...erlaubt]));
    if (fremd.length || fremdDe.length) continue;
    funde.push({
      url,
      quelle_seite: seiteUrl,
      lizenz: kuerze(lizenz, 120),
      urheber: kuerze(ohneHtml(meta.Artist?.value), 200) || null,
      titel: kuerze((seite.title ?? '').replace(/^File:/, ''), 200),
      punkte: treffer / Math.max(1, pflicht.length),
    });
  }
  return funde.sort((a, b) => b.punkte - a.punkte || a.titel.localeCompare(b.titel));
}

/** Fundstück → gespeicherte Bilddaten. */
export function alsBildDaten(f: Fundstueck, anfrage: Pick<BildAnfrage, 'suchbegriff' | 'alt'>, jetzt: string): BildDaten {
  return {
    image_url: f.url, image_source: 'gefunden', image_status: 'ok', image_query: anfrage.suchbegriff, image_alt: anfrage.alt,
    image_generated: false, image_updated_at: jetzt, lizenz: f.lizenz, urheber: f.urheber, quelle_seite: f.quelle_seite,
  };
}

/** „Foto: Max Muster · CC BY-SA 4.0 · Wikimedia Commons“ – Nachweis für die Detailansicht. */
export function bildNachweis(b: BildDaten | null | undefined): string | null {
  if (!b) return null;
  if (b.image_source === 'generiert') return 'Bild generiert (KI) – zeigt das Gericht sinngemäß, nicht exakt.';
  if (b.image_source !== 'gefunden') return null;
  const teile = [b.urheber ? `Foto: ${b.urheber}` : 'Foto', b.lizenz, /wikimedia/.test(b.quelle_seite ?? '') ? 'Wikimedia Commons' : null];
  return teile.filter(Boolean).join(' · ');
}

// ───────── Auftrag an die Edge Function prüfen ─────────

const WORT = /^[a-zäöüß-]{1,24}$/;
const KATALOG_ODER_FREMD = (id: string) => !!zutatMitId(id) || id === 'meeresfruechte';

/**
 * Prüft eine Bildanforderung, die von der App kommt (öffentliche Funktion!): feste Felder, kurze
 * Wörter, nur Katalog-Zutaten. Die Beschreibung für die Generierung wird hier NEU gebaut – ein
 * mitgeschickter Freitext-Prompt wird nie verwendet.
 */
export function pruefeBildAuftrag(roh: unknown): BildAnfrage | null {
  const r = roh as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const art = (['gericht', 'komponente', 'zutat'] as const).find((a) => a === r.art);
  const schluessel = typeof r.schluessel === 'string' && /^[a-z]+:[a-z0-9-]+:[a-z0-9+-]+$/.test(r.schluessel) && r.schluessel.length <= 200 ? r.schluessel : null;
  const such = typeof r.suchbegriff === 'string' ? r.suchbegriff.toLowerCase().replace(/\s+/g, ' ').trim() : '';
  if (!art || !schluessel || !such || such.length > 80 || !such.split(' ').every((w) => WORT.test(w))) return null;
  const pflicht = (Array.isArray(r.pflicht) ? r.pflicht : []).filter((w): w is string => typeof w === 'string' && WORT.test(w)).slice(0, 6);
  const erlaubt = (Array.isArray(r.erlaubt) ? r.erlaubt : []).filter((w): w is string => typeof w === 'string' && KATALOG_ODER_FREMD(w)).slice(0, 30);
  const m = r.motiv as Record<string, unknown> | null;
  if (pflicht.length === 0 || !m || typeof m.was !== 'string') return null;
  const mm = motiv(
    m.was,
    (Array.isArray(m.zutaten) ? m.zutaten : []).filter((x): x is string => typeof x === 'string'),
    (Array.isArray(m.unbekannt) ? m.unbekannt : []).filter((x): x is string => typeof x === 'string'),
  );
  const stil = STILE.find((x) => x === r.stil) ?? STANDARD_STIL;
  const mindestens = Math.min(pflicht.length, Math.max(1, Math.round(Number(r.mindestens)) || 1));
  return {
    schluessel, art, suchbegriff: such, pflicht, mindestens, erlaubt, motiv: mm, prompt: bildPrompt(mm, stil), stil,
    format: SEITENVERHAELTNISSE.find((f) => f === r.format) ?? '4:3',
    alt: kuerze(typeof r.alt === 'string' ? r.alt : 'Foto', 200),
    begriff_von: r.begriff_von === 'ki' ? 'ki' : 'software',
    ki_verworfen: null,
  };
}

/**
 * Kleinere Variante eines Commons-Vorschaubilds (für Listen): „…/800px-Datei.jpg“ → „…/320px-Datei.jpg“.
 * Andere URLs bleiben unverändert.
 */
export function bildUrlFuerBreite(url: string, breite: number): string {
  if (!/^https:\/\/upload\.wikimedia\.org\/.+\/thumb\//.test(url)) return url;
  return url.replace(/\/(\d+)px-([^/]+)$/, (_, alt: string, datei: string) => `/${Math.min(Number(alt), breite)}px-${datei}`);
}

/** Kurzer, stabiler Dateiname aus dem Schlüssel (FNV-1a) – für generierte Bilder im Speicher. */
export function schluesselHash(schluessel: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < schluessel.length; i++) {
    h ^= schluessel.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
