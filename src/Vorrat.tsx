import type { ReactNode } from 'react';
import type { Sorte } from './api';
import { ARTEN_INFO, farbe as farbInfo, lagerort, LAGERORTE } from './farben';
import { Icon, type IconName } from './Icon';
import { artVon, einheitVon, euro, mengeKurz, portionMengeVon } from './format';
import { fuellstand, heuteWichtig, ortKacheln, sortenFuer, vorratswert, zustand, type WichtigArt } from './dashboard';
import type { NavZustand } from './navigation';

type Props = {
  bestand: Sorte[];
  heute: string;
  nav: NavZustand['vorrat'];
  onNav: (teil: Partial<NavZustand['vorrat']>) => void;
  laeuft: Set<number>;
  /** für Pläne reserviert (Einheit der Sorte) */
  reserviert: Map<number, number>;
  einkauf: { offen: number; kosten: string | null } | null;
  /** „Für heute auftauen“ (fertig gerendert, kann leer sein) */
  auftauen: ReactNode;
  onOeffnen: (s: Sorte) => void;
  onEntnehmen: (s: Sorte, menge: number) => void;
  onZumEinkauf: () => void;
};

const WICHTIG_ICON: Record<WichtigArt, IconName> = {
  abgelaufen: 'info', aufgetaut: 'schneeflocke', geoeffnet: 'offen', bald: 'uhr', niedrig: 'korb',
};

/** Eine Portion – oder der Rest, wenn weniger da ist. */
export const einePortion = (s: Sorte) => Math.min(portionMengeVon(s), s.anzahl);

const rolleVon = (s: Sorte) => (artVon(s) === 'komplettgericht' ? 'Komplettgericht' : farbInfo(s.farbe).bedeutung);

function Suchfeld({ wert, onAendern }: { wert: string; onAendern: (t: string) => void }) {
  return (
    <label className="suchfeld">
      <Icon name="suche" groesse={18} />
      <input type="search" value={wert} onChange={(e) => onAendern(e.target.value)} placeholder="Im Vorrat suchen" aria-label="Im Vorrat suchen" />
      {wert && (
        <button type="button" className="such-leeren" onClick={() => onAendern('')} aria-label="Suche leeren">
          <Icon name="schliessen" groesse={14} />
        </button>
      )}
    </label>
  );
}

