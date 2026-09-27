import type { Sorte } from './api';
import { FARBEN } from './farben';

type Props = {
  bestand: Sorte[];
  laeuft: Set<number>;
  onMinusEins: (sorte: Sorte) => void;
  onOeffnen: (sorte: Sorte) => void;
};

const nachName = (a: Sorte, b: Sorte) => a.name.localeCompare(b.name, 'de');
const namen = (sorten: Sorte[]) => sorten.map((s) => s.name).join(', ');

export function Uebersicht({ bestand, laeuft, onMinusEins, onOeffnen }: Props) {
  if (bestand.length === 0) {
    return <p className="leise">Noch keine Sorten. Lege unter „Sorten“ die erste an.</p>;
  }

  const nachkochen = bestand.filter((s) => s.nachkochen).sort(nachName);
  const ablaufen = bestand.filter((s) => s.bald_ablaufen).sort(nachName);

  return (
    <>
      {(nachkochen.length > 0 || ablaufen.length > 0) && (
        <div className="warnungen">
          {nachkochen.length > 0 && (
            <p>
              <span className="badge nachkochen">Nachkochen</span> {namen(nachkochen)}
            </p>
          )}
          {ablaufen.length > 0 && (
            <p>
              <span className="badge ablaufen">Bald ablaufen</span> {namen(ablaufen)}
            </p>
          )}
        </div>
      )}

      {FARBEN.map((farbe) => {
        const sorten = bestand.filter((s) => s.farbe === farbe.id).sort(nachName);
        if (sorten.length === 0) return null;
        return (
          <section key={farbe.id} className={`gruppe f-${farbe.id}`}>
            <h2 className="gruppe-kopf">
              <span className="punkt" aria-hidden="true" />
              {farbe.name}
              <span className="gruppe-bedeutung">{farbe.bedeutung}</span>
            </h2>
            <ul className="liste">
              {sorten.map((s) => (
                <li key={s.id} className={`zeile${s.anzahl === 0 ? ' leer' : ''}`}>
                  <button type="button" className="zeile-info" onClick={() => onOeffnen(s)}>
                    <span className="zeile-name">{s.name}</span>
                    {(s.nachkochen || s.bald_ablaufen) && (
                      <span className="zeile-hinweise">
                        {s.nachkochen && <span className="badge nachkochen">Nachkochen</span>}
                        {s.bald_ablaufen && <span className="badge ablaufen">Bald ablaufen</span>}
                      </span>
                    )}
                  </button>
                  <span className="zeile-anzahl">
                    <strong>{s.anzahl}</strong>
                    <small>min. {s.mindestbestand}</small>
                  </span>
                  <button
                    type="button"
                    className="minus"
                    disabled={s.anzahl === 0 || laeuft.has(s.id)}
                    onClick={() => onMinusEins(s)}
                    aria-label={`Eins ${s.name} entnehmen`}
                  >
                    −1
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
