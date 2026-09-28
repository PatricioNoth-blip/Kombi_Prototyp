// Bilder zum Essen – in dieser Reihenfolge:
//   1. eigenes, gefundenes oder generiertes Bild (geprüfte https-URL, siehe bilder.ts)
//   2. lokales Foto, das wirklich zum Namen passt (src/bilder/)
//   3. warme Kachel mit passendem Lebensmittel-Symbol (nach Name, sonst nach Zutat-Kategorie oder Rolle)
// Lädt ein Bild nicht, springt die Anzeige sofort eine Stufe weiter – nie ein kaputtes Bild-Symbol.
// Bilder sind nur Illustration; Mengen, Preise und Inhalte kommen nie aus einem Bild.
import { useState } from 'react';
import type { Farbe } from '../supabase/functions/_shared/kombi/typen.ts';
import { type BildDaten, bildUrlFuerBreite, sichereBildUrl } from '../supabase/functions/_shared/kombi/bilder.ts';
import { erkenneZutat, KATEGORIE_EMOJI } from '../supabase/functions/_shared/kombi/zutaten.ts';
import tomatensosse from './bilder/tomatensosse.webp';
import pasta from './bilder/pasta.webp';
import curry from './bilder/curry.webp';
import falafel from './bilder/falafel.webp';
import ofengemuese from './bilder/ofengemuese.webp';
import pizza from './bilder/pizza.webp';
import spinat from './bilder/spinat.webp';
import tomaten from './bilder/tomaten.webp';
import haferflocken from './bilder/haferflocken.webp';
import kaese from './bilder/kaese.webp';
import topf from './bilder/topf.webp';
import heldTomaten from './bilder/held-tomaten.webp';
import heldGemuese from './bilder/held-gemuese.webp';
import kuehlschrank from './bilder/kuehlschrank.webp';
import gefrierfach from './bilder/gefrierfach.webp';
import vorratsschrank from './bilder/vorratsschrank.webp';

export const DEKO = { heldTomaten, heldGemuese, topf };
export const ORT_FOTO = { kuehlschrank, gefrierfach, vorrat: vorratsschrank } as const;

/** gross = taugt auch für große Flächen; sonst nur für kleine, runde Bilder */
type Foto = { src: string; gross: boolean };

// Reihenfolge zählt: „Tomatensoße“ vor „Tomate“, „Pizza“ vor allem anderen
const FOTOS: [RegExp, Foto][] = [
  [/(tomat\w*[- ]?(so(ss|ß)e|sauce|basis|sugo))|passata|bolognese/, { src: tomatensosse, gross: true }],
  [/spaghetti|pasta|nudel|tagliatelle|penne|fusilli/, { src: pasta, gross: true }],
  [/curry|\bdal\b|dhal/, { src: curry, gross: true }],
  [/falafel|patty|bratling|bällchen/, { src: falafel, gross: true }],
  [/ofengem|gemüsemix|gemuesemix|ratatouille|grillgem|röstgem/, { src: ofengemuese, gross: true }],
  [/pizza/, { src: pizza, gross: false }],
  [/spinat/, { src: spinat, gross: false }],
  [/tomate/, { src: tomaten, gross: false }],
  [/hafer|müsli|muesli|porridge/, { src: haferflocken, gross: false }],
  [/käse|kaese|mozzarella|parmesan|gouda|feta/, { src: kaese, gross: false }],
];

