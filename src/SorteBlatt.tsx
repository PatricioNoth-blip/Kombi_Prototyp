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
import { fuellstand, plusTageIso, zustand } from './dashboard';
import { zustandKlasse } from './Vorrat';
import { naehrwertAus } from '../supabase/functions/_shared/kombi/naehrwerte.ts';
import { Bild } from './Bild';

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

  const z = zustand(sorte, heute);
  const zahl = mengeText(sorte.anzahl, einheit);
  const naehr = naehrwertAus(sorte, einheit);
  const kcalText = naehr && naehr.kcal !== null
    ? `${naehr.kcal.toLocaleString('de-DE')} kcal je ${mengeText(naehr.menge, einheit)}`
      + (naehr.protein_g !== null ? ` · ${naehr.protein_g.toLocaleString('de-DE')} g Eiweiß` : '')
    : null;

  return (
    <Blatt titel={sorte.name} onSchliessen={onSchliessen}>
      {/* Ebene 1: wie viel, wie dringend */}
      <div className={`sorte-kopf f-${sorte.farbe}`}>
        <Bild name={sorte.name} farbe={sorte.farbe} art="rund" />
        <div>
        <p className="sorte-art">
          <span className="punkt" aria-hidden="true" />
          {art.name}{art.id !== 'komplettgericht' ? ` · ${rolle}` : ''} · {lager.name}
        </p>
        <p className="sorte-menge">
          <strong>{zahl.split(' ')[0]}</strong>
          <span>{zahl.split(' ').slice(1).join(' ')}{einheit !== 'portion' && sorte.anzahl > 0 ? ` · ≈ ${Math.floor((sorte.anzahl / pm) * 10) / 10} Portionen` : ''}</span>
        </p>
        {z && <p className={`sorte-status ${zustandKlasse(z)}`}>{z.titel} · {z.text}</p>}
        {fuell && <span className="balken" aria-hidden="true"><span style={{ width: `${Math.round(fuell.anteil * 100)}%` }} /></span>}
        {reserviert && reserviert.menge > 0 && (
          <p className="meta-text">
            {mengeText(Math.min(reserviert.menge, sorte.anzahl), einheit)} eingeplant für „{reserviert.plaene.join('“, „')}“ · {mengeText(frei, einheit)} frei
          </p>
        )}
        </div>
      </div>

      {sorte.anzahl > 0 ? (
        <section className="abschnitt">
          <div className="abschnitt-kopf"><h3>{art.id === 'komplettgericht' ? 'Portionen entnehmen' : 'Entnehmen'}</h3></div>
          <AnzahlWahl
            werte={werte}
            aktion="Entnehmen"
            deaktiviert={laeuft}
            beschriftung={einheit === 'portion' ? undefined : (n) => mengeText(n, einheit)}
            platzhalter={einheit === 'portion' ? 'Andere Anzahl' : `Andere Menge (${einheit === 'stueck' ? 'Stück' : einheit})`}
            onWahl={onEntnehmen}
          />
          {art.id === 'komplettgericht' && <p className="abschnitt-fuss">Wird als Ganzes gegessen – entnommen werden ganze Portionen.</p>}
        </section>
      ) : (
        <p className="leise abstand-oben">Gerade nichts da.</p>
      )}

      {/* Ebene 2: was man damit machen kann */}
      {gerichte.typen.length > 0 && art.id !== 'zutat' && (
        <section className="abschnitt">
          <div className="abschnitt-kopf"><h3>Damit möglich</h3></div>
          <p className="gerichte-liste">
            {gerichte.typen.map((t) => <span key={t}><span aria-hidden="true">{GERICHT_EMOJI[t]}</span> {GERICHT_NAME[t]}</span>)}
          </p>
        </section>
      )}

      {partner.length > 0 && (
        <section className="abschnitt">
          <div className="abschnitt-kopf"><h3>Passt dazu</h3></div>
          <div className="chips">
            {partner.map((p) => {
              const b = bestand.find((x) => x.id === p.block_typ_id);
              return (
                <button key={p.id} type="button" className={`chip f-${p.farbe}`} onClick={() => b && onOeffnen(b)} disabled={!b}>
                  <span className="punkt" aria-hidden="true" /> {p.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {kannAuftauen && (
        <section className="abschnitt">
          <div className="abschnitt-kopf"><h3>Auftauen</h3></div>
          <div className="option-zeile">
            <div className="stepper">
              <button type="button" className="icon-knopf klein" aria-label="Weniger auftauen" disabled={auftauMenge <= 1}
                onClick={() => setAuftauMenge((n) => n - 1)}><Icon name="minus" groesse={16} /></button>
              <strong>{auftauMenge}</strong>
              <button type="button" className="icon-knopf klein" aria-label="Mehr auftauen" disabled={(auftauMenge + 1) * pm > frei}
                onClick={() => setAuftauMenge((n) => n + 1)}><Icon name="plus" groesse={16} /></button>
            </div>
            <span className="leise">{auftauMenge === 1 ? 'Portion' : 'Portionen'}</span>
          </div>
          <div className="knopf-reihe abstand-oben">
            <button type="button" className="knopf" onClick={() => void auftauen(true)}>Heute raus</button>
            <button type="button" className="knopf" onClick={() => void auftauen(false)}>Morgen raus</button>
          </div>
          <p className="abschnitt-fuss">Ändert den Bestand nicht – entnommen wird erst beim Kochen.</p>
        </section>
      )}

      {/* Ebene 3: Einzelheiten */}
      <details className="mehr-infos abstand-oben">
        <summary>Details</summary>
        <div className="info-zeilen">
          <div className="info-zeile"><span>Portion</span><span>{einheit === 'portion' ? `${sorte.groesse_g} g` : mengeText(pm, einheit)}</span></div>
          <div className="info-zeile"><span>Preis</span><span>{portionspreisText(sorte)}{preis ? ` (${preis})` : ''}</span></div>
          <div className="info-zeile">
            <span>Haltbar</span>
            <span>{sorte.naechster_ablauf ? `${datum(sorte.naechster_ablauf)} · ${ablaufText(sorte.naechster_ablauf)}` : sorte.aelteste ? `bis ca. ${plusTage(sorte.aelteste, sorte.haltbar_tage)}` : `${sorte.haltbar_tage} Tage ab Einbuchen`}</span>
          </div>
          <div className="info-zeile"><span>Nährwerte</span><span>{kcalText ?? 'nicht hinterlegt'}</span></div>
          {sorte.herkunft && <div className="info-zeile"><span>Herkunft</span><span>{sorte.herkunft}</span></div>}
          {sorte.nachkochen && <div className="info-zeile"><span>Mindestbestand</span><span>{sorte.mindestbestand}</span></div>}
        </div>

        {art.id !== 'zutat' && (
          <p className="klein">
            <span className="leise">Enthält: </span>
            {sorte.zusammensetzung?.length ? sorte.zusammensetzung.join(', ') : (
              <>unbekannt – Kombi erfindet nichts dazu.{' '}{baukasten && <button type="button" className="link inline" onClick={onBearbeiten}>Ergänzen</button>}</>
            )}
          </p>
        )}
        {sorte.notiz && <p className="klein">{sorte.notiz}</p>}

        {nutzung && nutzung.verbrauch_28 > 0 && (
          <p className="klein">
            <span className="leise">Nutzung: </span>
            in 4 Wochen {mengeText(nutzung.verbrauch_28, einheit)} verbraucht
            {nutzung.herstellungen_56 > 0 && ` · in 8 Wochen ${nutzung.herstellungen_56}× hergestellt, im Schnitt ${mengeText(nutzung.mittlere_menge, einheit)}`}.
            {batch && ` Nächstes Mal ${mengeText(batch.neu, einheit)} statt ${mengeText(batch.bisher, einheit)} vorkochen?`}
          </p>
        )}

        <div>
          <h3 className="unterkopf">Chargen · Entnahme: geöffnet → frühester Ablauf → älteste</h3>
          {fehler && <p className="fehlertext">{fehler}</p>}
          {chargen === null && !fehler && <p className="leise">Lade …</p>}
          {chargen?.length === 0 && <p className="leise klein">Nichts mehr da.</p>}
          {chargen && chargen.length > 0 && (
            <ul className="liste chargen">
              {inEntnahmeReihenfolge(chargen, sorte.haltbar_tage).map((c) => (
                <li key={c.id}>
                  <span className="charge-links">
                    <span>{datum(c.eingefroren_am)}</span>
                    <small>
                      {c.ablauf_am
                        ? `MHD ${datum(c.ablauf_am)} · ${ablaufText(c.ablauf_am)}`
                        : `haltbar bis ca. ${plusTage(c.eingefroren_am, sorte.haltbar_tage)}`}
                      {c.geoeffnet_am ? ' · geöffnet' : !c.ablauf_am && tageSeit(c.eingefroren_am) > warnAb ? ' · bald' : ''}
                    </small>
                  </span>
                  <span className="chargen-rechts">
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
        </div>
      </details>

      <div className="knopf-reihe abstand-oben">
        <button type="button" className="knopf" onClick={onEinfrieren}>
          <Icon name="plus" groesse={18} /> {buchungsVerb(sorte.lagerort).infinitiv.replace(/^./, (b) => b.toUpperCase())}
        </button>
        <button type="button" className="knopf" onClick={onBearbeiten}>Bearbeiten</button>
      </div>
    </Blatt>
  );
}
