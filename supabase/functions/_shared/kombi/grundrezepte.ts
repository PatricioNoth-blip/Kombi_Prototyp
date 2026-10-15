// Grundrezepte: feste, erprobte vegetarische Rezepte aus den Grundbausteinen des Food-Baukastens.
//
// Rezepte 1–15 stammen aus der Rezeptsammlung „Rezepte ohne Tiefkühlzutaten“ (Mengen und Zubereitung
// wie dort, Mengen für die angegebene Portionenzahl). Rezepte 16–25 nutzen den übrigen Grundvorrat:
// TK-Gemüse, vorbereitete Basen, gekochte Hülsenfrüchte, Brot und die selbst gemachte Pizza.
// Zwiebeln, Möhren und Knoblauch gelten als immer vorhanden (Grundausstattung).
//
// Ablauf: Jede Zutat eines Rezepts wird mit der passenden Sorte aus dem Vorrat belegt (oder mit dem,
// was der Nutzer zusätzlich genannt hat). Fehlt etwas, steht es mit Menge unter „fehlt“. Danach läuft
// das Rezept durch dieselbe Prüfung wie jeder Vorschlag (validierung.ts): Mengen, „fehlt“, Namen und
// Texte nur mit Zutaten, die wirklich drin sind. Erst die KI improvisiert – die Grundrezepte nicht.
import type {
  Eigenschaften, Gericht, KiAnbieter, KiAnfrage, KiAuftrag, Optionen, RohAntwort, RohFehlt, RohGericht, RohZutat, Snapshot,
  SnapshotZutat,
} from './typen.ts';
import { erfuellt, grundbaustein, type Grundbaustein } from './grundbausteine.ts';
import { pruefeGericht } from './validierung.ts';
import { bewerte, kurz, STANDARD_GEWICHTE } from './bewertung.ts';
import { berechneLeitplanken, verletztAusschluss } from './praeferenz.ts';
import { wiederholung } from './vielfalt.ts';
import { normalisiere, restName } from './text.ts';
import { uuid } from './id.ts';

type Zutat = {
  /** Schlüssel für Texte, z. B. 'nudeln' */
  platz: string;
  /** passende Grundbausteine; der erste ist der im Rezept genannte */
  aus: string[];
  /** Menge in g bzw. ml für die Portionenzahl des Rezepts (gilt für den ersten Baustein) */
  g: number;
  /** abweichende Mengen für Ersatz-Bausteine (sonst deren übliche Menge pro Person) */
  ersatz_g?: Record<string, number>;
  optional?: boolean;
  /** Gemüse: lieber etwas weniger als „fehlt“ – ab der Hälfte reicht es */
  flexibel?: boolean;
};

export type Auswahl = {
  personen: number;
  /** vorhanden (aus dem Vorrat oder vom Nutzer genannt) – nicht fehlend, nicht weggelassen */
  hat: (platz: string) => boolean;
  /** Name der gewählten Sorte bzw. des fehlenden Bausteins – für den Satzanfang; '' bei weggelassenem Extra */
  name: (platz: string) => string;
  /** derselbe Name im Satz: „passierte Tomaten“ statt „Passierte Tomaten“ (Nominativ/Akkusativ) */
  im: (platz: string) => string;
  /** ist dieser Platz mit diesem Baustein belegt? */
  ist: (platz: string, baustein: string) => boolean;
  /** belegt eine Sorte beide Plätze (z. B. Linsen-Bolognese-Basis für Linsen und Tomaten)? */
  gleich: (a: string, b: string) => boolean;
  /** Menge der Grundausstattung, skaliert: stueck(0.5, 'Zwiebel', 'Zwiebeln') → „½ Zwiebel“ */
  stueck: (anzahl: number, einzahl: string, mehrzahl: string) => string;
  /** Wasser o. Ä. in ml, skaliert und gerundet */
  ml: (ml: number) => string;
};

export type Grundrezept = {
  id: string;
  /** Nummer in der Rezeptsammlung (1–15) bzw. ergänzt (16–25) */
  nr: number;
  name: string | ((a: Auswahl) => string);
  emoji: string;
  /** Für so viele Portionen gelten die Mengen */
  portionen: number;
  zeit_min: number;
  zutaten: Zutat[];
  /** nur vorschlagen, wenn dieser Platz da ist (die Pizza fehlt nicht, sie ist einfach nicht da) */
  nur_wenn_da?: string;
  beschreibung: (a: Auswahl) => string;
  schritte: (a: Auswahl) => string[];
  eigenschaften: (a: Auswahl) => Eigenschaften;
};

// ───────── Bausteine der Rezepte ─────────

const NUDELN = ['nudeln'];
const REIS = ['reis'];
const KARTOFFELN = ['kartoffeln'];
const TOMATEN_PASSIERT = ['passierte_tomaten', 'gehackte_tomaten', 'tomaten_gemuese_basis'];
const TOMATEN_GEHACKT = ['gehackte_tomaten', 'passierte_tomaten'];
const GEMUESE = ['tk_gemuese', 'neutrale_gemuese_basis'];
const BEILAGE: Zutat = { platz: 'beilage', aus: ['brot', 'broetchen'], g: 160, optional: true };
const KAESE = (g: number): Zutat => ({ platz: 'kaese', aus: ['kaese'], g, optional: true });

const e = (
  gerichtstyp: Eigenschaften['gerichtstyp'], hauptzutat: string, sattmacher: Eigenschaften['sattmacher'],
  zubereitung: Eigenschaften['zubereitung'], extra: Partial<Eigenschaften> = {},
): Eigenschaften => ({
  gerichtstyp, hauptzutat, geschmack: 'herzhaft', schaerfe: 0, konsistenz: 'stueckig', sattmacher,
  gewuerzrichtung: 'neutral', zubereitung, temperatur: 'warm', ...extra,
});

const ABSCHMECKEN = 'Mit Salz und Pfeffer abschmecken';
const mitBeilage = (a: Auswahl) => (a.hat('beilage') ? [`Dazu ${a.im('beilage')} reichen.`] : []);
const mitKaese = (a: Auswahl, text: (k: string) => string) => (a.hat('kaese') ? [text(a.name('kaese'))] : []);