const EMOJIS: [RegExp, string][] = [
  [/pizza/, '🍕'], [/lasagne|auflauf|gratin/, '🫕'], [/burrito/, '🌯'], [/wrap|tortilla|fladen/, '🫓'],
  [/falafel|patty|bratling|bällchen/, '🧆'], [/burger/, '🍔'], [/suppe|eintopf|chili con|brühe/, '🍲'],
  [/curry|\bdal\b/, '🍛'], [/spaghetti|pasta|nudel|penne|fusilli/, '🍝'], [/reis|risotto/, '🍚'],
  [/(tomat\w*[- ]?(so(ss|ß)e|sauce|basis))|passata|bolognese|pesto|so(ss|ß)e|sauce/, '🥫'],
  [/toast|sandwich/, '🥪'], [/brötchen|broetchen|baguette|brot/, '🥖'], [/kartoffel|pommes/, '🥔'],
  [/linsen|bohnen|kichererbsen|erbsen|tofu/, '🫘'], [/tomate/, '🍅'], [/spinat|salat|mangold|kohl/, '🥬'],
  [/brokkoli|gemüse|gemuese/, '🥦'], [/karotte|möhre|moehre/, '🥕'], [/paprika/, '🫑'], [/gurke/, '🥒'],
  [/zwiebel|lauch/, '🧅'], [/knoblauch/, '🧄'], [/pilz|champignon/, '🍄'], [/mais/, '🌽'], [/aubergine/, '🍆'],
  [/avocado/, '🥑'], [/käse|kaese|mozzarella|parmesan|feta/, '🧀'], [/joghurt|quark|skyr/, '🥣'],
  [/milch|sahne/, '🥛'], [/\beier?\b/, '🥚'], [/butter/, '🧈'], [/hähnchen|haehnchen|huhn|chicken/, '🍗'],
  [/fleisch|hack|rind|schwein|wurst|salami|speck/, '🥩'], [/fisch|lachs|thunfisch/, '🐟'],
  [/hafer|müsli|muesli|flocken/, '🥣'], [/nuss|nüsse|mandel|kerne|crunch|crouton/, '🥜'],
  [/kräuter|kraeuter|basilikum|petersilie|koriander|minze/, '🌿'], [/chili|jalape/, '🌶️'],
  [/gewürz|gewuerz|booster|salz|pfeffer/, '🧂'], [/apfel/, '🍎'], [/banane/, '🍌'], [/zitrone|limette/, '🍋'],
  [/beere/, '🫐'], [/\böl\b|olive/, '🫒'], [/mehl|getreide/, '🌾'], [/zucker|honig/, '🍯'], [/kaffee/, '☕'],
];

const NACH_FARBE: Record<Farbe, string> = { rot: '🥫', braun: '🫘', gruen: '🥦', gelb: '🍞', weiss: '🧂', schwarz: '🥜', blau: '🍱' };

const klein = (t: string) => t.toLocaleLowerCase('de-DE');

export function fotoFuer(name: string): Foto | null {
  const n = klein(name);
  return FOTOS.find(([m]) => m.test(n))?.[1] ?? null;
}

export function emojiFuer(name: string, farbe?: Farbe | null): string {
  const n = klein(name);
  const z = EMOJIS.find(([m]) => m.test(n))?.[1];
  if (z) return z;
  const zutat = erkenneZutat(name);
  return zutat ? KATEGORIE_EMOJI[zutat.kategorie] : farbe ? NACH_FARBE[farbe] : '🍽️';
}

const BREITE: Record<BildArt, number> = { rund: 160, klein: 160, kachel: 320, flaeche: 800 };

export type BildArt = 'rund' | 'klein' | 'kachel' | 'flaeche';

/**
 * rund/klein: runde Lebensmittel-Bilder (Listen, „Heute wichtig“); kachel: quadratisch mit runden Ecken;
 * flaeche: füllt den Platz (Karten mit Foto). Kleine Fotos werden nie groß aufgeblasen.
 */
export function Bild({ name, emoji, farbe, art, className = '', bild, alt, onKaputt }: {
  name: string; emoji?: string | null; farbe?: Farbe | null; art: BildArt; className?: string;
  /** eigenes/gefundenes/generiertes Bild (optional) */
  bild?: BildDaten | null;
  /** Alternativtext – nur für inhaltlich wichtige Bilder (Koch-Ansicht); sonst dekorativ */
  alt?: string;
  onKaputt?: () => void;
}) {
  const [kaputt, setKaputt] = useState<string | null>(null);
  const url = bild && bild.image_status === 'ok' ? sichereBildUrl(bild.image_url, bild.image_source) : null;
  if (url && kaputt !== url) {
    const src = bildUrlFuerBreite(url, BREITE[art]);
    const srcSet = art === 'flaeche' && src !== bildUrlFuerBreite(url, 400)
      ? `${bildUrlFuerBreite(url, 400)} 400w, ${src} 800w` : undefined;
    return (
      <img className={`bild bild-${art} ${className}`} src={src} srcSet={srcSet} sizes={srcSet ? '(max-width: 560px) 100vw, 560px' : undefined}
        alt={alt ?? ''} loading="lazy" decoding="async" draggable={false}
        onError={() => {
          setKaputt(url);
          onKaputt?.();
        }} />
    );
  }
  const foto = fotoFuer(name);
  const passt = foto && (foto.gross || art === 'rund' || art === 'klein') && kaputt !== foto.src;
  if (passt) {
    return <img className={`bild bild-${art} ${className}`} src={foto.src} alt={alt ?? ''} loading="lazy" decoding="async" draggable={false} onError={() => setKaputt(foto.src)} />;
  }
  return (
    <span className={`bild bild-${art} bild-symbol f-${farbe ?? 'neutral'} ${className}`} aria-hidden="true">
      <span>{emoji || emojiFuer(name, farbe)}</span>
    </span>
  );
}
