import type { Gericht } from '../supabase/functions/_shared/kombi/typen.ts';
import type { Naehrwerte } from '../supabase/functions/_shared/kombi/naehrwerte.ts';
import { Icon } from './Icon';
import { kcalKurz, mengeText } from './format';
import { GerichtBild } from './GerichtBild';

/** Zutaten in Kurzform: „Tomaten-Basis, Spaghetti“ */
const namen = (zs: Gericht['zutaten']) => zs.map((z) => z.name).join(', ');

/** Verfügbarkeit in einem Satz – grün, wenn alles da ist */
export function Verfuegbarkeit({ g }: { g: Gericht }) {
  if (g.fehlt.length === 0) {
    return <p className="verfuegbar status-ok"><Icon name="haken" groesse={16} /> Alles da</p>;
  }
  const text = g.fehlt.map((f) => `${f.menge !== null && f.einheit ? `${mengeText(f.menge, f.einheit)} ` : ''}${f.name}`).join(', ');
  return <p className="verfuegbar status-achtung"><Icon name="wagen" groesse={16} /> Fehlt: {text}</p>;
}

type Aktionen = {
  /** öffnet die Rezeptseite */
  onKochen: () => void;
  onMerken?: () => void;
  onEinplanen?: () => void;
  gemerkt?: boolean;
};

/**
 * Ein Vorschlag: Bild, Name, ein Satz, Zeit · Portionen · kcal, woraus es besteht, was fehlt –
 * und die Hauptaktion „Jetzt kochen“ (öffnet die Rezeptseite). Das ganze Rezept mit Schritten steht
 * auf der Rezeptseite, nicht klein in der Karte.
 */
export function GerichtKarte({ g, naehrwerte: n, kompakt = false, aktionen }: { g: Gericht; naehrwerte: Naehrwerte; kompakt?: boolean; aktionen?: Aktionen }) {
  const echte = g.zutaten.filter((z) => z.quelle !== 'grundausstattung');
  const komponenten = echte.filter((z) => z.art === 'komponente' || z.art === 'komplettgericht');
  const andere = echte.filter((z) => !komponenten.includes(z));

  return (
    <article className={`gericht${kompakt ? ' kompakt' : ''}`}>
      <div className="gericht-kopf"><GerichtBild g={g} groesse="karte" suchen={!kompakt} /></div>
      <div className="gericht-inhalt">
        {g.grundrezept && <p className="held-ueber">Grundrezept</p>}
        <h3 className="gericht-name">{g.name}</h3>
        {g.beschreibung && <p className="gericht-text">{g.beschreibung}</p>}
        <p className="fakten">
          <span><Icon name="uhr" groesse={16} /> {g.zeit_min} Min</span>
          <span><Icon name="personen" groesse={16} /> {g.portionen} {g.portionen === 1 ? 'Portion' : 'Portionen'}</span>
          <span><Icon name="flamme" groesse={16} /> {kcalKurz(n)}</span>
        </p>
        {komponenten.length > 0 && (
          <p className="gericht-zutaten"><span className="leise">Aus deinen Komponenten: </span><strong>{namen(komponenten)}</strong></p>
        )}
        {andere.length > 0 && <p className="gericht-zutaten"><span className="leise">Aus dem Vorrat: </span>{namen(andere)}</p>}
        <Verfuegbarkeit g={g} />
        {g.rettet.length > 0 && <p className="held-grund"><Icon name="blatt" groesse={16} /> Verbraucht zuerst: {g.rettet.slice(0, 3).join(', ')}</p>}

        {aktionen && (
          <div className="gericht-aktionen">
            <button type="button" className="knopf haupt" onClick={aktionen.onKochen}><Icon name="pfanne" /> Jetzt kochen</button>
            <div className="knopf-reihe">
              {aktionen.onMerken && (
                <button type="button" className="knopf zweit" onClick={aktionen.onMerken} disabled={aktionen.gemerkt}>
                  <Icon name={aktionen.gemerkt ? 'haken' : 'stern'} groesse={18} /> {aktionen.gemerkt ? 'Gemerkt' : 'Merken'}
                </button>
              )}
              {aktionen.onEinplanen && (
                <button type="button" className="knopf zweit" onClick={aktionen.onEinplanen}><Icon name="kalender" groesse={18} /> Einplanen</button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
