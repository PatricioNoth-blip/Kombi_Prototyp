import { useState } from 'react';
import type { Einheit, Sorte } from './api';
import { Blatt, AnzahlWahl } from './Blatt';
import { ARTEN_INFO, buchungsVerb } from './farben';
import { artVon, einheitVon, euroZuCent, heuteIso, mengeKurz, mengeText } from './format';
import { Icon } from './Icon';

type Props = {
  bestand: Sorte[];
  baukasten: boolean;
  startSorte: Sorte | null;
  /** Migration „kosten_naehrwerte“: bezahlter Betrag wird als Einkauf gezählt */
  mitPreis: boolean;
  onEinfrieren: (sorte: Sorte, menge: number, ablaufAm: string | null, preisCent: number | null) => void;
  /** Sorte fehlt noch → anlegen */
  onNeueSorte: () => void;
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
export function Einfrieren({ bestand, baukasten, startSorte, mitPreis, onEinfrieren, onNeueSorte, onSchliessen }: Props) {
  const [sorte, setSorte] = useState<Sorte | null>(startSorte);
  const [ablauf, setAblauf] = useState('');
  const [preis, setPreis] = useState('');
  const preisCent = euroZuCent(preis);
  const preisFehler = preisCent !== null && Number.isNaN(preisCent);

  if (sorte) {
    const einheit = einheitVon(sorte);
    const verb = buchungsVerb(sorte.lagerort);
    return (
      <Blatt titel={`${sorte.name} ${verb.infinitiv}`} untertitel="Wie viel? Ein Tap bucht." onSchliessen={onSchliessen}>
        {(baukasten || mitPreis) && (
          <div className="formular">
            {baukasten && (
              <label className="feld feld-inline">
                <span>Haltbar bis <small>(optional)</small></span>
                <input type="date" value={ablauf} min={heuteIso()} onChange={(e) => setAblauf(e.target.value)} />
              </label>
            )}
            {mitPreis && (
              <label className="feld feld-inline preis-zeile">
                <span>Bezahlt <small>(optional, zählt als Einkauf)</small></span>
                <input type="text" inputMode="decimal" placeholder="0,00 €" value={preis} onChange={(e) => setPreis(e.target.value)} aria-invalid={preisFehler} />
              </label>
            )}
            {preisFehler && <p className="fehlertext">Bitte einen Betrag wie 2,49 eingeben.</p>}
          </div>
        )}
        <AnzahlWahl
          werte={MENGEN[einheit]}
          deaktiviert={preisFehler}
          aktion={verb.infinitiv.replace(/^./, (b) => b.toUpperCase())}
          beschriftung={einheit === 'g' || einheit === 'ml' ? (n) => mengeText(n, einheit) : undefined}
          platzhalter={einheit === 'portion' ? 'Andere Anzahl' : `Andere Menge (${einheit === 'stueck' ? 'Stück' : einheit})`}
          onWahl={(n) => onEinfrieren(sorte, n, ablauf || null, preisCent === null || Number.isNaN(preisCent) ? null : preisCent)}
        />
        <button type="button" className="link breit" onClick={() => setSorte(null)}>
          Andere Sorte wählen
        </button>
      </Blatt>
    );
  }

  return (
    <Blatt titel="Was buchst du ein?" onSchliessen={onSchliessen}>
      <button type="button" className="neue-sorte-knopf" onClick={onNeueSorte}>
        <span className="kreis-klein"><Icon name="plus" groesse={18} /></span>
        <span>
          <strong>Neue Sorte anlegen</strong>
          <small>Zutat, Komponente oder Komplettgericht, das es noch nicht gibt</small>
        </span>
      </button>
      {ARTEN_INFO.map((art) => {
        const sorten = bestand
          .filter((s) => artVon(s) === art.id)
          .sort((a, b) => a.name.localeCompare(b.name, 'de'));
        if (sorten.length === 0) return null;
        return (
          <section key={art.id}>
            <h3 className="unterkopf">{art.mehrzahl}</h3>
            <div className="sorten-raster">
              {sorten.map((s) => {
                const m = mengeKurz(s.anzahl, einheitVon(s));
                return (
                  <button key={s.id} type="button" className={`sorte-knopf f-${s.farbe}`} onClick={() => setSorte(s)}>
                    <span className="punkt" aria-hidden="true" />
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
