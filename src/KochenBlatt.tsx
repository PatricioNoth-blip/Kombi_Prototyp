import { useState } from 'react';
import type { Gericht } from '../supabase/functions/_shared/kombi/typen.ts';
import { entnahmePlan, type EntnahmePosten } from '../supabase/functions/_shared/kombi/aktionen.ts';
import { Blatt } from './Blatt';

type Props = {
  gericht: Gericht;
  onBestaetigen: (posten: EntnahmePosten[]) => Promise<void>;
  onSchliessen: () => void;
};

/** „Heute kochen“: zeigt, was ausgetragen würde. Erst „Austragen“ bucht – über entnehmen() (FIFO). */
export function KochenBlatt({ gericht, onBestaetigen, onSchliessen }: Props) {
  const [posten, setPosten] = useState<EntnahmePosten[]>(() => entnahmePlan(gericht));
  const [laeuft, setLaeuft] = useState(false);
  const summe = posten.reduce((s, p) => s + p.anzahl, 0);

  const aendere = (i: number, delta: number) =>
    setPosten((alt) => alt.map((p, j) => (j === i ? { ...p, anzahl: Math.max(0, Math.min(24, p.anzahl + delta)) } : p)));

  return (
    <Blatt titel={`${gericht.emoji} ${gericht.name} kochen`} onSchliessen={onSchliessen}>
      <p className="leise">Diese Blöcke werden aus dem Bestand ausgetragen (älteste Charge zuerst). Du kannst die Anzahl anpassen.</p>
      {posten.length === 0 ? (
        <p>Keine Bestandszutaten – nichts auszutragen.</p>
      ) : (
        <ul className="liste koch-liste">
          {posten.map((p, i) => (
            <li key={p.block_typ_id} className="zeile">
              <span className="zeile-info">
                <span className="zeile-name">{p.name}</span>
              </span>
              <button type="button" className="rund" onClick={() => aendere(i, -1)} aria-label={`${p.name} weniger`}>
                −
              </button>
              <strong className="koch-anzahl">{p.anzahl}</strong>
              <button type="button" className="rund" onClick={() => aendere(i, 1)} aria-label={`${p.name} mehr`}>
                +
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="abschnitt">
        <button
          type="button"
          className="knopf haupt"
          disabled={laeuft || summe === 0}
          onClick={async () => {
            setLaeuft(true);
            await onBestaetigen(posten);
          }}
        >
          {laeuft ? 'Trage aus …' : `🍳 ${summe} ${summe === 1 ? 'Block' : 'Blöcke'} austragen`}
        </button>
      </div>
    </Blatt>
  );
}