export const GRUNDREZEPTE: Grundrezept[] = [
  // ───────── Aus der Rezeptsammlung ─────────
  {
    id: 'nudeln-tomatensosse', nr: 1, name: 'Nudeln mit Tomatensoße', emoji: '🍝', portionen: 2, zeit_min: 20,
    zutaten: [{ platz: 'nudeln', aus: NUDELN, g: 225 }, { platz: 'tomaten', aus: TOMATEN_PASSIERT, g: 500 }],
    beschreibung: () => 'Der Klassiker: Nudeln in einer schnellen Tomatensoße mit Zwiebel – nach Wunsch mit Möhre oder Knoblauch.',
    schritte: (a) => [
      `${a.name('nudeln')} in Salzwasser nach Packung kochen.`,
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} und nach Wunsch etwas Möhre oder Knoblauch klein schneiden und in etwas Öl weich dünsten.`,
      `${a.name('tomaten')} zugeben und ${a.ist('tomaten', 'tomaten_gemuese_basis') ? '5–10' : '10–15'} Minuten köcheln lassen.`,
      `${ABSCHMECKEN} und mit den Nudeln servieren.`,
    ],
    eigenschaften: () => e('pasta', 'tomate', 'pasta', 'topf', { gewuerzrichtung: 'italienisch' }),
  },
  {
    id: 'linsen-bolognese', nr: 2, name: 'Linsen-Bolognese mit Nudeln', emoji: '🍝', portionen: 2, zeit_min: 30,
    zutaten: [
      { platz: 'nudeln', aus: NUDELN, g: 200 },
      { platz: 'linsen', aus: ['rote_linsen', 'linsen_bolognese_basis', 'gekochte_linsen'], g: 150, ersatz_g: { gekochte_linsen: 350 } },
      { platz: 'tomaten', aus: TOMATEN_PASSIERT, g: 500 },
      KAESE(40),
    ],
    beschreibung: (a) => (a.gleich('linsen', 'tomaten')
      ? `${a.name('linsen')}, nur noch heiß gemacht – dazu Nudeln.`
      : 'Herzhafte Bolognese aus Linsen und Tomaten mit Zwiebel und Möhre, dazu Nudeln.'),
    schritte: (a) => {
      const servieren = `Mit den Nudeln servieren${a.hat('kaese') ? ` und ${a.im('kaese')} darüberreiben` : ''}.`;
      if (a.gleich('linsen', 'tomaten')) {
        return [`${a.name('nudeln')} nach Packung kochen.`, `${a.name('linsen')} in einem Topf erhitzen, bei Bedarf etwas Wasser zugeben.`, servieren];
      }
      if (a.ist('linsen', 'gekochte_linsen')) {
        return [
          `${a.name('nudeln')} nach Packung kochen.`,
          `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} und etwas Möhre klein schneiden und kurz dünsten.`,
          `${a.name('tomaten')} und ${a.im('linsen')} zugeben, 10 Minuten köcheln lassen. ${ABSCHMECKEN}.`,
          servieren,
        ];
      }
      return [
        `${a.name('linsen')} abspülen.`,
        `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} und etwas Möhre klein schneiden und kurz dünsten.`,
        `${a.name('tomaten')}, die Linsen und ${a.ml(350)} Wasser zugeben.`,
        'Köcheln lassen, bis die Linsen weich sind (etwa 15 Minuten); bei Bedarf Wasser nachgießen.',
        `In der Zwischenzeit ${a.im('nudeln')} nach Packung kochen. Die Soße abschmecken.`,
        servieren,
      ];
    },
    eigenschaften: () => e('pasta', 'linsen', 'pasta', 'topf', { gewuerzrichtung: 'italienisch' }),
  },
  {
    id: 'tomaten-linsen-eintopf', nr: 3, name: 'Tomaten-Linsen-Eintopf', emoji: '🍲', portionen: 2, zeit_min: 25,
    zutaten: [{ platz: 'linsen', aus: ['rote_linsen'], g: 175 }, { platz: 'tomaten', aus: TOMATEN_GEHACKT, g: 400 }, BEILAGE],
    beschreibung: () => 'Rote Linsen, Tomaten, Zwiebel und Möhre in einem Topf – sättigend und in 20 Minuten fertig.',
    schritte: (a) => [
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} und ${a.stueck(1, 'Möhre', 'Möhren')} klein schneiden.`,
      `Das Gemüse, ${a.im('tomaten')}, ${a.im('linsen')} und ${a.ml(500)} Wasser in einen Topf geben.`,
      'Etwa 15–20 Minuten köcheln lassen, bis die Linsen weich sind. Für eine dünnere Suppe mehr Wasser zugeben.',
      `${ABSCHMECKEN}.`,
      ...mitBeilage(a),
    ],
    eigenschaften: (a) => e('eintopf', 'linsen', a.hat('beilage') ? 'brot' : 'keiner', 'topf', { konsistenz: 'suppig' }),
  },
  {
    id: 'reis-kichererbsen-tomate', nr: 4, name: 'Reis mit Kichererbsen und Tomate', emoji: '🍚', portionen: 2, zeit_min: 25,
    zutaten: [
      { platz: 'reis', aus: REIS, g: 150 },
      { platz: 'kichererbsen', aus: ['gekochte_kichererbsen'], g: 225 },
      { platz: 'tomaten', aus: TOMATEN_PASSIERT, g: 375 },
      { platz: 'kokosmilch', aus: ['kokosmilch'], g: 200, optional: true },
    ],
    beschreibung: (a) => `Kichererbsen in Tomatensoße${a.hat('kokosmilch') ? ' mit Kokosmilch' : ''}, dazu Reis.`,
    schritte: (a) => [
      `${a.name('reis')} nach Packung kochen.`,
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden und in etwas Öl dünsten.`,
      `${a.name('tomaten')}${a.hat('kokosmilch') ? `, ${a.im('kokosmilch')}` : ''} und ${a.im('kichererbsen')} zugeben und 10 Minuten köcheln lassen.`,
      `${ABSCHMECKEN} und zusammen mit dem Reis servieren.`,
    ],
    eigenschaften: (a) => e('reisgericht', 'kichererbsen', 'reis', 'topf', { geschmack: a.hat('kokosmilch') ? 'cremig' : 'herzhaft' }),
  },
  {
    id: 'kidneybohnen-tomaten-topf', nr: 5, name: 'Kidneybohnen-Tomaten-Topf', emoji: '🍲', portionen: 2, zeit_min: 20,
    zutaten: [
      { platz: 'bohnen', aus: ['gekochte_kidneybohnen'], g: 250 },
      { platz: 'tomaten', aus: TOMATEN_GEHACKT, g: 400 },
      { platz: 'mais', aus: ['mais'], g: 140, optional: true },
      BEILAGE,
    ],
    beschreibung: (a) => `Kidneybohnen und Tomaten mit Zwiebel geschmort${a.hat('mais') ? ', dazu Mais' : ''} – ein einfacher Eintopf.`,
    schritte: (a) => [
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden. Die Zwiebel, ${a.im('tomaten')} und ${a.im('bohnen')} in einen Topf geben.`,
      '15 Minuten köcheln lassen.',
      ...(a.hat('mais') ? [`${a.name('mais')} abspülen und in den letzten Minuten zugeben.`] : []),
      `${ABSCHMECKEN}.`,
      ...mitBeilage(a),
    ],
    eigenschaften: (a) => e('eintopf', 'bohnen', a.hat('beilage') ? 'brot' : 'keiner', 'topf'),
  },
  {
    id: 'chili-sin-carne', nr: 6, name: 'Chili sin Carne mit Reis', emoji: '🌶️', portionen: 2, zeit_min: 25,
    zutaten: [
      { platz: 'reis', aus: REIS, g: 150 },
      { platz: 'bohnen', aus: ['gekochte_kidneybohnen'], g: 250 },
      { platz: 'tomaten', aus: TOMATEN_GEHACKT, g: 400 },
      { platz: 'mais', aus: ['mais'], g: 140, optional: true },
    ],
    beschreibung: (a) => `Kidneybohnen in Tomaten kräftig geköchelt${a.hat('mais') ? ', mit Mais' : ''} – dazu Reis.`,
    schritte: (a) => [
      `${a.name('reis')} nach Packung kochen.`,
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden. ${a.name('tomaten')}, ${a.im('bohnen')} und die Zwiebel 15–20 Minuten köcheln lassen.`,
      ...(a.hat('mais') ? [`${a.name('mais')} abspülen und zugeben.`] : []),
      'Mit Salz, Pfeffer und nach Geschmack etwas Chili würzen und mit dem Reis servieren.',
    ],
    eigenschaften: () => e('eintopf', 'bohnen', 'reis', 'topf', { geschmack: 'wuerzig', schaerfe: 1, gewuerzrichtung: 'mexikanisch' }),
  },
  {
    id: 'soja-tomaten-pfanne', nr: 7, name: 'Soja-Tomaten-Pfanne mit Reis', emoji: '🥘', portionen: 2, zeit_min: 20,
    zutaten: [
      { platz: 'reis', aus: REIS, g: 150 },
      { platz: 'soja', aus: ['sojagranulat'], g: 60 },
      { platz: 'tomaten', aus: TOMATEN_PASSIERT, g: 375 },
    ],
    beschreibung: () => 'Sojagranulat in Tomatensoße mit Zwiebel, dazu Reis.',
    schritte: (a) => [
      `${a.name('soja')} nach Packungsanweisung mit heißem Wasser quellen lassen und abgießen.`,
      `${a.name('reis')} nach Packung kochen.`,
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden und dünsten. Das Sojagranulat und ${a.im('tomaten')} zugeben und 8–10 Minuten köcheln lassen.`,
      `${ABSCHMECKEN} und mit dem Reis servieren.`,
    ],
    eigenschaften: () => e('pfanne', 'soja', 'reis', 'pfanne'),
  },
  {
    id: 'tomatenreis', nr: 8, name: 'Tomatenreis', emoji: '🍅', portionen: 2, zeit_min: 30,
    zutaten: [{ platz: 'reis', aus: REIS, g: 150 }, { platz: 'tomaten', aus: TOMATEN_PASSIERT, g: 375 }],
    beschreibung: () => 'Reis direkt in Tomaten gegart – mild, saftig und mit wenigen Zutaten.',
    schritte: (a) => [
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden und in etwas Öl dünsten.`,
      `${a.name('reis')}, ${a.im('tomaten')} und ${a.ml(300)} Wasser zugeben.`,
      'Zugedeckt bei niedriger Hitze garen (je nach Reis 15–20 Minuten), gelegentlich umrühren und bei Bedarf Wasser nachgießen.',
      `${ABSCHMECKEN}.`,
    ],
    eigenschaften: () => e('reisgericht', 'tomate', 'reis', 'topf', { konsistenz: 'cremig' }),
  },
  {
    id: 'linsen-reis-topf', nr: 9, name: 'Linsen-Reis-Topf', emoji: '🍲', portionen: 2, zeit_min: 30,
    zutaten: [
      { platz: 'reis', aus: REIS, g: 100 },
      { platz: 'linsen', aus: ['rote_linsen'], g: 120 },
      { platz: 'tomaten', aus: TOMATEN_GEHACKT, g: 200 },
    ],
    beschreibung: () => 'Reis und rote Linsen zusammen mit Tomaten gegart – ein Topf, kaum Arbeit.',
    schritte: (a) => [
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden.`,
      `Die Zwiebel, ${a.im('reis')}, ${a.im('linsen')}, ${a.im('tomaten')} und ${a.ml(600)} Wasser in einen Topf geben.`,
      'Bei niedriger Hitze etwa 20 Minuten garen und regelmäßig umrühren. Je nach Reisart den Reis etwas früher oder später zugeben, damit beides gar wird.',
      `${ABSCHMECKEN}.`,
    ],
    eigenschaften: () => e('reisgericht', 'linsen', 'reis', 'topf', { konsistenz: 'cremig' }),
  },
  {
    id: 'kartoffel-linsen-eintopf', nr: 10, name: 'Kartoffel-Linsen-Eintopf', emoji: '🥔', portionen: 2, zeit_min: 30,
    zutaten: [
      { platz: 'kartoffeln', aus: KARTOFFELN, g: 450 },
      { platz: 'linsen', aus: ['rote_linsen'], g: 120 },
      { platz: 'tomaten', aus: TOMATEN_GEHACKT, g: 200 },
      BEILAGE,
    ],
    beschreibung: () => 'Kartoffeln, rote Linsen, Tomaten, Zwiebel und Möhre – ein kräftiger Eintopf.',
    schritte: (a) => [
      `${a.name('kartoffeln')} schälen und würfeln, ${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} und ${a.stueck(1, 'Möhre', 'Möhren')} klein schneiden.`,
      `Das Gemüse, ${a.im('linsen')}, ${a.im('tomaten')} und ${a.ml(700)} Wasser etwa 20–25 Minuten köcheln lassen, bis Kartoffeln und Linsen gar sind. Bei Bedarf Wasser nachgießen.`,
      `${ABSCHMECKEN}.`,
      ...mitBeilage(a),
    ],
    eigenschaften: () => e('eintopf', 'kartoffel', 'kartoffel', 'topf', { konsistenz: 'suppig', gewuerzrichtung: 'deutsch' }),
  },
  {
    id: 'kartoffel-tomaten-topf', nr: 11, name: 'Kartoffel-Tomaten-Topf', emoji: '🥔', portionen: 2, zeit_min: 30,
    zutaten: [{ platz: 'kartoffeln', aus: KARTOFFELN, g: 450 }, { platz: 'tomaten', aus: TOMATEN_GEHACKT, g: 300 }, KAESE(60)],
    beschreibung: (a) => `Kartoffeln mit Tomaten und Zwiebel weich gegart${a.hat('kaese') ? ' und mit Käse überbacken' : ''}.`,
    schritte: (a) => [
      `${a.name('kartoffeln')} schälen und würfeln, ${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden.`,
      `Kartoffeln, Zwiebel, ${a.im('tomaten')} und ${a.ml(200)} Wasser in einem Topf garen, bis die Kartoffeln weich sind (20–25 Minuten).`,
      `Für eine sämigere Konsistenz einige Kartoffelstücke zerdrücken. ${ABSCHMECKEN}.`,
      ...mitKaese(a, (k) => `${k} darüberstreuen und zugedeckt schmelzen lassen oder kurz im Ofen überbacken.`),
    ],
    eigenschaften: () => e('eintopf', 'kartoffel', 'kartoffel', 'topf', { gewuerzrichtung: 'deutsch' }),
  },
  {
    id: 'nudeln-kichererbsen-tomatensosse', nr: 12, name: 'Nudeln mit Kichererbsen-Tomatensoße', emoji: '🍝', portionen: 2, zeit_min: 20,
    zutaten: [
      { platz: 'nudeln', aus: NUDELN, g: 200 },
      { platz: 'kichererbsen', aus: ['gekochte_kichererbsen'], g: 200 },
      { platz: 'tomaten', aus: TOMATEN_PASSIERT, g: 375 },
    ],
    beschreibung: () => 'Nudeln mit einer Soße aus Tomaten und Kichererbsen.',
    schritte: (a) => [
      `${a.name('nudeln')} nach Packung kochen.`,
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden. Die Zwiebel, ${a.im('tomaten')} und ${a.im('kichererbsen')} 10–15 Minuten köcheln lassen.`,
      `${ABSCHMECKEN} und mit den Nudeln vermischen.`,
    ],
    eigenschaften: () => e('pasta', 'kichererbsen', 'pasta', 'topf', { gewuerzrichtung: 'italienisch' }),
  },
  {
    id: 'linsen-lasagne', nr: 13, name: 'Linsen-Lasagne', emoji: '🫕', portionen: 3, zeit_min: 60,
    zutaten: [
      { platz: 'platten', aus: ['lasagneplatten'], g: 250 },
      { platz: 'linsen', aus: ['rote_linsen', 'linsen_bolognese_basis'], g: 175 },
      { platz: 'tomaten', aus: ['passierte_tomaten', 'gehackte_tomaten'], g: 750 },
      KAESE(100),
    ],
    beschreibung: (a) => `Lasagne mit dicker Linsen-Tomaten-Soße${a.hat('kaese') ? ', mit Käse überbacken' : ''}.`,
    schritte: (a) => [
      ...(a.gleich('linsen', 'tomaten')
        ? [`${a.name('linsen')} erhitzen und mit etwas Wasser verdünnen – die Soße soll flüssig genug für die Platten sein.`]
        : [
          `${a.stueck(1, 'Zwiebel', 'Zwiebeln')} und ${a.stueck(1, 'Möhre', 'Möhren')} klein schneiden und kurz dünsten.`,
          `${a.name('linsen')}, ${a.im('tomaten')} und ${a.ml(400)} Wasser zugeben und 15–20 Minuten zu einer dicken Linsen-Tomatensoße kochen. ${ABSCHMECKEN}.`,
        ]),
      'Den Ofen auf 180 °C vorheizen.',
      `In einer Auflaufform abwechselnd Soße und ${a.im('platten')} schichten und mit Soße abschließen${a.hat('kaese') ? `, dann ${a.im('kaese')} darüberstreuen` : ''}.`,
      'Nach Packungsanweisung backen (meist 30–40 Minuten). Brauchen die Platten mehr Flüssigkeit, etwas Wasser in die Soße geben.',
    ],
    eigenschaften: () => e('auflauf', 'linsen', 'pasta', 'ofen', { konsistenz: 'fest', gewuerzrichtung: 'italienisch' }),
  },
  {
    id: 'haferflocken-linsen-suppe', nr: 14, name: 'Herzhafte Haferflocken-Linsen-Suppe', emoji: '🥣', portionen: 2, zeit_min: 25,
    zutaten: [
      { platz: 'linsen', aus: ['rote_linsen'], g: 90 },
      { platz: 'hafer', aus: ['haferflocken'], g: 40 },
      { platz: 'tomaten', aus: TOMATEN_GEHACKT, g: 200 },
      BEILAGE,
    ],
    beschreibung: () => 'Rote Linsen, Tomaten, Zwiebel und Möhre – mit Haferflocken sämig gekocht.',
    schritte: (a) => [
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} und ${a.stueck(1, 'Möhre', 'Möhren')} klein schneiden.`,
      `Das Gemüse, ${a.im('linsen')}, ${a.im('tomaten')} und ${a.ml(800)} Wasser 15 Minuten köcheln lassen.`,
      `${a.name('hafer')} einrühren und weitere 3–5 Minuten kochen, bis die Suppe etwas andickt.`,
      `${ABSCHMECKEN}.`,
      ...mitBeilage(a),
    ],
    eigenschaften: (a) => e('suppe', 'linsen', a.hat('beilage') ? 'brot' : 'keiner', 'topf', { konsistenz: 'suppig' }),
  },
  {
    id: 'kartoffel-kichererbsen-topf', nr: 15, name: 'Kartoffel-Kichererbsen-Topf', emoji: '🥔', portionen: 2, zeit_min: 30,
    zutaten: [
      { platz: 'kartoffeln', aus: KARTOFFELN, g: 400 },
      { platz: 'kichererbsen', aus: ['gekochte_kichererbsen'], g: 225 },
      { platz: 'tomaten', aus: TOMATEN_GEHACKT, g: 200 },
      BEILAGE,
    ],
    beschreibung: () => 'Kartoffeln und Kichererbsen in Tomaten mit Zwiebel gegart.',
    schritte: (a) => [
      `${a.name('kartoffeln')} schälen und würfeln, ${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden.`,
      `Kartoffeln, Zwiebel, ${a.im('tomaten')} und ${a.ml(400)} Wasser 15 Minuten köcheln lassen.`,
      `${a.name('kichererbsen')} zugeben und weitergaren, bis die Kartoffeln weich sind.`,
      `${ABSCHMECKEN}.`,
      ...mitBeilage(a),
    ],
    eigenschaften: () => e('eintopf', 'kichererbsen', 'kartoffel', 'topf'),
  },

  // ───────── Ergänzt aus dem übrigen Grundvorrat ─────────
  {
    id: 'gemuese-nudel-pfanne', nr: 16, name: 'Gemüse-Nudel-Pfanne', emoji: '🥘', portionen: 2, zeit_min: 20,
    zutaten: [{ platz: 'nudeln', aus: NUDELN, g: 200 }, { platz: 'gemuese', aus: GEMUESE, g: 400, flexibel: true }, KAESE(40)],
    beschreibung: (a) => `Nudeln und Gemüse mit Zwiebel und Knoblauch in der Pfanne gebraten${a.hat('kaese') ? ', mit Käse' : ''}.`,
    schritte: (a) => [
      `${a.name('nudeln')} nach Packung kochen und abgießen.`,
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} und etwas Knoblauch klein schneiden und in etwas Öl anbraten.`,
      `${a.name('gemuese')} zugeben und 6–8 Minuten braten, bis es gar ist.`,
      `Die Nudeln zugeben und kurz mitbraten. ${ABSCHMECKEN}.`,
      ...mitKaese(a, (k) => `${k} darüberstreuen.`),
    ],
    eigenschaften: () => e('pasta', 'gemuese', 'pasta', 'pfanne'),
  },
  {
    id: 'linsen-gemuese-eintopf', nr: 17, name: 'Linsen-Gemüse-Eintopf', emoji: '🍲', portionen: 2, zeit_min: 25,
    zutaten: [
      { platz: 'linsen', aus: ['gekochte_linsen', 'rote_linsen'], g: 250, ersatz_g: { rote_linsen: 100 } },
      { platz: 'gemuese', aus: GEMUESE, g: 300, flexibel: true },
      { platz: 'tomaten', aus: TOMATEN_GEHACKT, g: 200, optional: true },
      BEILAGE,
    ],
    beschreibung: (a) => `Linsen und Gemüse${a.hat('tomaten') ? ' mit Tomaten' : ''}, Zwiebel und Möhre – ein schneller Eintopf.`,
    schritte: (a) => {
      const tomaten = a.hat('tomaten') ? `, ${a.im('tomaten')}` : '';
      return [
        `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} und ${a.stueck(1, 'Möhre', 'Möhren')} klein schneiden und in etwas Öl andünsten.`,
        ...(a.ist('linsen', 'rote_linsen')
          ? [`${a.name('linsen')}${tomaten} und ${a.ml(700)} Wasser zugeben und 15 Minuten köcheln lassen.`, `${a.name('gemuese')} zugeben und weitere 8–10 Minuten garen.`]
          : [`${a.name('gemuese')}${tomaten} und ${a.ml(500)} Wasser zugeben und 8 Minuten köcheln lassen.`, `${a.name('linsen')} zugeben und 5 Minuten mitgaren.`]),
        `${ABSCHMECKEN}.`,
        ...mitBeilage(a),
      ];
    },
    eigenschaften: (a) => e('eintopf', 'linsen', a.hat('beilage') ? 'brot' : 'keiner', 'topf', { konsistenz: 'suppig' }),
  },
  {
    id: 'linsen-tomaten-reis', nr: 18, name: 'Linsen-Tomaten-Reis', emoji: '🍚', portionen: 2, zeit_min: 25,
    zutaten: [
      { platz: 'reis', aus: REIS, g: 150 },
      { platz: 'linsen', aus: ['gekochte_linsen'], g: 250 },
      { platz: 'tomaten', aus: ['tomaten_gemuese_basis', 'passierte_tomaten', 'gehackte_tomaten'], g: 375 },
    ],
    beschreibung: () => 'Linsen in Tomatensoße mit Zwiebel, unter Reis gehoben.',
    schritte: (a) => [
      `${a.name('reis')} nach Packung kochen.`,
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden und in etwas Öl dünsten.`,
      `${a.name('tomaten')} und ${a.im('linsen')} zugeben und 8–10 Minuten köcheln lassen.`,
      `${ABSCHMECKEN} und den Reis unterheben.`,
    ],
    eigenschaften: () => e('reisgericht', 'linsen', 'reis', 'topf'),
  },
  {
    id: 'gemuese-kokos-curry', nr: 19, name: 'Gemüse-Kokos-Curry mit Reis', emoji: '🍛', portionen: 2, zeit_min: 25,
    zutaten: [
      { platz: 'reis', aus: REIS, g: 150 },
      { platz: 'kokosmilch', aus: ['kokosmilch'], g: 400 },
      { platz: 'gemuese', aus: GEMUESE, g: 400, flexibel: true },
      { platz: 'kichererbsen', aus: ['gekochte_kichererbsen'], g: 200, optional: true },
    ],
    beschreibung: (a) => `Gemüse${a.hat('kichererbsen') ? ' und Kichererbsen' : ''} in Kokosmilch mit Zwiebel, Knoblauch und Möhre, dazu Reis.`,
    schritte: (a) => [
      `${a.name('reis')} nach Packung kochen.`,
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')}, etwas Knoblauch und ${a.stueck(1, 'Möhre', 'Möhren')} klein schneiden und in etwas Öl andünsten.`,
      `${a.name('gemuese')}${a.hat('kichererbsen') ? ` und ${a.im('kichererbsen')}` : ''} zugeben und 5 Minuten mitdünsten.`,
      `${a.name('kokosmilch')} angießen und 10 Minuten köcheln lassen.`,
      'Mit Salz und nach Geschmack Currypulver abschmecken und mit dem Reis servieren.',
    ],
    eigenschaften: () => e('curry', 'gemuese', 'reis', 'topf', { geschmack: 'cremig', schaerfe: 1, konsistenz: 'cremig', gewuerzrichtung: 'indisch' }),
  },
  {
    id: 'rote-linsen-kokos-suppe', nr: 20, name: 'Rote-Linsen-Kokos-Suppe', emoji: '🥣', portionen: 2, zeit_min: 25,
    zutaten: [
      { platz: 'linsen', aus: ['rote_linsen'], g: 120 },
      { platz: 'kokosmilch', aus: ['kokosmilch'], g: 200 },
      { platz: 'tomaten', aus: TOMATEN_GEHACKT, g: 200, optional: true },
      BEILAGE,
    ],
    beschreibung: (a) => `Rote Linsen mit Kokosmilch${a.hat('tomaten') ? ', Tomaten' : ''}, Zwiebel, Möhre und Knoblauch – cremig und wärmend.`,
    schritte: (a) => [
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')}, ${a.stueck(1, 'Möhre', 'Möhren')} und etwas Knoblauch klein schneiden und in etwas Öl andünsten.`,
      `${a.name('linsen')}${a.hat('tomaten') ? `, ${a.im('tomaten')}` : ''} und ${a.ml(500)} Wasser zugeben und 15 Minuten köcheln lassen, bis die Linsen zerfallen.`,
      `${a.name('kokosmilch')} einrühren, kurz aufkochen und nach Wunsch pürieren.`,
      `${ABSCHMECKEN}.`,
      ...mitBeilage(a),
    ],
    eigenschaften: (a) => e('suppe', 'linsen', a.hat('beilage') ? 'brot' : 'keiner', 'topf', { geschmack: 'cremig', konsistenz: 'suppig', gewuerzrichtung: 'indisch' }),
  },
  {
    id: 'kartoffel-gemuese-pfanne', nr: 21, name: 'Kartoffel-Gemüse-Pfanne', emoji: '🥔', portionen: 2, zeit_min: 30,
    zutaten: [{ platz: 'kartoffeln', aus: KARTOFFELN, g: 500 }, { platz: 'gemuese', aus: GEMUESE, g: 300, flexibel: true }, KAESE(40)],
    beschreibung: (a) => `Kartoffeln goldbraun gebraten, mit Gemüse und Zwiebel${a.hat('kaese') ? ' und etwas Käse' : ''}.`,
    schritte: (a) => [
      `${a.name('kartoffeln')} in Salzwasser 15 Minuten vorgaren, abgießen und in Scheiben oder Würfel schneiden.`,
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden. Die Kartoffeln in etwas Öl 8–10 Minuten goldbraun braten.`,
      `Die Zwiebel und ${a.im('gemuese')} zugeben und weitere 6–8 Minuten braten.`,
      `${ABSCHMECKEN}.`,
      ...mitKaese(a, (k) => `${k} darüberstreuen und kurz schmelzen lassen.`),
    ],
    eigenschaften: () => e('pfanne', 'kartoffel', 'kartoffel', 'pfanne', { konsistenz: 'knusprig', gewuerzrichtung: 'deutsch' }),
  },
  {
    id: 'kartoffel-moehren-suppe', nr: 22, name: 'Kartoffel-Möhren-Suppe', emoji: '🥣', portionen: 2, zeit_min: 30,
    zutaten: [{ platz: 'kartoffeln', aus: KARTOFFELN, g: 400 }, BEILAGE],
    beschreibung: () => 'Kartoffeln und Möhren mit Zwiebel weich gekocht und cremig püriert.',
    schritte: (a) => [
      `${a.name('kartoffeln')} schälen und würfeln, ${a.stueck(2, 'Möhre', 'Möhren')} und ${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} klein schneiden.`,
      `Alles in etwas Öl kurz andünsten, ${a.ml(800)} Wasser angießen und 20 Minuten köcheln lassen.`,
      `Pürieren. ${ABSCHMECKEN}.`,
      ...mitBeilage(a),
    ],
    eigenschaften: (a) => e('suppe', 'kartoffel', a.hat('beilage') ? 'brot' : 'keiner', 'topf', { geschmack: 'cremig', konsistenz: 'suppig', gewuerzrichtung: 'deutsch' }),
  },
  {
    id: 'soja-bolognese', nr: 23, name: 'Soja-Bolognese mit Nudeln', emoji: '🍝', portionen: 2, zeit_min: 25,
    zutaten: [
      { platz: 'nudeln', aus: NUDELN, g: 200 },
      { platz: 'soja', aus: ['sojagranulat'], g: 60 },
      { platz: 'tomaten', aus: TOMATEN_PASSIERT, g: 500 },
      KAESE(40),
    ],
    beschreibung: () => 'Sojagranulat kräftig angebraten und in Tomatensoße mit Zwiebel und Möhre geköchelt – dazu Nudeln.',
    schritte: (a) => [
      `${a.name('soja')} nach Packungsanweisung mit heißem Wasser quellen lassen und abgießen.`,
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} und ${a.stueck(1, 'Möhre', 'Möhren')} klein schneiden und in etwas Öl anbraten. Das Sojagranulat zugeben und kräftig mitbraten.`,
      `${a.name('tomaten')} zugeben und 10 Minuten köcheln lassen. ${ABSCHMECKEN}.`,
      `In der Zwischenzeit ${a.im('nudeln')} nach Packung kochen und mit der Soße servieren.`,
      ...mitKaese(a, (k) => `${k} darüberreiben.`),
    ],
    eigenschaften: () => e('pasta', 'soja', 'pasta', 'topf', { gewuerzrichtung: 'italienisch' }),
  },
  {
    id: 'kichererbsen-gemuese-pfanne', nr: 24, name: 'Kichererbsen-Gemüse-Pfanne mit Reis', emoji: '🥘', portionen: 2, zeit_min: 25,
    zutaten: [
      { platz: 'reis', aus: REIS, g: 150 },
      { platz: 'kichererbsen', aus: ['gekochte_kichererbsen'], g: 225 },
      { platz: 'gemuese', aus: GEMUESE, g: 300, flexibel: true },
    ],
    beschreibung: () => 'Kichererbsen und Gemüse mit Zwiebel und Knoblauch gebraten, dazu Reis.',
    schritte: (a) => [
      `${a.name('reis')} nach Packung kochen.`,
      `${a.stueck(0.5, 'Zwiebel', 'Zwiebeln')} und etwas Knoblauch klein schneiden und in etwas Öl anbraten.`,
      `${a.name('kichererbsen')} und ${a.im('gemuese')} zugeben und 8–10 Minuten braten.`,
      `${ABSCHMECKEN} und mit dem Reis servieren.`,
    ],
    eigenschaften: () => e('pfanne', 'kichererbsen', 'reis', 'pfanne'),
  },
  {
    id: 'pizza-aus-dem-ofen', nr: 25, name: (a) => `${a.name('pizza')} aus dem Ofen`, emoji: '🍕', portionen: 1, zeit_min: 20,
    nur_wenn_da: 'pizza',
    zutaten: [{ platz: 'pizza', aus: ['margherita_pizza'], g: 1 }],
    beschreibung: (a) => `${a.name('pizza')} aus dem Gefrierfach – nur noch backen.`,
    schritte: (a) => [
      'Den Ofen nach Packungsangabe vorheizen, sonst auf 220 °C.',
      `${a.name('pizza')} gefroren auf ein Blech legen und 12–15 Minuten backen, bis der Rand goldbraun ist.`,
    ],
    eigenschaften: () => e('pizza', 'pizza', 'sonstiges', 'ofen', { konsistenz: 'knusprig', gewuerzrichtung: 'italienisch' }),
  },
];

