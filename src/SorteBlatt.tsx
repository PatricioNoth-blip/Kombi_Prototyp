import { useEffect, useState } from 'react';
import * as api from './api';
import { fehlerText, ladeChargen, type Charge, type Sorte } from './api';
import { Blatt, AnzahlWahl } from './Blatt';
import { ARTEN_INFO, buchungsVerb, farbe, lagerort } from './farben';
import { Icon } from './Icon';
import {
  ablaufText, artVon, datum, einheitVon, mengeText, plusTage, portionMengeVon, portionspreisText, preisMitBezug, tageSeit,
} from './format';

type Props = {
  sorte: Sorte;
  baukasten: boolean;
  laeuft: boolean;
  onEntnehmen: (menge: number) => void;
  onEinfrieren: () => void;
  onBearbeiten: () => void;
  onGeaendert: (text: string) => void;
  onFehler: (text: string) => void;
  onSchliessen: () => void;
};

/** In dieser Reihenfolge entnimmt die Datenbank: geöffnet → frühester Ablauf → älteste. */
function inEntnahmeReihenfolge(chargen: Charge[], haltbarTage: number): Charge[] {
  const ablauf = (c: Charge) => c.ablauf_am ?? plusTageIso(c.eingefroren_am, haltbarTage);
  return [...chargen].sort(
    (a, b) =>
      Number(!a.geoeffnet_am) - Number(!b.geoeffnet_am) ||
      ablauf(a).localeCompare(ablauf(b)) ||
      a.eingefroren_am.localeCompare(b.eingefroren_am) ||
      a.id - b.id,
  );
}

function plusTageIso(iso: string, tage: number): string {
  const [j, m, t] = iso.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t + tage)).toISOString().slice(0, 10);
}

