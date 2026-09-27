import type { CSSProperties } from 'react';
import type { Gericht } from '../supabase/functions/_shared/kombi/typen.ts';
import { euroText, kostenText } from '../supabase/functions/_shared/kombi/kosten.ts';
import { Icon } from './Icon';
import { mengeText, portionenText } from './format';

/**
 * Rezeptkarte, erste Ebene: Name, Beschreibung, Bild, Zeit, Portionen, echte Kosten,
 * verwendeter Vorrat, Fehlendes und höchstens zwei Hinweise.
 * Zweite Ebene (aufklappen): Zubereitung, warum jetzt, Kosten im Detail, Unbekanntes.
 */
export function GerichtKarte({ g, kompakt = false }: { g: Gericht; kompakt?: boolean }) {
  const zutaten = g.zutaten.filter((z) => z.quelle !== 'grundausstattung');
  const grund = g.zutaten.filter((z) => z.quelle === 'grundausstattung');
  const farben = [...new Set(zutaten.map((z) => z.farbe ?? 'kuehlschrank'))];
  const stil = {
    '--a': `var(--tint-${farben[0] ?? 'neutral'})`,
    '--b': `var(--tint-${farben[1] ?? farben[0] ?? 'neutral'})`,
  } as CSSProperties;

  const badges: { text: string; art: string; icon: 'blatt' | 'pfanne' | 'stern' }[] = [];
  if (g.rettet.length) badges.push({ text: 'Rettet Lebensmittel', art: 'rettet', icon: 'blatt' });
  if (g.gerichtsart !== 'rezept') badges.push({ text: 'Komplettgericht', art: 'komplett', icon: 'pfanne' });
  if (g.fehlt.length === 0) badges.push({ text: 'Alles da', art: 'alles', icon: 'stern' });

  return (
    <article className={`essen-karte${kompakt ? ' kompakt' : ''}`}>
      <div className="karte-hero" style={stil}>
        <span className="karte-emoji" aria-hidden="true">{g.emoji}</span>
        <div className="karte-badges">
          {badges.slice(0, 2).map((b) => (
            <span key={b.art} className={`badge badge-${b.art}`}>
              <Icon name={b.icon} groesse={14} /> {b.text}
            </span>
          ))}
        </div>
      </div>

      <div className="karte-inhalt">
        <h3 className="gericht-name">{g.name}</h3>
        {g.beschreibung && <p className="gericht-beschreibung">{g.beschreibung}</p>}

        <p className="fakten">
          <span><Icon name="uhr" groesse={16} /> {g.zeit_min} Min.</span>
          <span><Icon name="personen" groesse={16} /> {portionenText(g.portionen)}</span>
          <span className={`kosten kosten-${g.kosten.status}`}><Icon name="preis" groesse={16} /> {kostenText(g.kosten)}</span>
        </p>

        <div className="vorrat">
          <h4>Aus deinem Vorrat</h4>
          <ul className="vorrat-chips">
            {zutaten.map((z) => (
              <li key={z.id} className={`vorrat-chip f-${z.farbe ?? 'kuehlschrank'}${z.geoeffnet || z.bald_verbrauchen ? ' dringend' : ''}`}>
                {z.farbe ? <span className="farbpunkt" aria-hidden="true" /> : <Icon name="kuehlschrank" groesse={14} />}
                <span>{z.name}</span>
                {z.menge !== null && <small>{mengeText(z.menge, z.einheit)}</small>}
              </li>
            ))}
          </ul>
        </div>

        {g.fehlt.length > 0 && (
          <p className="gericht-fehlt">
            <Icon name="korb" groesse={16} />
            <span>
              <strong>Fehlt:</strong>{' '}
              {g.fehlt
                .map((f) => `${f.menge !== null && f.einheit ? `${mengeText(f.menge, f.einheit)} ` : ''}${f.name}`)
                .join(', ')}
            </span>
          </p>
        )}

        {!kompakt && (
          <details className="gericht-details">
            <summary>Details &amp; Zubereitung</summary>

            {g.warum_jetzt.length > 0 && (
              <ul className="warum">
                {g.warum_jetzt.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            {g.begruendung && <p className="leise">{g.begruendung}</p>}

            {g.schritte.length > 0 && (
              <>
                <h4>So geht’s</h4>
                <ol className="schritte">
                  {g.schritte.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </>
            )}

            <h4>Kosten</h4>
            <table className="kosten-tabelle">
              <tbody>
                {zutaten.map((z) => (
                  <tr key={z.id}>
                    <td>{z.name}{z.menge !== null && <small> · {mengeText(z.menge, z.einheit)}</small>}</td>
                    <td>{z.kosten_cent === null ? <span className="leise">Preis unbekannt</span> : euroText(z.kosten_cent)}</td>
                  </tr>
                ))}
                {g.fehlt.map((f) => (
                  <tr key={`f-${f.name}`} className="fehlt-zeile">
                    <td>{f.name} <small>· fehlt</small></td>
                    <td>{f.preis_cent === null ? <span className="leise">Preis unbekannt</span> : <>{euroText(f.preis_cent)} <small>{f.preis_bezug}</small></>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Gesamt aus dem Vorrat</td>
                  <td>{g.kosten.gesamt_cent === null ? 'unbekannt' : `${g.kosten.status === 'teilweise' ? 'ab ' : ''}${euroText(g.kosten.gesamt_cent)}`}</td>
                </tr>
              </tfoot>
            </table>
            <p className="leise klein">
              Berechnet aus euren gespeicherten Preisen{g.kosten.unbekannt.length ? ` – ohne ${g.kosten.unbekannt.join(', ')} (Preis unbekannt)` : ''}.
              {grund.length > 0 && ` Immer da: ${grund.map((z) => z.name).join(', ')}.`}
            </p>
            {g.hinweise.length > 0 && (
              <ul className="unbekannt">
                {g.hinweise.map((h) => <li key={h}><Icon name="info" groesse={14} /> {h}</li>)}
              </ul>
            )}
          </details>
        )}
      </div>
    </article>
  );
}
