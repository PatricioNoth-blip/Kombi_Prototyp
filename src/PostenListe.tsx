import type { EntnahmePosten } from '../supabase/functions/_shared/kombi/aktionen.ts';
import type { Sorte } from './api';
import { Icon } from './Icon';
import { mengeText, portionMengeVon } from './format';

/** Verwendbarer Bestand (ohne Abgelaufenes) */
export const verfuegbarVon = (bestand: Sorte[], id: number) => {
  const s = bestand.find((b) => b.id === id);
  return s ? Math.max(0, s.anzahl - Math.max(0, s.abgelaufen ?? 0)) : 0;
};

/** Was entnommen wird – mit Plus/Minus je Posten, höchstens so viel wie da ist. */
export function PostenListe({ posten, bestand, onAendern }: {
  posten: EntnahmePosten[];
  bestand: Sorte[];
  onAendern: (posten: EntnahmePosten[]) => void;
}) {
  const schritt = (p: EntnahmePosten) => {
    const s = bestand.find((b) => b.id === p.block_typ_id);
    return s ? portionMengeVon(s) : 1;
  };
  const aendere = (i: number, richtung: 1 | -1) =>
    onAendern(posten.map((p, j) => (j === i
      ? { ...p, menge: Math.max(0, Math.min(verfuegbarVon(bestand, p.block_typ_id), p.menge + richtung * schritt(p))) }
      : p)));

  return (
    <ul className="liste">
      {posten.map((p, i) => (
        <li key={p.block_typ_id}>
          <div className="zeile">
            <span className="zeile-haupt">
              <span className="zeile-titel">{p.name}</span>
              <span className="zeile-meta">{mengeText(verfuegbarVon(bestand, p.block_typ_id), p.einheit)} da</span>
            </span>
            <button type="button" className="icon-knopf klein" onClick={() => aendere(i, -1)} aria-label={`${p.name} weniger`} disabled={p.menge === 0}>
              <Icon name="minus" groesse={16} />
            </button>
            <strong className="menge-rechts posten-menge">{mengeText(p.menge, p.einheit)}</strong>
            <button type="button" className="icon-knopf klein" onClick={() => aendere(i, 1)} aria-label={`${p.name} mehr`}
              disabled={p.menge >= verfuegbarVon(bestand, p.block_typ_id)}>
              <Icon name="plus" groesse={16} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