function VorratKarte({ s, heute, reserviert, zeigeOrt, laeuft, onOeffnen, onEntnehmen }: {
  s: Sorte; heute: string; reserviert: number; zeigeOrt: boolean; laeuft: boolean;
  onOeffnen: (s: Sorte) => void; onEntnehmen: (s: Sorte, menge: number) => void;
}) {
  const menge = mengeKurz(s.anzahl, einheitVon(s));
  const fuell = fuellstand(s);
  const z = zustand(s, heute);
  const lager = lagerort(s.lagerort);
  return (
    <li className={`vorrat-karte f-${s.farbe}${s.anzahl === 0 ? ' leer' : ''}`}>
      <button type="button" className="vk-oeffnen" onClick={() => onOeffnen(s)}>
        <span className="vk-rolle"><span className="farbpunkt" aria-hidden="true" />{rolleVon(s)}</span>
        <span className="vk-name">{s.name}</span>
        <span className="vk-menge" aria-label={`${menge.zahl} ${menge.einheit}`}>
          <strong>{menge.zahl}</strong> <small>{menge.einheit}</small>
        </span>
        {fuell && (
          <span className="vk-balken" title={fuell.text} aria-hidden="true">
            <span style={{ width: `${Math.round(fuell.anteil * 100)}%` }} />
          </span>
        )}
        <span className="vk-fuss">
          {z ? (
            <span className={`pille pille-${z.art}`}>{z.art === 'niedrig' ? z.text : z.titel}</span>
          ) : reserviert > 0 ? (
            <span className="pille pille-geplant">{mengeKurz(reserviert, einheitVon(s)).zahl} eingeplant</span>
          ) : zeigeOrt ? (
            <span className="vk-ort"><Icon name={lager.icon} groesse={13} /> {lager.name}</span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        className="minus"
        disabled={s.anzahl === 0 || laeuft}
        onClick={() => onEntnehmen(s, einePortion(s))}
        aria-label={`Eine Portion ${s.name} entnehmen`}
      >
        <Icon name="minus" groesse={16} />
      </button>
    </li>
  );
}

/** Der Vorrat als Haushalts-Übersicht – und je Lagerort als Karten mit Füllstand. */
export function Vorrat({ bestand, heute, nav, onNav, laeuft, reserviert, einkauf, auftauen, onOeffnen, onEntnehmen, onZumEinkauf }: Props) {
  if (bestand.length === 0) {
    return (
      <div className="leer-zustand">
        <Icon name="vorrat" groesse={40} />
        <p>Noch keine Sorten. Tippe unten auf <strong>+</strong> und lege die erste an.</p>
      </div>
    );
  }

  const karte = (s: Sorte, zeigeOrt: boolean) => (
    <VorratKarte key={s.id} s={s} heute={heute} reserviert={reserviert.get(s.id) ?? 0} zeigeOrt={zeigeOrt}
      laeuft={laeuft.has(s.id)} onOeffnen={onOeffnen} onEntnehmen={onEntnehmen} />
  );

  // ───────── Ein Lagerort (oder alles) ─────────
  if (nav.ort) {
    const ort = nav.ort;
    const info = ort === 'alle' ? { name: 'Alle Sorten', icon: 'vorrat' as IconName } : lagerort(ort);
    const imOrt = sortenFuer(bestand, { ort, art: null, suche: '' }, heute);
    const arten = ARTEN_INFO.filter((a) => imOrt.some((s) => artVon(s) === a.id));
    const sorten = sortenFuer(bestand, { ort, art: nav.art, suche: nav.suche }, heute);
    const da = imOrt.filter((s) => s.anzahl > 0).length;
    return (
      <div className="ort-ansicht">
        <button type="button" className="zurueck-knopf" onClick={() => onNav({ ort: null, suche: '' })}>
          <Icon name="zurueck" groesse={18} /> Vorrat
        </button>
        <div className={`ort-titel ort-${ort}`}>
          <span className="ok-icon"><Icon name={info.icon} groesse={22} /></span>
          <div>
            <h2>{info.name}</h2>
            <p className="leise klein">{da} von {imOrt.length} Sorten da</p>
          </div>
        </div>
        <Suchfeld wert={nav.suche} onAendern={(t) => onNav({ suche: t })} />
        {arten.length > 1 && (
          <div className="filter-chips" role="group" aria-label="Nach Art filtern">
            <button type="button" className={nav.art === null ? 'gewaehlt' : ''} aria-pressed={nav.art === null} onClick={() => onNav({ art: null })}>
              Alle <small>{imOrt.length}</small>
            </button>
            {arten.map((a) => (
              <button key={a.id} type="button" className={nav.art === a.id ? 'gewaehlt' : ''} aria-pressed={nav.art === a.id} onClick={() => onNav({ art: a.id })}>
                {a.mehrzahl} <small>{imOrt.filter((s) => artVon(s) === a.id).length}</small>
              </button>
            ))}
          </div>
        )}
        {sorten.length === 0 ? (
          <p className="leise leer-zustand">Nichts gefunden.</p>
        ) : nav.art || nav.suche ? (
          <ul className="karten-raster">{sorten.map((s) => karte(s, ort === 'alle'))}</ul>
        ) : (
          arten.map((a) => {
            const gruppe = sorten.filter((s) => artVon(s) === a.id);
            if (gruppe.length === 0) return null;
            return (
              <section key={a.id} className="gruppe">
                <h3 className="abschnitt-titel">{a.mehrzahl}</h3>
                <ul className="karten-raster">{gruppe.map((s) => karte(s, ort === 'alle'))}</ul>
              </section>
            );
          })
        )}
      </div>
    );
  }

  // ───────── Übersicht ─────────
  if (nav.suche) {
    const treffer = sortenFuer(bestand, { ort: 'alle', art: null, suche: nav.suche }, heute);
    return (
      <>
        <Suchfeld wert={nav.suche} onAendern={(t) => onNav({ suche: t })} />
        {treffer.length === 0 ? <p className="leise leer-zustand">Nichts gefunden.</p> : <ul className="karten-raster">{treffer.map((s) => karte(s, true))}</ul>}
      </>
    );
  }

  const wichtig = heuteWichtig(bestand, heute);
  const kacheln = ortKacheln(bestand, heute);
  const wert = vorratswert(bestand);

  return (
    <>
      <Suchfeld wert={nav.suche} onAendern={(t) => onNav({ suche: t })} />

      <section className="wichtig-bereich" aria-label="Heute wichtig">
        <h2 className="abschnitt-titel">Heute wichtig</h2>
        {wichtig.length === 0 ? (
          <p className="alles-gut"><Icon name="haken" groesse={18} /> Nichts Dringendes – alles im grünen Bereich.</p>
        ) : (
          <ul className="wichtig-leiste">
            {wichtig.map((w) => {
              const lager = lagerort(w.sorte.lagerort);
              return (
                <li key={w.sorte.id}>
                  <button type="button" className={`wichtig-karte w-${w.art} f-${w.sorte.farbe}`} onClick={() => onOeffnen(w.sorte)}>
                    <span className="wk-art"><Icon name={WICHTIG_ICON[w.art]} groesse={14} /> {w.titel}</span>
                    <span className="wk-name">{w.sorte.name}</span>
                    <span className="wk-text">{w.text}</span>
                    <span className="wk-ort"><span className="farbpunkt" aria-hidden="true" /> {lager.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {auftauen}

      <section aria-label="Lagerorte">
        <h2 className="abschnitt-titel">Lagerorte</h2>
        <div className="ort-kacheln">
          {kacheln.map((k) => {
            const l = LAGERORTE.find((x) => x.id === k.id)!;
            return (
              <button key={k.id} type="button" className={`ort-kachel ort-${k.id}`} onClick={() => onNav({ ort: k.id })}>
                <span className="ok-icon"><Icon name={l.icon} groesse={22} /></span>
                <span className="ok-text">
                  <strong>{l.name}</strong>
                  <small>
                    {k.sorten === 0 ? 'noch leer' : `${k.sorten} ${k.sorten === 1 ? 'Sorte' : 'Sorten'}`}
                    {k.achtung > 0 && <span className="ok-achtung"> · {k.achtung} wichtig</span>}
                  </small>
                </span>
                <span className="ok-zahl"><strong>{k.zahl}</strong><small>{k.einheit}</small></span>
                <span className="ok-balken" aria-hidden="true">
                  {k.farben.map((f) => <span key={f.farbe} className={`f-${f.farbe}`} style={{ flexGrow: f.anteil }} />)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="kennzahl-reihe">
        <div className="kennzahl-karte">
          <small>Wert des Vorrats</small>
          <strong>{wert.cent > 0 ? `≈ ${euro(wert.cent)}` : '–'}</strong>
          <span>{wert.ohne_preis > 0 ? `${wert.ohne_preis} ohne Preis` : 'aus euren Preisen'}</span>
        </div>
        {einkauf && (
          <button type="button" className="kennzahl-karte" onClick={onZumEinkauf}>
            <small>Einkaufsliste</small>
            <strong>{einkauf.offen === 0 ? 'Leer' : `${einkauf.offen} offen`}</strong>
            <span>{einkauf.kosten ?? 'Nichts zu kaufen'}</span>
          </button>
        )}
      </div>

      <button type="button" className="knopf breit alle-knopf" onClick={() => onNav({ ort: 'alle' })}>
        Alle {bestand.length} Sorten ansehen <Icon name="pfeil" groesse={18} />
      </button>
    </>
  );
}
