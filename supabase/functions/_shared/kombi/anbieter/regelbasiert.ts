// Regelbasierter Anbieter ohne KI: kombiniert Bausteine nach dem Kombi-Farbsystem.
// Deterministisch (gut für Tests) und kostenlos – Demo-Modus, solange keine KI eingerichtet ist.
// Liefert dieselbe Rohantwort wie eine KI und durchläuft dieselbe Prüfung.
// Namen und Beschreibungen entstehen nur aus dem, was bekannt ist (Sortennamen, Rolle, Booster) –
// es wird nichts dazuerfunden.
import type {
  Eigenschaften, GerichtKurz, Gerichtstyp, Gewuerzrichtung, KiAnbieter, KiAuftrag, RohAntwort,
  RohGericht, Sattmacher, SnapshotZutat,
} from '../typen.ts';
import { aehnlichkeit, DUPLIKAT_SCHWELLE } from '../aehnlichkeit.ts';
import { verletztAusschluss } from '../praeferenz.ts';
import { verletztVielfalt, vielfaltSperre } from '../vielfalt.ts';
import { kurzname, normalisiere, restName } from '../text.ts';

type Kandidat = { roh: RohGericht; kurz: GerichtKurz; punkte: number };

function sattmacherArt(z: SnapshotZutat | null): Sattmacher {
  if (!z) return 'keiner';
  const n = normalisiere(z.name);
  if (/wrap|tortilla/.test(n)) return 'wrap';
  if (/broetchen|brot|toast|baguette/.test(n)) return 'brot';
  if (/pasta|nudel|spaghetti|penne|fusilli/.test(n)) return 'pasta';
  if (/reis/.test(n)) return 'reis';
  if (/kartoffel/.test(n)) return 'kartoffel';
  if (/couscous|bulgur/.test(n)) return 'couscous';
  return 'sonstiges';
}

function richtung(booster: SnapshotZutat | null, basis: SnapshotZutat | null): Gewuerzrichtung {
  const n = normalisiere(`${booster?.name ?? ''} ${basis?.name ?? ''}`);
  if (/ital/.test(n)) return 'italienisch';
  if (/indi|curry/.test(n)) return 'indisch';
  if (/mexi|chili/.test(n)) return 'mexikanisch';
  if (/asia|thai|soja/.test(n)) return 'asiatisch';
  if (/orient|harissa/.test(n)) return 'orientalisch';
  if (/tomate/.test(n)) return 'italienisch';
  return 'neutral';
}

function gerichtstyp(satt: Sattmacher, basis: SnapshotZutat | null, protein: SnapshotZutat | null): Gerichtstyp {
  const b = normalisiere(basis?.name ?? '');
  const p = normalisiere(protein?.name ?? '');
  if (satt === 'wrap') return 'wrap';
  if (satt === 'brot') return /patty|burger/.test(p) ? 'burger' : 'toast';
  if (satt === 'pasta') return 'pasta';
  if (satt === 'reis') return /curry/.test(b) ? 'curry' : 'reisgericht';
  if (satt === 'kartoffel') return 'pfanne';
  if (satt === 'couscous') return 'bowl';
  if (/curry/.test(b)) return 'curry';
  return basis ? 'eintopf' : 'pfanne';
}

const EMOJI: Record<string, string> = {
  wrap: '🌯', toast: '🥪', burger: '🍔', pasta: '🍝', curry: '🍛', pfanne: '🥘', bowl: '🥗',
  eintopf: '🍲', reisgericht: '🍚', suppe: '🥣', pizza: '🍕', auflauf: '🫕', aufwaermen: '🍽️',
};

// ───────── Namen: kurz, natürlich, nur aus Bekanntem ─────────

type Genus = 'f' | 'm' | 'n';
const TYP: Record<string, { wort: string; genus: Genus }> = {
  wrap: { wort: 'Wrap', genus: 'm' }, toast: { wort: 'Toast', genus: 'm' }, burger: { wort: 'Burger', genus: 'm' },
  pasta: { wort: 'Pasta', genus: 'f' }, curry: { wort: 'Curry', genus: 'n' }, pfanne: { wort: 'Pfanne', genus: 'f' },
  bowl: { wort: 'Bowl', genus: 'f' }, eintopf: { wort: 'Eintopf', genus: 'm' }, reisgericht: { wort: 'Reispfanne', genus: 'f' },
};
const endung = (g: Genus) => (g === 'f' ? 'e' : g === 'm' ? 'er' : 'es');