// ───────── Belegen: Rezept + Vorrat → Rohvorschlag ─────────

type Wahl = { z: SnapshotZutat; baustein: Grundbaustein };

const dringend = (z: SnapshotZutat) => (z.geoeffnet || z.aufgetaut ? 3 : z.bald_verbrauchen ? 2 : z.rest ? 1 : 0);

/** Menge in der Einheit der Sorte (g/ml genau, Stück und Portionen auf ganze gerundet). */
function inEinheit(gramm: number, z: SnapshotZutat, b: Grundbaustein): number {
  if (z.einheit === 'g' || z.einheit === 'ml') return Math.max(1, Math.round(gramm));
  const proEinheit = z.einheit === 'stueck' ? b.stueck_g : (z.groesse_g && z.groesse_g > 0 ? z.groesse_g : b.pro_person_g);
  return Math.max(1, Math.round(gramm / Math.max(1, proEinheit)));
}

/**
 * Anzeige im Rezepttext: „Rote Linsen, trocken“ → „Rote Linsen“, „Kichererbsen (Dose)“ → „Kichererbsen“;
 * genannte Zutaten ohne Mengenangabe: „eine halbe Dose Mais“ → „Mais“, „2 Eier“ → „Eier“.
 */
function anzeigeName(z: SnapshotZutat): string {
  let n = z.name.replace(/\s*\([^)]*\)/g, '').replace(/,\s*(trocken|getrocknet|ungeöffnet|tk|tiefgekühlt)\s*$/i, '').trim();
  if (z.quelle === 'kuehlschrank') {
    n = restName(n).replace(/^\d+([.,]\d+)?\s*(g|kg|ml|l|stück|stueck|dosen?|packungen?|gläser|glas)?\s+/i, '').trim();
  }
  n = n || z.name;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** Im Satz: ein vorangestelltes Adjektiv klein („Passierte Tomaten“ → „passierte Tomaten“). */
