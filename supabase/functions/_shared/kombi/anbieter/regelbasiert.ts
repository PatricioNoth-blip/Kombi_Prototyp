// Regelbasierter Anbieter ohne KI: kombiniert Bausteine nach dem Kombi-Farbsystem.
// Deterministisch (gut für Tests) und kostenlos – Demo-Modus, solange keine KI eingerichtet ist.
// Liefert dieselbe Rohantwort wie eine KI und durchläuft dieselbe Prüfung.
import type {
  Eigenschaften, GerichtKurz, Gerichtstyp, Gewuerzrichtung, KiAnbieter, KiAuftrag, RohAntwort,
  RohGericht, Sattmacher, SnapshotZutat,
} from '../typen.ts';
import { aehnlichkeit, DUPLIKAT_SCHWELLE } from '../aehnlichkeit.ts';
import { verletztAusschluss } from '../praeferenz.ts';
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
  if (satt === 'reis') return /curry/.test(b) ? 'curry' : 'pfanne';
  if (satt === 'kartoffel') return 'pfanne';
  if (satt === 'couscous') return 'bowl';
  if (/curry/.test(b)) return 'curry';
  return basis ? 'eintopf' : 'pfanne';
}

const TYP_WORT: Record<string, string> = {
  wrap: 'Wrap', toast: 'Toast', burger: 'Burger', pasta: 'Pasta', curry: 'Curry', pfanne: 'Pfanne',
  bowl: 'Bowl', eintopf: 'Eintopf',
};
const EMOJI: Record<string, string> = {
  wrap: '🌯', toast: '🥪', burger: '🍔', pasta: '🍝', curry: '🍛', pfanne: '🥘', bowl: '🥗',
  eintopf: '🍲', aufwaermen: '🍽️',
};

const halbe = (personen: number) => Math.max(1, Math.ceil(personen / 2));

function schritteFuer(typ: Gerichtstyp, teile: string[], satt: SnapshotZutat | null): string[] {
  const belag = teile.join(', ');
  const s: string[] = [];
  if (satt && /pasta|reis/.test(sattmacherArt(satt))) s.push(`${satt.name} nach Packung kochen.`);
  s.push(`${belag} in einer Pfanne auftauen und erhitzen.`);
  if (typ === 'wrap' || typ === 'toast' || typ === 'burger') s.push(`${satt?.name ?? 'Brot'} kurz anrösten und füllen.`);
  else if (satt) s.push(`Mit ${satt.name} mischen und abschmecken.`);
  else s.push('Mit Salz und Pfeffer abschmecken.');
  return s;
}

export function regelbasiert(): KiAnbieter {
  return {
    name: 'regelbasiert',
    async vorschlagen(a: KiAuftrag): Promise<RohAntwort> {
      const bestand = a.snapshot.zutaten.filter((z) => z.quelle === 'bestand');
      const kuehlschrank = a.snapshot.zutaten.filter((z) => z.quelle === 'kuehlschrank');
      const nach = (farbe: string) =>
        bestand
          .filter((z) => z.farbe === farbe)
          .sort((x, y) => Number(y.bald_verbrauchen) - Number(x.bald_verbrauchen) || x.name.localeCompare(y.name));
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
        const hauptzutat = kurzname((pr ?? ge ?? ba)!.name);
        const zweit = kurzname((pr ? (ge ?? ba) : ba)!.name);
        const name = `${hauptzutat}-${zweit}-${TYP_WORT[typ] ?? 'Pfanne'}${rest ? ` mit ${restName(rest.name)}` : ''}`;

        const zutaten: RohGericht['zutaten'] = belag.map((z) => ({ id: z.id, bloecke: halbe(p) }));
        if (sa) zutaten.push({ id: sa.id, bloecke: p });
        if (boost) zutaten.push({ id: boost.id, bloecke: 1 });
        if (rest) zutaten.push({ id: rest.id });
        zutaten.push({ id: 'g-salz' });

        const eigenschaften: Eigenschaften = {
          gerichtstyp: typ,
          hauptzutat: normalisiere(hauptzutat),
          geschmack: ba && /curry|kokos/i.test(ba.name) ? 'cremig' : 'herzhaft',
          schaerfe: richtung(boost, ba) === 'mexikanisch' ? 2 : richtung(boost, ba) === 'indisch' ? 1 : 0,
          konsistenz: typ === 'eintopf' || typ === 'curry' ? 'cremig' : 'stueckig',
          sattmacher: satt,
          gewuerzrichtung: richtung(boost, ba),
          zubereitung: 'pfanne',
        };
        const genutzt = [...belag, ...(sa ? [sa] : []), ...(rest ? [rest] : [])];
        const bald = genutzt.filter((z) => z.bald_verbrauchen).length;
        const genug = genutzt.every((z) => z.anzahl === null || z.anzahl >= (z === sa ? p : halbe(p)));
        const kosten = genutzt.reduce((s, z) => s + (z.kosten_cent ?? 0), 0);
        kandidaten.push({
          roh: {
            name,
            emoji: EMOJI[typ] ?? '🍽️',
            zutaten,
            fehlt: [],
            zeit_min: 10 + (sa && /pasta|reis/.test(satt) ? 8 : 0) + (ge ? 2 : 0),
            schritte: schritteFuer(typ, belag.map((z) => z.name), sa),
            begruendung: `Kombiniert ${genutzt.map((z) => z.name).join(', ')} aus eurem Vorrat.`,
            eigenschaften,
          },
          kurz: { name, eigenschaften, zutaten: genutzt.map((z) => z.name) },
          punkte: bald * 3 + (sa ? 2 : 0) + (genug ? 2 : 0) + genutzt.length - kosten / 200,
        });
      }

      // Komplettgerichte einfach aufwärmen.
      for (const k of nach('blau')) {
        const eigenschaften: Eigenschaften = {
          gerichtstyp: 'aufwaermen', hauptzutat: normalisiere(kurzname(k.name)), geschmack: 'herzhaft',
          schaerfe: 0, konsistenz: 'fest', sattmacher: 'sonstiges', gewuerzrichtung: 'neutral', zubereitung: 'aufwaermen',
        };
        const name = `${k.name} aufwärmen`;
        kandidaten.push({
          roh: {
            name, emoji: '🍽️', zutaten: [{ id: k.id, bloecke: p }], fehlt: [], zeit_min: 10,
            schritte: [`${k.name} im Ofen oder in der Pfanne aufwärmen.`],
            begruendung: 'Fertig vorgekocht – nur aufwärmen.', eigenschaften,
          },
          kurz: { name, eigenschaften, zutaten: [k.name] },
          punkte: (k.bald_verbrauchen ? 6 : 0) + (k.anzahl !== null && k.anzahl >= p ? 1 : -2),
        });
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
      // 1. Durchgang: verschiedene Gerichtstypen; 2. Durchgang: auffüllen (nur nicht doppelt).
      for (const streng of [true, false]) {
        for (const k of kandidaten) {
          if (gewaehlt.length >= a.anzahl) break;
          if (gewaehlt.includes(k) || verletztAusschluss(k.kurz, l)) continue;
          if (bisher.some((b) => aehnlichkeit(k.kurz, b) >= DUPLIKAT_SCHWELLE)) continue;
          if (gewaehlt.some((g) => (streng ? gleich(g, k, 'gerichtstyp') : gleich(g, k, 'gerichtstyp') && gleich(g, k, 'hauptzutat')))) continue;
          gewaehlt.push(k);
          bisher.push(k.kurz);
        }
      }
      return { vorschlaege: gewaehlt.map((k) => k.roh), einkauf: null, baustein_idee: null };
    },
  };
}
