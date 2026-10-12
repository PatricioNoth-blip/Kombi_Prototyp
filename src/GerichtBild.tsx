// Das Bild eines Gerichts – appetitlich und für jedes Gericht anders, aber nie erfunden:
//   1. ein echtes Foto (eigenes, gefundenes oder generiertes Bild über die Bildpipeline, siehe bildApi.ts)
//   2. sonst ein gezeichneter „Teller von oben“: das Gericht auf dem Teller, drumherum die Zutaten, die
//      wirklich darin stecken – wie bei einem Food-Foto von oben. Die Grundfarbe kommt von der
//      Hauptzutat (Tomatenrot, Kräutergrün, Currygelb …).
// Die kleinen Fotos aus src/bilder/ sind dafür zu klein (unscharf auf großen Flächen) und bleiben
// Listen, Lagerorten und Sorten vorbehalten.
import type { Farbe, Gericht } from '../supabase/functions/_shared/kombi/typen.ts';
import { bildNachweis } from '../supabase/functions/_shared/kombi/bilder.ts';
import { Bild, emojiFuer } from './Bild';
import { bildKaputt, useBild } from './bildApi';

export type TellerGroesse = 'held' | 'karte' | 'kopf' | 'klein';

/** Zutaten für die Deko rund um den Teller: echte Zutaten des Gerichts, ohne Doppelte, ohne Salz & Co. */
export function tellerZutaten(g: Pick<Gericht, 'zutaten' | 'fehlt' | 'emoji' | 'name'>, max = 4): string[] {
  if (max <= 0) return [];
  const haupt = g.emoji || emojiFuer(g.name);
  const namen = [
    ...g.zutaten.filter((z) => z.quelle !== 'grundausstattung').map((z) => ({ name: z.name, farbe: z.farbe })),
    ...g.fehlt.map((f) => ({ name: f.name, farbe: null })),
  ];
  const emojis: string[] = [];
  for (const z of namen) {
    const e = emojiFuer(z.name, z.farbe);
    if (e === haupt || e === '🍽️' || emojis.includes(e)) continue;
    emojis.push(e);
    if (emojis.length >= max) break;
  }
  return emojis;
}

/** Grundton: Farbe der ersten Zutat mit Kombi-Farbe (Basis/Soße rot, Gemüse grün …), sonst warm-neutral. */
export function tellerTon(g: Pick<Gericht, 'zutaten'>): Farbe | 'neutral' {
  const z = g.zutaten.find((x) => x.quelle !== 'grundausstattung' && x.farbe && x.farbe !== 'weiss' && x.farbe !== 'schwarz');
  return z?.farbe ?? 'neutral';
}

/** Gezeichneter Teller – rein dekorativ (aria-hidden), der Name steht immer daneben als Text. */
export function Teller({ g, groesse }: { g: Pick<Gericht, 'zutaten' | 'fehlt' | 'emoji' | 'name'>; groesse: TellerGroesse }) {
  const deko = tellerZutaten(g, groesse === 'klein' ? 0 : 4);
  return (
    <span className={`teller teller-${groesse} teller-${tellerTon(g)}`} aria-hidden="true">
      {deko.map((e, i) => <span key={e} className={`teller-deko d${i + 1}`}>{e}</span>)}
      <span className="teller-platte"><span className="teller-gericht">{g.emoji || emojiFuer(g.name)}</span></span>
    </span>
  );
}

/**
 * Gerichtsbild: echtes Foto, wenn es eins gibt (suchen = einmalige Suche für sichtbare Hauptkarten),
 * sonst der gezeichnete Teller. Mit nachweis = Bildnachweis bei gefundenen Fotos (Lizenz, Quelle).
 */
export function GerichtBild({ g, groesse, suchen = false, nachweis = false }: {
  g: Gericht; groesse: TellerGroesse; suchen?: boolean; nachweis?: boolean;
}) {
  const foto = useBild(g.bild, suchen);
  const text = nachweis ? bildNachweis(foto) : null;
  if (!foto || foto.image_status !== 'ok') return <Teller g={g} groesse={groesse} />;
  return (
    <span className={`gericht-foto gericht-foto-${groesse}`}>
      <Bild name={g.name} emoji={g.emoji} art={groesse === 'klein' ? 'kachel' : 'flaeche'} bild={foto}
        alt={groesse === 'kopf' ? g.bild?.alt ?? g.name : undefined} onKaputt={() => bildKaputt(g.bild?.schluessel)} />
      {text && (
        <small className="bild-nachweis">
          {foto.quelle_seite ? <a href={foto.quelle_seite} target="_blank" rel="noopener noreferrer">{text}</a> : text}
        </small>
      )}
    </span>
  );
}