function imSatz(name: string): string {
  const [erstes, ...rest] = name.split(' ');
  return rest.length && /^[A-ZÄÖÜ][a-zäöüß]+e$/.test(erstes) && /^[A-ZÄÖÜ]/.test(rest[0]) ? `${erstes.toLowerCase()} ${rest.join(' ')}` : name;
}

const halbe = (x: number) => Math.round(x * 2) / 2;
function stueckText(anzahl: number, einzahl: string, mehrzahl: string): string {
  const n = Math.max(0.5, halbe(anzahl));
  const ganz = Math.floor(n);
  const zahl = n === 0.5 ? '½' : n % 1 ? `${ganz}½` : String(ganz);
  return `${zahl} ${n <= 1 ? einzahl : mehrzahl}`;
}

export type Belegt = {
  roh: RohGericht;
  /** Plätze, für die nichts da ist */
  fehlend: string[];
};

/** Belegt ein Grundrezept mit dem Vorrat. null = nicht sinnvoll (z. B. keine Pizza da). */
export function belegeGrundrezept(r: Grundrezept, snapshot: Snapshot, personen: number): Belegt | null {
  const faktor = Math.max(1, personen) / r.portionen;
  const vorhanden = snapshot.zutaten.filter((z) => z.quelle === 'bestand' || z.quelle === 'kuehlschrank');
  const wahl = new Map<string, Wahl>();
  const benutzt = new Set<string>();
  const zutaten: RohZutat[] = [];
  const fehlt: RohFehlt[] = [];
  const fehlend: string[] = [];
  const weggelassen = new Set<string>();

  r.zutaten.forEach((zt, i) => {
    // Schon von einer gewählten Sorte mit abgedeckt (Linsen-Bolognese-Basis = Linsen + Tomaten)?
    const deckend = [...wahl.values()].find((w) => w.baustein.deckt?.some((d) => zt.aus.includes(d)));
    if (deckend) {
      wahl.set(zt.platz, deckend);
      return;
    }
    const spaeter = r.zutaten.slice(i + 1);
    const bedarfG = (b: Grundbaustein): number => {
      if (b.kategorie === 'komplett') return personen;
      if (b.id === zt.aus[0]) return zt.g * faktor;
      if (zt.ersatz_g?.[b.id] !== undefined) return zt.ersatz_g[b.id] * faktor;
      // deckt die Sorte weitere Zutaten mit, ersetzt sie auch deren Menge
      const mit = spaeter.filter((s) => b.deckt?.some((d) => s.aus.includes(d))).reduce((sum, s) => sum + s.g, 0);
      return mit > 0 ? (zt.g + mit) * faktor : b.pro_person_g * personen;
    };
    const kandidaten = vorhanden
      .filter((z) => !benutzt.has(z.id))
      .map((z) => {
        const baustein = erfuellt(z, zt.aus);
        if (!baustein) return null;
        const bedarf = baustein.kategorie !== 'komplett' ? inEinheit(bedarfG(baustein), z, baustein)
          : z.einheit === 'portion' || z.einheit === 'stueck' ? personen : personen * (z.groesse_g || 350);
        const genug = z.anzahl === null || z.anzahl >= (zt.flexibel ? bedarf / 2 : bedarf);
        const deckt = spaeter.filter((s) => baustein.deckt?.some((d) => s.aus.includes(d))).length;
        return { z, baustein, bedarf, genug, deckt, prio: zt.aus.indexOf(baustein.id) };
      })
      .filter((k): k is NonNullable<typeof k> => k !== null)
      .sort((a, b) => Number(b.genug) - Number(a.genug) || b.deckt - a.deckt || dringend(b.z) - dringend(a.z)
        || a.prio - b.prio || Number(a.z.quelle === 'kuehlschrank') - Number(b.z.quelle === 'kuehlschrank') || a.z.name.localeCompare(b.z.name));
    const beste = kandidaten[0];

    if (!beste) {
      if (zt.optional) {
        weggelassen.add(zt.platz);
        return;
      }
      const b = grundbaustein(zt.aus[0]);
      fehlend.push(zt.platz);
      const menge = b.kategorie === 'komplett' ? null : Math.max(5, Math.round((zt.g * faktor) / 5) * 5);
      fehlt.push({ name: b.name, menge, einheit: menge === null ? null : b.fluessig ? 'ml' : 'g' });
      return;
    }
    wahl.set(zt.platz, { z: beste.z, baustein: beste.baustein });
    benutzt.add(beste.z.id);
    if (beste.z.quelle !== 'bestand') {
      zutaten.push({ id: beste.z.id });
      return;
    }
    // Extras und Gemüse (ab der Hälfte): was da ist, auch wenn es etwas weniger ist; sonst die volle Menge (der Rest „fehlt“)
    const weniger = zt.optional || (zt.flexibel && beste.genug);
    const menge = weniger && beste.z.anzahl !== null ? Math.min(beste.bedarf, beste.z.anzahl) : beste.bedarf;
    zutaten.push({ id: beste.z.id, menge, einheit: beste.z.einheit });
  });

  if (r.nur_wenn_da && !wahl.has(r.nur_wenn_da)) return null;

  const auswahl: Auswahl = {
    personen,
    hat: (p) => wahl.has(p),
    name: (p) => {
      const w = wahl.get(p);
      if (w) return anzeigeName(w.z);
      if (weggelassen.has(p)) return '';
      const zt = r.zutaten.find((x) => x.platz === p);
      return zt ? grundbaustein(zt.aus[0]).name : '';
    },
    im: (p) => imSatz(auswahl.name(p)),
    ist: (p, id) => wahl.get(p)?.baustein.id === id,
    gleich: (a, b) => !!wahl.get(a) && wahl.get(a) === wahl.get(b),
    stueck: (anzahl, einzahl, mehrzahl) => stueckText(anzahl * faktor, einzahl, mehrzahl),
    ml: (ml) => {
      const x = Math.max(50, Math.round((ml * faktor) / 50) * 50);
      return x >= 1000 ? `etwa ${String(x / 1000).replace('.', ',')} l` : `etwa ${x} ml`;
    },
  };

  // Immer da: Grundausstattung, die die Schritte nennen
  for (const id of ['g-zwiebeln', 'g-moehren', 'g-knoblauch', 'g-oel', 'g-salz', 'g-pfeffer', 'g-wasser']) {
    if (snapshot.zutaten.some((z) => z.id === id)) zutaten.push({ id });
  }

  const name = typeof r.name === 'function' ? r.name(auswahl) : r.name;
  const genutzt = [...new Set([...wahl.values()].map((w) => anzeigeName(w.z)))];
  return {
    fehlend,
    roh: {
      name,
      emoji: r.emoji,
      beschreibung: r.beschreibung(auswahl),
      zutaten,
      fehlt,
      zeit_min: r.zeit_min,
      schritte: r.schritte(auswahl),
      begruendung: genutzt.length ? `Grundrezept mit ${genutzt.join(', ')} aus deinem Vorrat.` : 'Grundrezept aus dem Food-Baukasten.',
      eigenschaften: r.eigenschaften(auswahl),
    },
  };
}

