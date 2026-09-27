import type { Gericht } from '../supabase/functions/_shared/kombi/typen.ts';
import { euro } from './format';

const zeitText = (min: number) => `${min} Min.`;

/** Rezeptkarte: Name, Bausteine nach Farben, Zeit, Kosten, Begründung, Fehlendes. */
export function GerichtKarte({ g }: { g: Gericht }) {
  const zutaten = g.zutaten.filter((z) => z.quelle !== 'grundausstattung');
  const grund = g.zutaten.filter((z) => z.quelle === 'grundausstattung');
  return (
    <article className="gericht">
      <div className="gericht-emoji" aria-hidden="true">
        {g.emoji}
      </div>
      <h3 className="gericht-name">{g.name}</h3>

      <ul className="gericht-zutaten">
        {zutaten.map((z) => (
          <li key={z.id} className={z.farbe ? `f-${z.farbe}` : 'f-kuehlschrank'}>
            {z.farbe ? <span className="punkt" aria-hidden="true" /> : <span aria-hidden="true">🧊</span>}
            {z.name}
            {z.bloecke !== null && <span className="leise"> × {z.bloecke}</span>}
            {z.bald_verbrauchen && <span className="badge ablaufen">bald verbrauchen</span>}
          </li>
        ))}
      </ul>
      {grund.length > 0 && <p className="leise klein">+ {grund.map((z) => z.name).join(', ')}</p>}

      <p className="gericht-fakten">
        <span>⏱️ {zeitText(g.zeit_min)}</span>
        <span>
          💰 {g.kosten.vollstaendig ? '' : 'ca. '}
          {euro(g.kosten.pro_portion_cent)} / Portion
        </span>
      </p>
      {!g.kosten.vollstaendig && <p className="leise klein">ohne Kühlschrank-Reste bzw. Zutaten ohne Preis</p>}

      {g.begruendung && <p className="gericht-begruendung">{g.begruendung}</p>}
      {g.warum_jetzt.length > 0 && (
        <ul className="gericht-warum">
          {g.warum_jetzt.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <p className="gericht-fehlt">
        <strong>Fehlt:</strong>{' '}
        {g.fehlt.length === 0
          ? 'nichts'
          : g.fehlt
              .map((f) => `${f.menge ? `${f.menge}× ` : ''}${f.name} (${f.preis_cent === null ? 'Preis unbekannt' : euro(f.preis_cent)})`)
              .join(', ')}
      </p>

      {g.schritte.length > 0 && (
        <details className="gericht-schritte">
          <summary>So geht’s</summary>
          <ol>
            {g.schritte.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}