/** Adjektiv aus Booster oder Basis – nur wenn der Name es hergibt. */
function adjektiv(booster: SnapshotZutat | null, basis: SnapshotZutat | null): string | null {
  const b = normalisiere(booster?.name ?? '');
  if (/ital/.test(b)) return 'Italienisch';
  if (/mexi/.test(b)) return 'Mexikanisch';
  if (/indi/.test(b)) return 'Indisch';
  if (/tomat/.test(normalisiere(basis?.name ?? ''))) return 'Tomatig';
  return null;
}

function gerichtName(
  typ: Gerichtstyp, protein: SnapshotZutat | null, basis: SnapshotZutat | null, gemuese: SnapshotZutat | null,
  booster: SnapshotZutat | null, rest: SnapshotZutat | null, variante: number,
): string {
  const t = TYP[typ] ?? TYP.pfanne;
  const haupt = kurzname((protein ?? gemuese ?? basis)!.name);
  const zweit = protein && gemuese ? kurzname(gemuese.name) : null;
  const adj = adjektiv(booster, basis);
  const kokos = /kokos/i.test(basis?.name ?? '');
  const mitRest = rest ? ` mit ${restName(rest.name)}` : '';
  const vorlagen = [
    adj ? `${adj}${endung(t.genus)} ${haupt}-${t.wort}${mitRest}` : null,
    typ === 'wrap' || typ === 'toast' ? `Knusper-${t.wort} mit ${haupt}${rest ? ` & ${restName(rest.name)}` : ''}` : null,
    kokos ? `${haupt}-${t.wort} mit Kokos` : null,
    zweit ? `${haupt}-${t.wort} mit ${zweit}` : null,
    `${haupt}-${t.wort}${mitRest}`,
  ].filter((v): v is string => !!v);
  return vorlagen[variante % vorlagen.length];
}

function beschreibungFuer(typ: Gerichtstyp, teile: SnapshotZutat[], satt: SnapshotZutat | null, rest: SnapshotZutat | null): string {
  const namen = teile.map((z) => z.name);
  const liste = namen.length > 1 ? `${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]}` : namen[0];
  const zusatz = rest ? `, dazu ${restName(rest.name)} aus dem Kühlschrank` : '';
  if (typ === 'wrap' || typ === 'toast' || typ === 'burger') {
    return `${liste}, heiß gemacht und in ${satt?.name ?? 'Brot'} gepackt, das kurz in der Pfanne knusprig wird${zusatz}.`;
  }
  if (satt) return `${liste} in der Pfanne erhitzt und mit ${satt.name} vermischt${zusatz}.`;
  return `${liste}, zusammen in einem Topf erhitzt und kräftig abgeschmeckt${zusatz}.`;
}

function schritteFuer(typ: Gerichtstyp, teile: string[], satt: SnapshotZutat | null): string[] {
  const belag = teile.join(', ');
  const s: string[] = [];
  if (satt && /pasta|reis/.test(sattmacherArt(satt))) s.push(`${satt.name} nach Packung kochen.`);
  s.push(`${belag} in einer Pfanne auftauen und erhitzen.`);
  if (typ === 'wrap' || typ === 'toast' || typ === 'burger') s.push(`${satt?.name ?? 'Brot'} kurz anrösten und füllen.`);
  else if (satt) s.push(`Mit ${satt.name} mischen, mit Salz und Pfeffer abschmecken.`);
  else s.push('Mit Salz und Pfeffer abschmecken.');
  return s;
}

const halbe = (personen: number) => Math.max(1, Math.ceil(personen / 2));

/** Punkte für die Dringlichkeit: geöffnet > bald > Rest */
const dringend = (z: SnapshotZutat) => (z.geoeffnet ? 4 : z.bald_verbrauchen ? 3 : z.rest ? 2 : 0);

function komplettTyp(z: SnapshotZutat): Gerichtstyp {
  const n = normalisiere(z.name);
  if (/pizza/.test(n)) return 'pizza';
  if (/suppe/.test(n)) return 'suppe';
  if (/eintopf|chili/.test(n)) return 'eintopf';
  if (/lasagne|auflauf|gratin/.test(n)) return 'auflauf';
  if (/curry/.test(n)) return 'curry';
  if (/burrito|wrap/.test(n)) return 'wrap';
  if (/reis/.test(n)) return 'reisgericht';
  return 'aufwaermen';
}