// ───────── Grundrezepte für den Vorrat ─────────

export type GrundrezeptStand = { rezept: Grundrezept; gericht: Gericht; kochbar: boolean };

/**
 * Alle Grundrezepte, geprüft gegen den Vorrat: direkt kochbar (nichts fehlt) oder mit höchstens drei
 * fehlenden Zutaten. Reihenfolge wie in der Sammlung.
 */
export function grundrezepteFuer(snapshot: Snapshot, optionen: Optionen, neueId: () => string = uuid): GrundrezeptStand[] {
  const ergebnis: GrundrezeptStand[] = [];
  for (const rezept of GRUNDREZEPTE) {
    const b = belegeGrundrezept(rezept, snapshot, optionen.personen);
    if (!b) continue;
    const p = pruefeGericht(b.roh, snapshot, optionen, neueId());
    if (!p.ok) continue;
    p.wert.grundrezept = rezept.id;
    ergebnis.push({ rezept, gericht: p.wert, kochbar: p.wert.fehlt.length === 0 });
  }
  return ergebnis;
}

/**
 * Reihenfolge zum Vorschlagen: Dringendes zuerst (geöffnet, bald ablaufend …), Vorlieben der Session,
 * abwechslungsreich – Gesehenes und Abgelehntes fällt weg. Bei „Reste“ nur, was etwas rettet.
 */
