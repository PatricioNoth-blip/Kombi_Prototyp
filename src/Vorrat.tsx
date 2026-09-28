import { useState, type ReactNode } from 'react';
import type { Sorte } from './api';
import { ARTEN_INFO, farbe as farbInfo, lagerort, LAGERORTE } from './farben';
import { Icon, type IconName } from './Icon';
import { artVon, einheitVon, euro, mengeKurz, portionMengeVon } from './format';
import { heuteWichtig, ortKacheln, sortenFuer, vorratswert, zustand, type Wichtig } from './dashboard';
import type { NavZustand } from './navigation';

type Props = {
  bestand: Sorte[];
  heute: string;
  nav: NavZustand['vorrat'];
  onNav: (teil: Partial<NavZustand['vorrat']>) => void;
  onZurueck: () => void;
  laeuft: Set<number>;
  /** für Pläne reserviert (Einheit der Sorte) */
  reserviert: Map<number, number>;
  /** „Für heute auftauen“ (fertig gerendert, kann leer sein) */
  auftauen: ReactNode;
  onOeffnen: (s: Sorte) => void;
  onEntnehmen: (s: Sorte, menge: number) => void;
};

/** Eine Portion – oder der Rest, wenn weniger da ist. */
export const einePortion = (s: Sorte) => Math.min(portionMengeVon(s), s.anzahl);

const rolleVon = (s: Sorte) => (artVon(s) === 'komplettgericht' ? 'Komplettgericht' : farbInfo(s.farbe).bedeutung);

/** Farbe des Zustands: kritisch (rot), Aufmerksamkeit (orange), Info (blau), sonst neutral */
export const zustandKlasse = (w: Wichtig) =>
  w.art === 'abgelaufen' ? 'status-kritisch' : w.art === 'bald' ? 'status-achtung' : w.art === 'niedrig' ? '' : 'status-info';

export function WichtigZeile({ w, onOeffnen }: { w: Wichtig; onOeffnen: (s: Sorte) => void }) {
  return (
    <li className={`f-${w.sorte.farbe}`}>
      <button type="button" className="zeile" onClick={() => onOeffnen(w.sorte)}>
        <span className="punkt" aria-hidden="true" />
        <span className="zeile-haupt">
          <span className="zeile-titel">{w.sorte.name}</span>
          <span className="zeile-meta">
            <span className={zustandKlasse(w)}>{w.art === 'niedrig' || w.art === 'bald' ? w.text : w.titel}</span> · {lagerort(w.sorte.lagerort).name}
          </span>
        </span>
        <Icon name="pfeil" groesse={16} className="zeile-pfeil" />
      </button>
    </li>
  );
}

function Suchfeld({ wert, onAendern }: { wert: string; onAendern: (t: string) => void }) {
  return (
    <label className="suchfeld">
      <Icon name="suche" groesse={17} />
      <input type="search" value={wert} onChange={(e) => onAendern(e.target.value)} placeholder="Suchen" aria-label="Im Vorrat suchen" />
      {wert && (
        <button type="button" className="such-leeren" onClick={() => onAendern('')} aria-label="Suche leeren">
          <Icon name="schliessen" groesse={12} />
        </button>
      )}
    </label>
  );
}

function SorteZeile({ s, heute, reserviert, zeigeOrt, laeuft, onOeffnen, onEntnehmen }: {
  s: Sorte; heute: string; reserviert: number; zeigeOrt: boolean; laeuft: boolean;
  onOeffnen: (s: Sorte) => void; onEntnehmen: (s: Sorte, menge: number) => void;
}) {
  const menge = mengeKurz(s.anzahl, einheitVon(s));
  const z = zustand(s, heute);
  const unter = z
    ? <span className={zustandKlasse(z)}>{z.art === 'niedrig' || z.art === 'bald' ? z.text : z.titel}</span>
    : reserviert > 0
      ? <span>{mengeKurz(reserviert, einheitVon(s)).zahl} eingeplant</span>
      : <span>{zeigeOrt ? `${rolleVon(s)} · ${lagerort(s.lagerort).name}` : rolleVon(s)}</span>;
  return (
    <li className={`vorrat-zeile f-${s.farbe}`}>
      <div className={`zeile${s.anzahl === 0 ? ' leer' : ''}`}>
        <button type="button" className="zeile-knopf" onClick={() => onOeffnen(s)}>
          <span className="punkt" aria-hidden="true" />
          <span className="zeile-haupt">
            <span className="zeile-titel">{s.name}</span>
            <span className="zeile-meta">{unter}</span>
          </span>
          <span className="zeile-wert" aria-label={`${menge.zahl} ${menge.einheit}`}><strong>{menge.zahl}</strong> {menge.einheit}</span>
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
      </div>
    </li>
  );
}