/** Details einer Sorte: was ist es, wie viel, was kostet eine Portion, Chargen, entnehmen. */
export function SorteBlatt({ sorte, baukasten, laeuft, onEntnehmen, onEinfrieren, onBearbeiten, onGeaendert, onFehler, onSchliessen }: Props) {
  const [chargen, setChargen] = useState<Charge[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuLaden, setNeuLaden] = useState(0);

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
  }, [sorte.id, sorte.anzahl, neuLaden]);

  const einheit = einheitVon(sorte);
  const pm = portionMengeVon(sorte);
  const art = ARTEN_INFO.find((a) => a.id === artVon(sorte))!;
  const lager = lagerort(sorte.lagerort);
  const warnAb = sorte.haltbar_tage - 14;
  const preis = preisMitBezug(sorte);

  const werte = einheit === 'portion'
    ? [1, 2, 3, 4, 5, 6].filter((n) => n <= sorte.anzahl)
    : [1, 2, 3, 4].map((p) => p * pm).filter((v) => v <= sorte.anzahl);

  async function oeffnen(c: Charge, geoeffnet: boolean) {
    try {
      await api.setzeGeoeffnet(c.id, geoeffnet);
      setNeuLaden((n) => n + 1);
      onGeaendert(geoeffnet ? `${sorte.name}: als geöffnet markiert – wird zuerst verbraucht.` : `${sorte.name}: wieder verschlossen.`);
    } catch (e) {
      onFehler(fehlerText(e));
    }
  }

  return (
    <Blatt
      titel={sorte.name}
      untertitel={[art.name, lager.name, sorte.herkunft].filter(Boolean).join(' · ')}
      onSchliessen={onSchliessen}
    >
      <div className={`kennzahlen f-${sorte.farbe}`}>
        <div>
          <small>Da</small>
          <strong>{mengeText(sorte.anzahl, einheit)}</strong>
          {einheit !== 'portion' && <span>≈ {Math.floor((sorte.anzahl / pm) * 10) / 10} Portionen</span>}
        </div>
        <div>
          <small>Portion</small>
          <strong>{einheit === 'portion' ? `${sorte.groesse_g} g` : mengeText(pm, einheit)}</strong>
          <span><span className="farbpunkt" aria-hidden="true" /> {farbe(sorte.farbe).bedeutung}</span>
        </div>
        <div>
          <small>Pro Portion</small>
          <strong>{portionspreisText(sorte).replace(' / Portion', '')}</strong>
          <span>{preis ? preis : 'nicht hinterlegt'}</span>
        </div>
      </div>

      {(sorte.nachkochen || sorte.bald_ablaufen || (sorte.abgelaufen ?? 0) > 0) && (
        <p className="sorte-hinweise">
          {(sorte.abgelaufen ?? 0) > 0 && <span className="status status-warn">{mengeText(sorte.abgelaufen!, einheit)} abgelaufen</span>}
          {sorte.bald_ablaufen && <span className="status status-bald">bald verbrauchen</span>}
          {sorte.nachkochen && <span className="status status-nach">nachkochen (min. {sorte.mindestbestand})</span>}
        </p>
      )}

      {art.id !== 'zutat' && (
        <section className="abschnitt">
          <h3>Zusammensetzung</h3>
          {sorte.zusammensetzung?.length ? (
            <p className="chips">{sorte.zusammensetzung.map((z) => <span key={z} className="chip-statisch">{z}</span>)}</p>
          ) : (
            <p className="leise klein">
              Unbekannt – Kombi erfindet nichts dazu.{' '}
              {baukasten && <button type="button" className="link inline" onClick={onBearbeiten}>Ergänzen</button>}
            </p>
          )}
        </section>
      )}
      {sorte.notiz && <p className="notiz">{sorte.notiz}</p>}

      {sorte.anzahl > 0 && (
        <section className="abschnitt">
          <h3>Entnehmen</h3>
          <AnzahlWahl
            werte={werte}
            aktion="Entnehmen"
            deaktiviert={laeuft}
            beschriftung={einheit === 'portion' ? undefined : (n) => mengeText(n, einheit)}
            platzhalter={einheit === 'portion' ? 'Andere Anzahl' : `Andere Menge (${einheit === 'stueck' ? 'Stück' : einheit})`}
            onWahl={onEntnehmen}
          />
        </section>
      )}

      <div className="knopf-reihe">
        <button type="button" className="knopf" onClick={onEinfrieren}>
          <Icon name="plus" groesse={18} /> {buchungsVerb(sorte.lagerort).infinitiv.replace(/^./, (b) => b.toUpperCase())}
        </button>
        <button type="button" className="knopf" onClick={onBearbeiten}>Bearbeiten</button>
      </div>

      <section className="abschnitt">
        <h3>Chargen</h3>
        <p className="leise klein">Entnommen wird: geöffnet → frühester Ablauf → älteste.</p>
        {fehler && <p className="fehlertext">{fehler}</p>}
        {chargen === null && !fehler && <p className="leise">Lade …</p>}
        {chargen?.length === 0 && <p className="leise">Nichts mehr da.</p>}
        {chargen && chargen.length > 0 && (
          <ul className="chargen">
            {inEntnahmeReihenfolge(chargen, sorte.haltbar_tage).map((c) => (
              <li key={c.id}>
                <span className="charge-links">
                  <span>{datum(c.eingefroren_am)}</span>
                  <small>
                    {c.ablauf_am
                      ? `MHD ${datum(c.ablauf_am)} · ${ablaufText(c.ablauf_am)}`
                      : `haltbar bis ca. ${plusTage(c.eingefroren_am, sorte.haltbar_tage)}`}
                  </small>
                </span>
                <span className="chargen-rechts">
                  {c.geoeffnet_am && <span className="status status-offen">geöffnet</span>}
                  {!c.ablauf_am && tageSeit(c.eingefroren_am) > warnAb && <span className="status status-bald">bald</span>}
                  <strong>{mengeText(c.menge_aktuell, einheit)}</strong>
                  {baukasten && (
                    <button
                      type="button"
                      className={`mini-knopf${c.geoeffnet_am ? ' aktiv' : ''}`}
                      onClick={() => void oeffnen(c, !c.geoeffnet_am)}
                      aria-label={c.geoeffnet_am ? 'Als verschlossen markieren' : 'Als geöffnet markieren'}
                      title={c.geoeffnet_am ? 'Als verschlossen markieren' : 'Als geöffnet markieren'}
                    >
                      <Icon name="offen" groesse={16} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Blatt>
  );
}