export function ordneGrundrezepte(
  gerichte: Gericht[],
  a: Pick<KiAnfrage, 'snapshot' | 'optionen' | 'gesehen' | 'feedback' | 'modus' | 'favoriten'>,
): Gericht[] {
  const l = berechneLeitplanken(a.feedback, a.modus, a.gesehen);
  const gesehen = new Set(a.gesehen.map((g) => normalisiere(g.name)));
  const rest = gerichte
    .filter((g) => !gesehen.has(normalisiere(g.name)) && !verletztAusschluss(kurz(g), l))
    .filter((g) => a.modus.art !== 'reste' || g.rettet.length > 0)
    .map((g) => ({ g, wert: bewerte(g, a.optionen, a.gesehen, l, STANDARD_GEWICHTE, { snapshot: a.snapshot, favoriten: a.favoriten ?? [] }) }));
  const geordnet: Gericht[] = [];
  while (rest.length) {
    const schon = geordnet.map(kurz);
    let beste = 0;
    let besterWert = -Infinity;
    rest.forEach((x, i) => {
      const w = x.wert - STANDARD_GEWICHTE.abwechslung * wiederholung(kurz(x.g), schon);
      if (w > besterWert) {
        besterWert = w;
        beste = i;
      }
    });
    const [x] = rest.splice(beste, 1);
    x.g.bewertung = Math.round(besterWert * 1000) / 1000;
    geordnet.push(x.g);
  }
  return geordnet;
}