export function regelbasiert(): KiAnbieter {
  return {
    name: 'regelbasiert',
    async vorschlagen(a: KiAuftrag): Promise<RohAntwort> {
      const bestand = a.snapshot.zutaten.filter((z) => z.quelle === 'bestand');
      const kuehlschrank = a.snapshot.zutaten.filter((z) => z.quelle === 'kuehlschrank');
      const nach = (farbe: string) =>
        bestand
          .filter((z) => z.farbe === farbe && z.art !== 'komplettgericht')
          .sort((x, y) => dringend(y) - dringend(x) || x.name.localeCompare(y.name));
      const p = a.optionen.personen;

      const proteine = [...nach('braun'), null];
      const basen = [...nach('rot'), null];
      const gemuese = [...nach('gruen'), null];
      const satts = [...nach('gelb'), null];
      const booster = nach('weiss');
      const kandidaten: Kandidat[] = [];

      for (const pr of proteine) for (const ba of basen) for (const ge of gemuese) for (const sa of satts) {
        const belag = [pr, ba, ge].filter((x): x is SnapshotZutat => x !== null);
        if (belag.length < 2) continue;
        const satt = sattmacherArt(sa);
        const typ = gerichtstyp(satt, ba, pr);
        const boost = booster.find((b) => richtung(b, null) === richtung(null, ba)) ?? booster[0] ?? null;
        const rest = kuehlschrank[kandidaten.length % Math.max(1, kuehlschrank.length)] ?? null;
        const name = gerichtName(typ, pr, ba, ge, boost, rest, kandidaten.length);
        const hauptzutat = kurzname((pr ?? ge ?? ba)!.name);

        const zutaten: RohGericht['zutaten'] = belag.map((z) => ({ id: z.id, portionen: halbe(p) }));
        if (sa) zutaten.push({ id: sa.id, portionen: p });
        if (boost) zutaten.push({ id: boost.id, portionen: 1 });
        if (rest) zutaten.push({ id: rest.id });
        zutaten.push({ id: 'g-salz' });

        const eigenschaften: Eigenschaften = {
          gerichtstyp: typ,
          hauptzutat: normalisiere(hauptzutat),
          geschmack: ba && /curry|kokos/i.test(ba.name) ? 'cremig' : 'herzhaft',
          schaerfe: richtung(boost, ba) === 'mexikanisch' ? 2 : richtung(boost, ba) === 'indisch' ? 1 : 0,
          konsistenz: typ === 'eintopf' || typ === 'curry' ? 'cremig' : typ === 'wrap' || typ === 'toast' ? 'knusprig' : 'stueckig',
          sattmacher: satt,
          gewuerzrichtung: richtung(boost, ba),
          zubereitung: typ === 'eintopf' || typ === 'curry' ? 'topf' : 'pfanne',
          temperatur: 'warm',
        };
        const genutzt = [...belag, ...(sa ? [sa] : []), ...(rest ? [rest] : [])];
        const genug = genutzt.every((z) => z.anzahl === null || z.anzahl >= (z === sa ? p : halbe(p)) * z.portion_menge);
        kandidaten.push({
          roh: {
            name,
            emoji: EMOJI[typ] ?? '🍽️',
            beschreibung: beschreibungFuer(typ, belag, sa, rest),
            zutaten,
            fehlt: [],
            zeit_min: 10 + (sa && /pasta|reis/.test(satt) ? 8 : 0) + (ge ? 2 : 0),
            schritte: schritteFuer(typ, belag.map((z) => z.name), sa),
            begruendung: `Kombiniert ${genutzt.map((z) => z.name).join(', ')} aus eurem Vorrat.`,
            eigenschaften,
          },
          kurz: { name, eigenschaften, zutaten: genutzt.map((z) => z.name) },
          punkte: genutzt.reduce((s, z) => s + dringend(z), 0) + (sa ? 2 : 0) + (genug ? 2 : 0) + genutzt.length,
        });
      }

      // Komplettgerichte: pur („heute einfach …“) oder mit schlichter Beilage (Suppe + Brötchen).
      const brot = nach('gelb').find((z) => sattmacherArt(z) === 'brot') ?? null;
      const komplettNamen = new Set(bestand.filter((z) => z.art === 'komplettgericht').map((z) => z.name));
      for (const k of bestand.filter((z) => z.art === 'komplettgericht')) {
        const typ = komplettTyp(k);
        const eigenschaften: Eigenschaften = {
          gerichtstyp: typ, hauptzutat: normalisiere(kurzname(k.name)), geschmack: 'herzhaft',
          schaerfe: 0, konsistenz: typ === 'suppe' ? 'suppig' : 'fest', sattmacher: 'sonstiges', gewuerzrichtung: 'neutral',
          zubereitung: typ === 'pizza' || typ === 'auflauf' ? 'ofen' : 'aufwaermen', temperatur: 'warm',
        };
        const reicht = k.anzahl !== null && k.anzahl >= p * k.portion_menge;
        const kurzName = kurzname(k.name);
        const pur = typ === 'pizza' ? `${kurzName}-Abend` : `Heute einfach ${k.name}`;
        kandidaten.push({
          roh: {
            name: pur, emoji: EMOJI[typ] ?? '🍽️',
            beschreibung: `${k.name} ist schon fertig – nur warm machen, fertig ist das Abendessen.`,
            zutaten: [{ id: k.id, portionen: p }], fehlt: [], zeit_min: typ === 'pizza' || typ === 'auflauf' ? 20 : 10,
            schritte: [`${k.name} ${typ === 'pizza' || typ === 'auflauf' ? 'im Ofen' : 'im Topf oder in der Pfanne'} aufwärmen.`],
            begruendung: 'Fertig vorgekocht – heute ohne Aufwand.', eigenschaften,
          },
          kurz: { name: pur, eigenschaften, zutaten: [k.name] },
          punkte: dringend(k) * 2 + (reicht ? 3 : -3),
        });
        if (brot && (typ === 'suppe' || typ === 'eintopf')) {
          const name = `${k.name} mit Röstbrötchen`;
          const e2: Eigenschaften = { ...eigenschaften, sattmacher: 'brot', konsistenz: 'suppig' };
          kandidaten.push({
            roh: {
              name, emoji: '🥣',
              beschreibung: `${k.name}, dazu ${brot.name}, die in der Pfanne kurz knusprig geröstet werden.`,
              zutaten: [{ id: k.id, portionen: p }, { id: brot.id, portionen: p }], fehlt: [], zeit_min: 12,
              schritte: [`${k.name} im Topf erhitzen.`, `${brot.name} aufbacken oder in der Pfanne rösten.`],
              begruendung: 'Fertig vorgekocht, mit Beilage aus dem Vorrat.', eigenschaften: e2,
            },
            kurz: { name, eigenschaften: e2, zutaten: [k.name, brot.name] },
            punkte: dringend(k) * 2 + (reicht ? 3.5 : -3),
          });
        }
      }

      // Auswählen: Leitplanken beachten, nichts wiederholen, untereinander verschieden.
      const l = a.leitplanken;
      kandidaten.sort((x, y) => {
        const naeheX = l.anker ? 1 - Math.abs(aehnlichkeit(x.kurz, l.anker) - 0.5) * 2 : 0;
        const naeheY = l.anker ? 1 - Math.abs(aehnlichkeit(y.kurz, l.anker) - 0.5) * 2 : 0;
        return y.punkte + naeheY * 4 - (x.punkte + naeheX * 4) || x.kurz.name.localeCompare(y.kurz.name);
      });
      const gewaehlt: Kandidat[] = [];
      const bisher = [...a.gesehen];
      const gleich = (x: Kandidat, y: Kandidat, feld: 'gerichtstyp' | 'hauptzutat') =>
        x.kurz.eigenschaften[feld] === y.kurz.eigenschaften[feld];
      const erlaubt = (k: Kandidat) =>
        !gewaehlt.includes(k) &&
        !verletztAusschluss(k.kurz, l) &&
        (!!l.anker || !verletztVielfalt(k.kurz, vielfaltSperre(bisher))) &&
        !l.kurzfristig_meiden.some((s) => aehnlichkeit(k.kurz, s) >= 0.5) &&
        !bisher.some((b) => aehnlichkeit(k.kurz, b) >= DUPLIKAT_SCHWELLE);
      const nimm = (k: Kandidat) => {
        gewaehlt.push(k);
        bisher.push(k.kurz);
      };

      // Ein Platz für ein Komplettgericht („heute einfach …“), wenn mehrere Vorschläge gefragt sind.
      if (a.anzahl >= 2 && !l.anker) {
        const komplett = kandidaten.find((k) => k.kurz.zutaten.some((n) => komplettNamen.has(n)) && erlaubt(k));
        if (komplett) nimm(komplett);
      }
      // Dann: 1. verschiedene Gerichtstypen UND Hauptzutaten, 2. verschiedene Typen, 3. nur nicht doppelt.
      for (const stufe of [2, 1, 0]) {
        for (const k of kandidaten) {
          if (gewaehlt.length >= a.anzahl) break;
          if (!erlaubt(k)) continue;
          const kollision = gewaehlt.some((g) =>
            stufe === 2 ? gleich(g, k, 'gerichtstyp') || gleich(g, k, 'hauptzutat')
              : stufe === 1 ? gleich(g, k, 'gerichtstyp')
                : gleich(g, k, 'gerichtstyp') && gleich(g, k, 'hauptzutat'));
          if (!kollision) nimm(k);
        }
      }
      // Reihenfolge nach Punkten (das Komplettgericht steht nicht automatisch vorn).
      gewaehlt.sort((x, y) => kandidaten.indexOf(x) - kandidaten.indexOf(y));
      return { vorschlaege: gewaehlt.map((k) => k.roh), einkauf: null, baustein_idee: null };
    },
  };
}
