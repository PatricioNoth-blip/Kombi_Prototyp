import { useEffect, useMemo, useState } from 'react';
import * as api from './api';
import { fehlerText, ladeChargen, type Charge, type Sorte } from './api';
import { Blatt, AnzahlWahl } from './Blatt';
import { ARTEN_INFO, buchungsVerb, farbe as farbInfo, lagerort } from './farben';
import { Icon } from './Icon';
import {
  ablaufText, artVon, datum, einheitVon, mengeText, plusTage, portionMengeVon, portionspreisText, preisMitBezug, tageSeit,
} from './format';
import { GERICHT_EMOJI, GERICHT_NAME, gerichtstypenVon, partnerVon } from '../supabase/functions/_shared/kombi/rollen.ts';
import { batchEmpfehlungen, type NutzungZeile } from '../supabase/functions/_shared/kombi/batch.ts';
import { baueSnapshotAus } from './essenApi';
import { auftauenVormerken } from './haushalt';
import { fuellstand, plusTageIso } from './dashboard';

type Props = {
  sorte: Sorte;
  bestand: Sorte[];
  baukasten: boolean;
  planung: boolean;
  heute: string;
  laeuft: boolean;
  /** für geplante Mahlzeiten/Komponenten reserviert */
  reserviert: { menge: number; plaene: string[] } | null;
  nutzung: NutzungZeile | null;
  onEntnehmen: (menge: number) => void;
  onEinfrieren: () => void;
  onBearbeiten: () => void;
  onOeffnen: (s: Sorte) => void;
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

/** Details einer Sorte: Funktion im Baukasten, Bestand, Kosten, wofür sie taugt, was dazu passt, Chargen. */
export function SorteBlatt({
  sorte, bestand, baukasten, planung, heute, laeuft, reserviert, nutzung,
  onEntnehmen, onEinfrieren, onBearbeiten, onOeffnen, onGeaendert, onFehler, onSchliessen,
}: Props) {
  const [chargen, setChargen] = useState<Charge[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuLaden, setNeuLaden] = useState(0);
  const [auftauMenge, setAuftauMenge] = useState(1);

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
  const rolle = art.id === 'komplettgericht' ? 'Komplettgericht' : farbInfo(sorte.farbe).bedeutung;
  const warnAb = sorte.haltbar_tage - 14;
  const preis = preisMitBezug(sorte);
  const fuell = fuellstand(sorte);
  const gerichte = gerichtstypenVon(sorte);
  const partner = useMemo(
    () => partnerVon({ name: sorte.name, farbe: sorte.farbe, gerichtstypen: sorte.gerichtstypen, richtung: sorte.richtung }, baueSnapshotAus(bestand, '').zutaten, 6),
    [sorte, bestand],
  );
  const batch = nutzung
    ? batchEmpfehlungen([{ id: sorte.id, name: sorte.name, art: art.id, herkunft: sorte.herkunft ?? null, einheit, haltbar_tage: sorte.haltbar_tage, lagerort: sorte.lagerort ?? 'gefrierfach' }], [nutzung])[0]
    : undefined;
  const frei = Math.max(0, sorte.anzahl - (reserviert?.menge ?? 0));
  const kannAuftauen = planung && (sorte.lagerort ?? 'gefrierfach') === 'gefrierfach' && art.id !== 'zutat' && frei > 0;

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

  async function auftauen(sofort: boolean) {
    const menge = Math.min(frei, auftauMenge * pm);
    try {
      await auftauenVormerken(sorte.id, menge, sofort ? heute : plusTageIso(heute, 1), null, sofort);
      onGeaendert(sofort
        ? `${mengeText(menge, einheit)} ${sorte.name} tauen auf – bald verbrauchen.`
        : `${sorte.name}: morgen ${mengeText(menge, einheit)} herausnehmen (vorgemerkt).`);
    } catch (e) {
      onFehler(fehlerText(e));
    }
  }

  return (
    <Blatt titel={sorte.name} onSchliessen={onSchliessen}>
      <p className="pillen">
        <span className={`pille-rolle f-${sorte.farbe}`}><span className="farbpunkt" aria-hidden="true" />{rolle}</span>
        <span className="pille-grau">{art.name}</span>
        <span className="pille-grau"><Icon name={lager.icon} groesse={13} /> {lager.name}</span>
        {sorte.herkunft && <span className="pille-grau">{sorte.herkunft}</span>}
        {sorte.richtung && <span className="pille-grau">{sorte.richtung}</span>}
      </p>

      <div className={`bestand-karte f-${sorte.farbe}`}>
        <div className="bk-zahl">
          <strong>{mengeText(sorte.anzahl, einheit).split(' ')[0]}</strong>
          <span>{mengeText(sorte.anzahl, einheit).split(' ').slice(1).join(' ')}</span>
          {einheit !== 'portion' && sorte.anzahl > 0 && <small>≈ {Math.floor((sorte.anzahl / pm) * 10) / 10} Portionen</small>}
        </div>
        {fuell && (
          <div className="bk-fuell">
            <span className="vk-balken"><span style={{ width: `${Math.round(fuell.anteil * 100)}%` }} /></span>
            <small>Bestand {fuell.text}</small>
          </div>
        )}
        {reserviert && reserviert.menge > 0 && (
          <p className="bk-reserviert">
            <Icon name="kalender" groesse={14} /> {mengeText(Math.min(reserviert.menge, sorte.anzahl), einheit)} eingeplant für „{reserviert.plaene.join('“, „')}“ · {mengeText(frei, einheit)} frei
          </p>
        )}
      </div>

      <div className="kennzahlen">
        <div>
          <small>Portion</small>
          <strong>{einheit === 'portion' ? `${sorte.groesse_g} g` : mengeText(pm, einheit)}</strong>
          <span>{einheit === 'portion' ? 'pro Portion' : 'gilt als Portion'}</span>
        </div>
        <div>
          <small>Pro Portion</small>
          <strong>{portionspreisText(sorte).replace(' / Portion', '')}</strong>
          <span>{preis ?? 'nicht hinterlegt'}</span>
        </div>
        <div>
          <small>Haltbar</small>
          <strong>{sorte.naechster_ablauf ? datum(sorte.naechster_ablauf).slice(0, 6) : `${sorte.haltbar_tage} Tage`}</strong>
          <span>{sorte.naechster_ablauf ? ablaufText(sorte.naechster_ablauf) : sorte.aelteste ? `bis ca. ${plusTage(sorte.aelteste, sorte.haltbar_tage)}` : 'ab Einbuchen'}</span>
        </div>
      </div>

      {(sorte.nachkochen || sorte.bald_ablaufen || (sorte.abgelaufen ?? 0) > 0 || (sorte.aufgetaut ?? 0) > 0) && (
        <p className="sorte-hinweise">
          {(sorte.abgelaufen ?? 0) > 0 && <span className="status status-warn">{mengeText(sorte.abgelaufen!, einheit)} abgelaufen</span>}
          {(sorte.aufgetaut ?? 0) > 0 && <span className="status status-offen">{mengeText(sorte.aufgetaut!, einheit)} aufgetaut</span>}
          {sorte.bald_ablaufen && <span className="status status-bald">bald verbrauchen</span>}
          {sorte.nachkochen && <span className="status status-nach">{art.id === 'zutat' ? 'nachkaufen' : 'nachkochen'} (min. {sorte.mindestbestand})</span>}
        </p>
      )}

      {art.id !== 'zutat' && (
        <section className="abschnitt">
          <h3>Enthält</h3>
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

      {gerichte.typen.length > 0 && (
        <section className="abschnitt">
          <h3>Damit möglich</h3>
          <p className="gericht-chips">
            {gerichte.typen.map((t) => <span key={t}><span aria-hidden="true">{GERICHT_EMOJI[t]}</span> {GERICHT_NAME[t]}</span>)}
          </p>
          <p className="leise klein">
            {gerichte.typen.length >= 6 ? `Verwendbar für ${gerichte.typen.length}+ Gerichtsarten. ` : ''}
            {gerichte.quelle === 'typisch' ? `Typisch für ${rolle} – eigene Auswahl unter „Bearbeiten“.` : 'Von euch hinterlegt.'}
          </p>
        </section>
      )}

      {partner.length > 0 && (
        <section className="abschnitt">
          <h3>Passt dazu aus dem Vorrat</h3>
          <p className="chips">
            {partner.map((p) => {
              const s = bestand.find((b) => b.id === p.block_typ_id);
              return (
                <button key={p.id} type="button" className={`chip-knopf f-${p.farbe}`} onClick={() => s && onOeffnen(s)} disabled={!s}>
                  <span className="farbpunkt" aria-hidden="true" /> {p.name}
                </button>
              );
            })}
          </p>
        </section>
      )}

      {nutzung && nutzung.verbrauch_28 > 0 && (
        <section className="abschnitt">
          <h3>Nutzung</h3>
          <p className="klein">
            In den letzten 4 Wochen {mengeText(nutzung.verbrauch_28, einheit)} verbraucht
            {nutzung.herstellungen_56 > 0 && ` · in 8 Wochen ${nutzung.herstellungen_56}× hergestellt, im Schnitt ${mengeText(nutzung.mittlere_menge, einheit)}`}.
          </p>
          {batch && (
            <div className="batch-hinweis">
              <strong>Nächstes Mal {mengeText(batch.neu, einheit)} statt {mengeText(batch.bisher, einheit)} vorkochen?</strong>
              <ul className="gruende">{batch.gruende.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
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

      {kannAuftauen && (
        <section className="abschnitt">
          <h3>Auftauen</h3>
          <div className="auftau-wahl">
            <div className="stepper">
              <button type="button" className="icon-knopf klein" aria-label="Weniger auftauen" disabled={auftauMenge <= 1}
                onClick={() => setAuftauMenge((n) => n - 1)}><Icon name="minus" groesse={16} /></button>
              <strong>{auftauMenge}</strong>
              <button type="button" className="icon-knopf klein" aria-label="Mehr auftauen" disabled={(auftauMenge + 1) * pm > frei}
                onClick={() => setAuftauMenge((n) => n + 1)}><Icon name="plus" groesse={16} /></button>
            </div>
            <span className="leise klein">{auftauMenge === 1 ? 'Portion' : 'Portionen'}</span>
          </div>
          <div className="knopf-reihe">
            <button type="button" className="knopf" onClick={() => void auftauen(true)}><Icon name="schneeflocke" groesse={18} /> Heute herausgenommen</button>
            <button type="button" className="knopf" onClick={() => void auftauen(false)}><Icon name="kalender" groesse={18} /> Morgen auftauen</button>
          </div>
          <p className="leise klein">Ändert den Bestand nicht – entnommen wird erst beim Kochen.</p>
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
