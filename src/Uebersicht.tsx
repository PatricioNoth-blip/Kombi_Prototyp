import type { Sorte } from './api';
import { ARTEN_INFO, lagerort } from './farben';
import { Icon } from './Icon';
import { ablaufText, artVon, einheitVon, mengeKurz, portionMengeVon } from './format';

type Props = {
  bestand: Sorte[];
  laeuft: Set<number>;
  /** Menge in der Einheit der Sorte */
  onEntnehmen: (sorte: Sorte, menge: number) => void;
  onOeffnen: (sorte: Sorte) => void;
};

const nachName = (a: Sorte, b: Sorte) => a.name.localeCompare(b.name, 'de');

/** Eine Portion – oder der Rest, wenn weniger da ist. */
export const einePortion = (s: Sorte) => Math.min(portionMengeVon(s), s.anzahl);

/** Kurzer Status für die Zeile: das Wichtigste zuerst */
function status(s: Sorte): { text: string; art: 'warn' | 'bald' | 'offen' | 'nach' } | null {
  if ((s.abgelaufen ?? 0) > 0) return { text: 'abgelaufen – bitte prüfen', art: 'warn' };
  if ((s.geoeffnet ?? 0) > 0) return { text: 'geöffnet', art: 'offen' };
  if (s.bald_ablaufen) return { text: s.naechster_ablauf ? ablaufText(s.naechster_ablauf) : 'bald verbrauchen', art: 'bald' };
  if (s.nachkochen) return { text: 'nachkochen', art: 'nach' };
  return null;
}

export function Uebersicht({ bestand, laeuft, onEntnehmen, onOeffnen }: Props) {
  if (bestand.length === 0) {
    return (
      <div className="leer-zustand">
        <Icon name="vorrat" groesse={40} />
        <p>Noch keine Sorten. Lege unter „Sorten“ die erste an.</p>
      </div>
    );
  }

  const wichtig = bestand
    .filter((s) => s.anzahl > 0 && status(s) && status(s)!.art !== 'nach')
    .sort((a, b) => ['warn', 'offen', 'bald'].indexOf(status(a)!.art) - ['warn', 'offen', 'bald'].indexOf(status(b)!.art) || nachName(a, b));
  const nachkochen = bestand.filter((s) => s.nachkochen).sort(nachName);

  return (
    <>
      {(wichtig.length > 0 || nachkochen.length > 0) && (
        <section className="wichtig" aria-label="Heute wichtig">
          <h2 className="abschnitt-titel">Heute wichtig</h2>
          <ul>
            {wichtig.slice(0, 5).map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOeffnen(s)} className={`wichtig-${status(s)!.art}`}>
                  <span className="wichtig-punkt" aria-hidden="true" />
                  <span className="wichtig-name">{s.name}</span>
                  <span className="wichtig-text">{status(s)!.text}</span>
                </button>
              </li>
            ))}
            {nachkochen.length > 0 && (
              <li>
                <p className="wichtig-nach">
                  <span className="wichtig-punkt" aria-hidden="true" />
                  <span className="wichtig-name">Nachkochen</span>
                  <span className="wichtig-text">{nachkochen.map((s) => s.name).join(', ')}</span>
                </p>
              </li>
            )}
          </ul>
        </section>
      )}

      {ARTEN_INFO.map((art) => {
        const sorten = bestand
          .filter((s) => artVon(s) === art.id)
          .sort((a, b) => Number(b.anzahl > 0) - Number(a.anzahl > 0) || nachName(a, b));
        if (sorten.length === 0) return null;
        return (
          <section key={art.id} className="gruppe">
            <h2 className="abschnitt-titel">{art.mehrzahl}</h2>
            <ul className="liste">
              {sorten.map((s) => {
                const menge = mengeKurz(s.anzahl, einheitVon(s));
                const st = status(s);
                const lager = lagerort(s.lagerort);
                return (
                  <li key={s.id} className={`zeile f-${s.farbe}${s.anzahl === 0 ? ' leer' : ''}`}>
                    <span className="farbpunkt" aria-hidden="true" />
                    <button type="button" className="zeile-info" onClick={() => onOeffnen(s)}>
                      <span className="zeile-name">{s.name}</span>
                      <span className="zeile-meta">
                        <Icon name={lager.icon} groesse={14} />
                        {st ? <span className={`status status-${st.art}`}>{st.text}</span> : <span>{lager.name}</span>}
                      </span>
                    </button>
                    <span className="zeile-menge" aria-label={`${menge.zahl} ${menge.einheit}`}>
                      <strong>{menge.zahl}</strong>
                      <small>{menge.einheit}</small>
                    </span>
                    <button
                      type="button"
                      className="minus"
                      disabled={s.anzahl === 0 || laeuft.has(s.id)}
                      onClick={() => onEntnehmen(s, einePortion(s))}
                      aria-label={`Eine Portion ${s.name} entnehmen`}
                    >
                      <Icon name="minus" groesse={18} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
