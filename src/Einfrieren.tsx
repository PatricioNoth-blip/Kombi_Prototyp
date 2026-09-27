import { useState } from 'react';
import type { Einheit, Sorte } from './api';
import { Blatt, AnzahlWahl } from './Blatt';
import { ARTEN_INFO, buchungsVerb } from './farben';
import { artVon, einheitVon, heuteIso, mengeKurz, mengeText } from './format';

type Props = {
  bestand: Sorte[];
  baukasten: boolean;
  startSorte: Sorte | null;
  onEinfrieren: (sorte: Sorte, menge: number, ablaufAm: string | null) => void;
  onSchliessen: () => void;
};

/** Typische Mengen je Einheit – ein Tap bucht sofort. */
const MENGEN: Record<Einheit, number[]> = {
  portion: [1, 2, 3, 4, 5, 6, 8, 10, 12],
  stueck: [1, 2, 3, 4, 6, 8, 10, 12],
  g: [100, 125, 200, 250, 400, 500, 750, 1000],
  ml: [200, 250, 330, 400, 500, 750, 1000],
};

/** Einbuchen in 3 Taps: „Einbuchen“ → Sorte → Menge (bucht sofort). Ablaufdatum optional. */
export function Einfrieren({ bestand, baukasten, startSorte, onEinfrieren, onSchliessen }: Props) {
  const [sorte, setSorte] = useState<Sorte | null>(startSorte);
  const [ablauf, setAblauf] = useState('');

  if (sorte) {
    const einheit = einheitVon(sorte);
    const verb = buchungsVerb(sorte.lagerort);
    return (
      <Blatt titel={`${sorte.name} ${verb.infinitiv}`} untertitel={`Wie viel? Ein Tap bucht sofort.`} onSchliessen={onSchliessen}>
        {baukasten && (
          <label className="feld feld-inline">
            <span>Haltbar bis <small>(optional, z. B. MHD)</small></span>
            <input type="date" value={ablauf} min={heuteIso()} onChange={(e) => setAblauf(e.target.value)} />
          </label>
        )}
        <AnzahlWahl
          werte={MENGEN[einheit]}
          aktion={verb.infinitiv.replace(/^./, (b) => b.toUpperCase())}
          beschriftung={einheit === 'g' || einheit === 'ml' ? (n) => mengeText(n, einheit) : undefined}
          platzhalter={einheit === 'portion' ? 'Andere Anzahl' : `Andere Menge (${einheit === 'stueck' ? 'Stück' : einheit})`}
          onWahl={(n) => onEinfrieren(sorte, n, ablauf || null)}
        />
        <button type="button" className="link zurueck" onClick={() => setSorte(null)}>
          ← andere Sorte
        </button>
      </Blatt>
    );
  }

  return (
    <Blatt titel="Was buchst du ein?" onSchliessen={onSchliessen}>
      {ARTEN_INFO.map((art) => {
        const sorten = bestand
          .filter((s) => artVon(s) === art.id)
          .sort((a, b) => a.name.localeCompare(b.name, 'de'));
        if (sorten.length === 0) return null;
        return (
          <section key={art.id} className="abschnitt">
            <h3>{art.mehrzahl}</h3>
            <div className="sorten-raster">
              {sorten.map((s) => {
                const m = mengeKurz(s.anzahl, einheitVon(s));
                return (
                  <button key={s.id} type="button" className={`sorte-knopf f-${s.farbe}`} onClick={() => setSorte(s)}>
                    <span className="farbpunkt" aria-hidden="true" />
                    <span className="sorte-knopf-name">{s.name}</span>
                    <small>{m.zahl} {m.einheit} da</small>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </Blatt>
  );
}