/** Direkt kochbare Grundrezepte in Vorschlags-Reihenfolge. */
export function kochbareGrundrezepte(a: Pick<KiAnfrage, 'snapshot' | 'optionen' | 'gesehen' | 'feedback' | 'modus' | 'favoriten'>, neueId: () => string = uuid): Gericht[] {
  const alle = grundrezepteFuer(a.snapshot, a.optionen, neueId).filter((s) => s.kochbar).map((s) => s.gericht);
  return ordneGrundrezepte(alle, a);
}

/**
 * Grundrezepte als Anbieter – für die Wochenplanung (erzeugeWoche prüft gegen den RESTLICHEN Vorrat).
 * Liefert kochbare zuerst, dann solche mit wenig Fehlendem. Die Herkunft merkt er sich pro Name.
 */
export function grundrezeptAnbieter(): KiAnbieter & { herkunft: Map<string, string> } {
  const herkunft = new Map<string, string>();
  return {
    name: 'grundrezepte',
    herkunft,
    async vorschlagen(a: KiAuftrag): Promise<RohAntwort> {
      const stand = grundrezepteFuer(a.snapshot, a.optionen);
      const sortiert = [...stand].sort((x, y) => Number(y.kochbar) - Number(x.kochbar) || x.rezept.nr - y.rezept.nr);
      const vorschlaege: RohGericht[] = [];
      for (const s of sortiert) {
        const b = belegeGrundrezept(s.rezept, a.snapshot, a.optionen.personen);
        if (!b) continue;
        herkunft.set(normalisiere(b.roh.name ?? ''), s.rezept.id);
        vorschlaege.push(b.roh);
      }
      return { vorschlaege, einkauf: null, baustein_idee: null };
    },
  };
}