/** Der Vorrat: erst was wichtig ist und wo was liegt – Einzelheiten erst beim Öffnen. */
export function Vorrat({ bestand, heute, nav, onNav, onZurueck, laeuft, reserviert, auftauen, onOeffnen, onEntnehmen }: Props) {
  const [alleWichtig, setAlleWichtig] = useState(false);

  if (bestand.length === 0) {
    return (
      <div className="leer-zustand">
        <Icon name="vorrat" groesse={40} />
        <p>Noch nichts im Vorrat. Oben auf <strong>+</strong> tippen und die erste Sorte anlegen.</p>
      </div>
    );
  }

  const zeile = (s: Sorte, zeigeOrt: boolean) => (
    <SorteZeile key={s.id} s={s} heute={heute} reserviert={reserviert.get(s.id) ?? 0} zeigeOrt={zeigeOrt}
      laeuft={laeuft.has(s.id)} onOeffnen={onOeffnen} onEntnehmen={onEntnehmen} />
  );

  // ───────── Ein Lagerort (oder alles) ─────────
  if (nav.ort) {
    const ort = nav.ort;
    const titel = ort === 'alle' ? (nav.art === 'komponente' ? 'Komponenten' : 'Alle Sorten') : lagerort(ort).name;
    const imOrt = sortenFuer(bestand, { ort, art: null, suche: '' }, heute);
    const arten = ARTEN_INFO.filter((a) => imOrt.some((s) => artVon(s) === a.id));
    const sorten = sortenFuer(bestand, { ort, art: nav.art, suche: nav.suche }, heute);
    const da = imOrt.filter((s) => s.anzahl > 0).length;
    return (
      <div className="ort-ansicht">
        <button type="button" className="zurueck-knopf" onClick={onZurueck}>
          <Icon name="zurueck" groesse={18} /> Vorrat
        </button>
        <div className="ort-kopf">
          <h2>{titel}</h2>
          <p className="leise klein">{da} von {imOrt.length} Sorten da</p>
        </div>
        <Suchfeld wert={nav.suche} onAendern={(t) => onNav({ suche: t })} />
        {arten.length > 1 && (
          <div className="chips scroll abstand-oben" role="group" aria-label="Nach Art filtern">
            <button type="button" className={`chip${nav.art === null ? ' gewaehlt' : ''}`} aria-pressed={nav.art === null} onClick={() => onNav({ art: null })}>
              Alle
            </button>
            {arten.map((a) => (
              <button key={a.id} type="button" className={`chip${nav.art === a.id ? ' gewaehlt' : ''}`} aria-pressed={nav.art === a.id} onClick={() => onNav({ art: a.id })}>
                {a.mehrzahl}
              </button>
            ))}
          </div>
        )}
        {sorten.length === 0 ? (
          <p className="leer-zustand">Nichts gefunden.</p>
        ) : nav.art || nav.suche ? (
          <ul className="liste abstand-oben">{sorten.map((s) => zeile(s, ort === 'alle'))}</ul>
        ) : (
          arten.map((a) => {
            const gruppe = sorten.filter((s) => artVon(s) === a.id);
            if (gruppe.length === 0) return null;
            return (
              <section key={a.id}>
                <h3 className="unterkopf">{a.mehrzahl}</h3>
                <ul className="liste">{gruppe.map((s) => zeile(s, ort === 'alle'))}</ul>
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
        {treffer.length === 0 ? <p className="leer-zustand">Nichts gefunden.</p> : <ul className="liste abstand-oben">{treffer.map((s) => zeile(s, true))}</ul>}
      </>
    );
  }

  const wichtig = heuteWichtig(bestand, heute);
  const kacheln = ortKacheln(bestand, heute);
  const wert = vorratswert(bestand);
  const komponenten = bestand.filter((s) => artVon(s) === 'komponente');
  const ICON: Record<string, IconName> = Object.fromEntries(LAGERORTE.map((l) => [l.id, l.icon]));

  return (
    <>
      <Suchfeld wert={nav.suche} onAendern={(t) => onNav({ suche: t })} />

      {wichtig.length > 0 && (
        <section className="abschnitt" aria-label="Heute wichtig">
          <div className="abschnitt-kopf">
            <h2>Heute wichtig</h2>
            {wichtig.length > 3 && (
              <button type="button" className="link" onClick={() => setAlleWichtig((a) => !a)}>
                {alleWichtig ? 'Weniger' : `Alle ${wichtig.length}`}
              </button>
            )}
          </div>
          <ul className="liste">
            {(alleWichtig ? wichtig : wichtig.slice(0, 3)).map((w) => <WichtigZeile key={w.sorte.id} w={w} onOeffnen={onOeffnen} />)}
          </ul>
        </section>
      )}

      {auftauen}

      <section className="abschnitt" aria-label="Lagerorte">
        <div className="abschnitt-kopf"><h2>Lagerorte</h2></div>
        <ul className="liste mit-icon">
          {kacheln.map((k) => (
            <li key={k.id} className="ort-zeile">
              <button type="button" className="zeile" onClick={() => onNav({ ort: k.id })}>
                <span className="icon-kachel"><Icon name={ICON[k.id]} groesse={18} /></span>
                <span className="zeile-haupt">
                  <span className="zeile-titel">{LAGERORTE.find((l) => l.id === k.id)!.name}</span>
                  <span className="zeile-meta">
                    {k.sorten === 0 ? 'leer' : `${k.sorten} ${k.sorten === 1 ? 'Sorte' : 'Sorten'}`}
                    {k.achtung > 0 && <span className="status-achtung"> · {k.achtung} wichtig</span>}
                  </span>
                </span>
                <span className="zeile-wert"><strong>{k.zahl}</strong> {k.einheit === 'Portionen' ? 'Port.' : k.einheit}</span>
                <Icon name="pfeil" groesse={16} className="zeile-pfeil" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="abschnitt">
        <ul className="liste mit-icon">
          {komponenten.length > 0 && (
            <li>
              <button type="button" className="zeile" onClick={() => onNav({ ort: 'alle', art: 'komponente' })}>
                <span className="icon-kachel"><Icon name="baustein" groesse={18} /></span>
                <span className="zeile-haupt">
                  <span className="zeile-titel">Komponenten</span>
                  <span className="zeile-meta">vorgekocht im Bestand</span>
                </span>
                <span className="zeile-wert"><strong>{komponenten.filter((s) => s.anzahl > 0).length}</strong> da</span>
                <Icon name="pfeil" groesse={16} className="zeile-pfeil" />
              </button>
            </li>
          )}
          <li>
            <button type="button" className="zeile alle-knopf" onClick={() => onNav({ ort: 'alle' })}>
              <span className="icon-kachel"><Icon name="sorten" groesse={18} /></span>
              <span className="zeile-haupt"><span className="zeile-titel">Alle Sorten</span></span>
              <span className="zeile-wert">{bestand.length}</span>
              <Icon name="pfeil" groesse={16} className="zeile-pfeil" />
            </button>
          </li>
        </ul>
        {wert.cent > 0 && (
          <p className="abschnitt-fuss">
            Wert des Vorrats ≈ {euro(wert.cent)}{wert.ohne_preis > 0 ? ` – ohne ${wert.ohne_preis} ${wert.ohne_preis === 1 ? 'Sorte' : 'Sorten'} ohne Preis` : ''}
          </p>
        )}
      </section>
    </>
  );
}
