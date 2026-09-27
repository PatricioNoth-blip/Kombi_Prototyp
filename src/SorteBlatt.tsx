import { useEffect, useState } from 'react';
import { fehlerText, ladeChargen, type Charge, type Sorte } from './api';
import { Blatt, AnzahlWahl } from './Blatt';
import { farbe } from './farben';
import { datum, euro, plusTage, tageSeit } from './format';

type Props = {
  sorte: Sorte;
  laeuft: boolean;
  onEntnehmen: (anzahl: number) => void;
  onEinfrieren: () => void;
  onSchliessen: () => void;
};

/** Details einer Sorte: mehrere entnehmen, Chargen ansehen, direkt einfrieren. */
export function SorteBlatt({ sorte, laeuft, onEntnehmen, onEinfrieren, onSchliessen }: Props) {
  const [chargen, setChargen] = useState<Charge[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let aktiv = true;
    ladeChargen(sorte.id)
      .then((c) => {
        if (aktiv) setChargen(c);
      })
      .catch((e) => {
        if (aktiv) setFehler(fehlerText(e));
      });
    return () => {
      aktiv = false;
    };
  }, [sorte.id, sorte.anzahl]);

  const f = farbe(sorte.farbe);
  const warnAb = sorte.haltbar_tage - 14;

  return (
    <Blatt titel={sorte.name} onSchliessen={onSchliessen}>
      <p className={`sorte-info f-${sorte.farbe}`}>
        <span className="punkt" aria-hidden="true" />
        {f.name} · {sorte.groesse_g} g
        {sorte.kosten_cent !== null && <> · {euro(sorte.kosten_cent)}</>} · {sorte.haltbar_tage} Tage
        haltbar
      </p>
      <p className="sorte-bestand">
        <strong>{sorte.anzahl}</strong> da · Mindestbestand {sorte.mindestbestand}
        {sorte.nachkochen && <span className="badge nachkochen">Nachkochen</span>}
        {sorte.bald_ablaufen && <span className="badge ablaufen">Bald ablaufen</span>}
      </p>

      {sorte.anzahl > 0 && (
        <section className="abschnitt">
          <h3>Entnehmen</h3>
          <AnzahlWahl
            werte={[1, 2, 3, 4, 5, 6].filter((n) => n <= sorte.anzahl)}
            aktion="Entnehmen"
            deaktiviert={laeuft}
            onWahl={onEntnehmen}
          />
        </section>
      )}

      <section className="abschnitt">
        <button type="button" className="knopf breit" onClick={onEinfrieren}>
          ❄ {sorte.name} einfrieren
        </button>
      </section>

      <section className="abschnitt">
        <h3>Chargen – älteste wird zuerst entnommen</h3>
        {fehler && <p className="fehlertext">{fehler}</p>}
        {chargen === null && !fehler && <p className="leise">Lade …</p>}
        {chargen?.length === 0 && <p className="leise">Nichts mehr im Gefrierfach.</p>}
        {chargen && chargen.length > 0 && (
          <ul className="chargen">
            {chargen.map((c) => (
              <li key={c.id}>
                <span>
                  {datum(c.eingefroren_am)}
                  <small>haltbar bis {plusTage(c.eingefroren_am, sorte.haltbar_tage)}</small>
                </span>
                <span className="chargen-rechts">
                  {tageSeit(c.eingefroren_am) > warnAb && (
                    <span className="badge ablaufen">Bald ablaufen</span>
                  )}
                  <strong>
                    {c.menge_aktuell} / {c.menge_start}
                  </strong>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Blatt>
  );
}
