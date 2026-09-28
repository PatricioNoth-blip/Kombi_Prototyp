import type { Gericht } from '../supabase/functions/_shared/kombi/typen.ts';
import type { Naehrwerte } from '../supabase/functions/_shared/kombi/naehrwerte.ts';
import { euroText } from '../supabase/functions/_shared/kombi/kosten.ts';
import { Icon } from './Icon';
import { euroKurz, kcalKurz, mengeText } from './format';

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

/** „18 Min · 0,64 € · 620 kcal“ und darunter der Bezug */
export function GerichtMeta({ g, n }: { g: Gericht; n: Naehrwerte }) {
  const bekannt = g.kosten.status !== 'unbekannt' || n.status !== 'unbekannt';
  return (
    <div>
      <p className="meta"><span>{g.zeit_min} Min</span><span>{euroKurz(g.kosten)}</span><span>{kcalKurz(n)}</span></p>
      {bekannt && <p className="meta-text">je Portion · {g.portionen} {g.portionen === 1 ? 'Portion' : 'Portionen'}</p>}
    </div>
  );
}

/**
 * Ein Gericht: Name, ein Satz, Zeit/Kosten/kcal, woraus es besteht, was fehlt.
 * Alles Weitere (warum jetzt, Zubereitung, Kosten und Nährwerte im Detail) erst beim Aufklappen.
 */
export function GerichtKarte({ g, naehrwerte: n, kompakt = false }: { g: Gericht; naehrwerte: Naehrwerte; kompakt?: boolean }) {
  const echte = g.zutaten.filter((z) => z.quelle !== 'grundausstattung');
  const komponenten = echte.filter((z) => z.art === 'komponente' || z.art === 'komplettgericht');
  const andere = echte.filter((z) => !komponenten.includes(z));
  const farbe = echte.find((z) => z.farbe)?.farbe ?? 'neutral';

  return (
    <article className={`gericht f-${farbe}`}>
      <div className="gericht-kopf" aria-hidden="true">{g.emoji}</div>
      <div className="gericht-inhalt">
        <h3 className="gericht-name">{g.name}</h3>
        {g.beschreibung && <p className="gericht-text">{g.beschreibung}</p>}
        <GerichtMeta g={g} n={n} />
        {komponenten.length > 0 && (
          <p className="gericht-zutaten"><span className="leise">Aus deinen Komponenten: </span><strong>{namen(komponenten)}</strong></p>
        )}
        {andere.length > 0 && <p className="gericht-zutaten"><span className="leise">Aus dem Vorrat: </span>{namen(andere)}</p>}
        <Verfuegbarkeit g={g} />

        {!kompakt && (
          <details className="mehr-infos">
            <summary>Details</summary>
            {g.warum_jetzt.length > 0 && <p className="klein">{g.warum_jetzt.join(' ')}</p>}
            {g.schritte.length > 0 && <ol className="schritte-kurz">{g.schritte.map((s, i) => <li key={i}>{s}</li>)}</ol>}
            <div className="info-zeilen">
              {echte.map((z) => (
                <div key={z.id} className="info-zeile">
                  <span>{z.name}{z.menge !== null ? ` · ${mengeText(z.menge, z.einheit)}` : ''}</span>
                  <span>{z.kosten_cent === null ? '–' : euroText(z.kosten_cent)}</span>
                </div>
              ))}
              <div className="info-zeile">
                <span>Aus dem Vorrat gesamt</span>
                <span>{g.kosten.gesamt_cent === null ? 'unbekannt' : `${g.kosten.status === 'teilweise' ? 'ab ' : ''}${euroText(g.kosten.gesamt_cent)}`}</span>
              </div>
              <div className="info-zeile">
                <span>Kalorien gesamt</span>
                <span>{n.kcal_gesamt === null ? 'unbekannt' : `${n.status === 'teilweise' ? 'ab ' : ''}${n.kcal_gesamt.toLocaleString('de-DE')} kcal`}</span>
              </div>
            </div>
            {(g.kosten.unbekannt.length > 0 || n.unbekannt.length > 0 || g.hinweise.length > 0) && (
              <p className="meta-text">
                {g.kosten.unbekannt.length > 0 && `Ohne Preis: ${g.kosten.unbekannt.join(', ')}. `}
                {n.unbekannt.length > 0 && `Ohne Nährwerte: ${n.unbekannt.join(', ')}. `}
                {g.hinweise.join(' ')}
              </p>
            )}
          </details>
        )}
      </div>
    </article>
  );
}
