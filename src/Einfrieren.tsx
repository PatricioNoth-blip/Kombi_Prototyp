import { useState } from 'react';
import type { Sorte } from './api';
import { Blatt, AnzahlWahl } from './Blatt';
import { buchungsVerb, FARBEN } from './farben';

type Props = {
  bestand: Sorte[];
  startSorte: Sorte | null;
  onEinfrieren: (sorte: Sorte, anzahl: number) => void;
  onSchliessen: () => void;
};

const ANZAHLEN = [1, 2, 3, 4, 5, 6, 8, 10, 12];

/** Einfrieren in 3 Taps: „Einfrieren“ → Sorte → Anzahl (bucht sofort). */
export function Einfrieren({ bestand, startSorte, onEinfrieren, onSchliessen }: Props) {
  const [sorte, setSorte] = useState<Sorte | null>(startSorte);

  if (sorte) {
    return (
      <Blatt titel={`${sorte.name} ${buchungsVerb(sorte.lagerort).infinitiv}`} onSchliessen={onSchliessen}>
        <p className="leise">Wie viele {sorte.lagerort === 'vorrat' ? 'Portionen' : 'Blöcke'}? Ein Tap bucht sofort.</p>
        <AnzahlWahl
          werte={ANZAHLEN}
          aktion={buchungsVerb(sorte.lagerort).infinitiv.replace(/^./, (b) => b.toUpperCase())}
          onWahl={(n) => onEinfrieren(sorte, n)}
        />
        <button type="button" className="link zurueck" onClick={() => setSorte(null)}>
          ← andere Sorte
        </button>
      </Blatt>
    );
  }

  return (
    <Blatt titel="Was frierst du ein?" onSchliessen={onSchliessen}>
      {FARBEN.map((farbe) => {
        const sorten = bestand
          .filter((s) => s.farbe === farbe.id)
          .sort((a, b) => a.name.localeCompare(b.name, 'de'));
        if (sorten.length === 0) return null;
        return (
          <section key={farbe.id} className={`abschnitt f-${farbe.id}`}>
            <h3 className="gruppe-kopf klein">
              <span className="punkt" aria-hidden="true" />
              {farbe.name}
              <span className="gruppe-bedeutung">{farbe.bedeutung}</span>
            </h3>
            <div className="sorten-raster">
              {sorten.map((s) => (
                <button key={s.id} type="button" className="sorte-knopf" onClick={() => setSorte(s)}>
                  <span>{s.name}</span>
                  <small>{s.anzahl} da</small>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </Blatt>
  );
}
