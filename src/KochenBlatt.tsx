import { useState } from 'react';
import type { Gericht } from '../supabase/functions/_shared/kombi/typen.ts';
import { entnahmePlan, postenText, pruefeEntnahme, type EntnahmePosten } from '../supabase/functions/_shared/kombi/aktionen.ts';
import type { Sorte } from './api';
import { Blatt } from './Blatt';
import { Icon } from './Icon';
import { mengeText, portionMengeVon } from './format';

type Props = {
  gericht: Gericht;
  /** aktueller Bestand – geprüft wird gegen den Stand JETZT, nicht den beim Vorschlag */
  bestand: Sorte[];
  onBestaetigen: (posten: EntnahmePosten[]) => Promise<void>;
  onSchliessen: () => void;
};

/**
 * „Heute kochen“: zeigt, was entnommen würde, und prüft es gegen den aktuellen Bestand.
 * Erst „Entnehmen“ bucht – über die bestehende Funktion entnehmen() (geöffnet → Ablauf → älteste).
 */
export function KochenBlatt({ gericht, bestand, onBestaetigen, onSchliessen }: Props) {
  const plan = entnahmePlan(gericht);
  const status = pruefeEntnahme(plan, bestand);
  const [posten, setPosten] = useState<EntnahmePosten[]>(() =>
    plan.map((p, i) => ({ ...p, menge: Math.min(p.menge, status[i].verfuegbar) })),
  );
  const [laeuft, setLaeuft] = useState(false);

  const schritt = (p: EntnahmePosten) => {
    const s = bestand.find((b) => b.id === p.block_typ_id);
    return s ? portionMengeVon(s) : 1;
  };
  const verfuegbar = (p: EntnahmePosten) => bestand.find((b) => b.id === p.block_typ_id)?.anzahl ?? 0;
  const aendere = (i: number, richtung: 1 | -1) =>
    setPosten((alt) =>
      alt.map((p, j) => (j === i ? { ...p, menge: Math.max(0, Math.min(verfuegbar(p), p.menge + richtung * schritt(p))) } : p)),
    );

  const aktiv = posten.filter((p) => p.menge > 0);
  const nichtGebucht = gericht.zutaten.filter((z) => z.quelle !== 'bestand').map((z) => z.name);
  const komplett = gericht.gerichtsart === 'komplett';

  return (
    <Blatt
      titel={komplett ? `Heute einfach: ${gericht.name}` : `${gericht.name} kochen`}
      untertitel={komplett ? 'Das Komplettgericht wird als Ganzes entnommen.' : 'Diese Zutaten werden aus dem Vorrat entnommen.'}
      onSchliessen={onSchliessen}
    >
      {posten.length === 0 ? (
        <p>Keine Zutaten aus dem Vorrat – nichts zu entnehmen.</p>
      ) : (
        <ul className="liste koch-liste">
          {posten.map((p, i) => {
            const st = status[i];
            return (
              <li key={p.block_typ_id} className="zeile">
                <span className="zeile-info">
                  <span className="zeile-name">{p.name}</span>
                  <span className="zeile-meta">
                    {st.status === 'ok' && <>noch {mengeText(st.verfuegbar, p.einheit)} da</>}
                    {st.status === 'zu_wenig' && <span className="status status-warn">nur noch {mengeText(st.verfuegbar, p.einheit)} da</span>}
                    {st.status === 'leer' && <span className="status status-warn">schon aufgebraucht</span>}
                    {st.status === 'unbekannt' && <span className="status status-warn">Sorte gibt es nicht mehr</span>}
                  </span>
                </span>
                <button type="button" className="icon-knopf klein" onClick={() => aendere(i, -1)} aria-label={`${p.name} weniger`} disabled={p.menge === 0}>
                  <Icon name="minus" groesse={18} />
                </button>
                <strong className="koch-anzahl">{mengeText(p.menge, p.einheit)}</strong>
                <button type="button" className="icon-knopf klein" onClick={() => aendere(i, 1)} aria-label={`${p.name} mehr`} disabled={p.menge >= verfuegbar(p)}>
                  <Icon name="plus" groesse={18} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {nichtGebucht.length > 0 && (
        <p className="leise klein">Nicht gebucht: {nichtGebucht.join(', ')} (Kühlschrank-Reste und Grundausstattung).</p>
      )}
      <div className="abschnitt">
        <button
          type="button"
          className="knopf haupt"
          disabled={laeuft || aktiv.length === 0}
          onClick={async () => {
            setLaeuft(true);
            await onBestaetigen(aktiv);
          }}
        >
          <Icon name="pfanne" />
          {laeuft ? 'Entnehme …' : aktiv.length === 1 ? `${postenText(aktiv[0])} entnehmen` : `${aktiv.length} Zutaten entnehmen`}
        </button>
      </div>
    </Blatt>
  );
}
