import type { ReactNode } from 'react';
import type { NutzungZeile } from '../supabase/functions/_shared/kombi/batch.ts';
import type { Sorte } from './api';
import { ARTEN_INFO, farbe as farbInfo, lagerort, LAGERORTE } from './farben';
import { Icon, type IconName } from './Icon';
import { artVon, einheitVon, euro, mengeKurz, mengeText, portionMengeVon } from './format';
import { heuteWichtig, ortKacheln, sortenFuer, vorratswert, zustand, type Wichtig } from './dashboard';
import { Bild, DEKO, ORT_FOTO } from './Bild';
import { sortenBild } from './bildApi';
import { Box, tonVon, WarnIcon, WichtigKacheln, zustandKurz } from './Karten';
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
  nutzung: NutzungZeile[];
  onOeffnen: (s: Sorte) => void;
  onEntnehmen: (s: Sorte, menge: number) => void;
};

/** Eine Portion – oder der Rest, wenn weniger da ist. */
export const einePortion = (s: Sorte) => Math.min(portionMengeVon(s), s.anzahl);

const rolleVon = (s: Sorte) => (artVon(s) === 'komplettgericht' ? 'Komplettgericht' : farbInfo(s.farbe).bedeutung);

/** Farbe des Zustands – wie die Kacheln: läuft ab/abgelaufen rot, geöffnet gelb, aufgetaut blau, knapp neutral */
export const zustandKlasse = (w: Wichtig) =>
  w.art === 'abgelaufen' || w.art === 'bald' ? 'status-kritisch' : w.art === 'geoeffnet' ? 'status-achtung' : w.art === 'aufgetaut' ? 'status-info' : '';

function Suchfeld({ wert, onAendern }: { wert: string; onAendern: (t: string) => void }) {
  return (
    <label className="suchfeld">
      <Icon name="suche" groesse={17} />
      <input type="search" value={wert} onChange={(e) => onAendern(e.target.value)} placeholder="Suchen (z. B. Tomaten, Reis, …)" aria-label="Im Vorrat suchen" />
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
          <Bild name={s.name} farbe={s.farbe} art="klein" bild={sortenBild(s)} />
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
export function Vorrat({ bestand, heute, nav, onNav, onZurueck, laeuft, reserviert, auftauen, nutzung, onOeffnen, onEntnehmen }: Props) {
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
          <ul className="liste mit-bild abstand-oben">{sorten.map((s) => zeile(s, ort === 'alle'))}</ul>
        ) : (
          arten.map((a) => {
            const gruppe = sorten.filter((s) => artVon(s) === a.id);
            if (gruppe.length === 0) return null;
            return (
              <section key={a.id}>
                <h3 className="unterkopf">{a.mehrzahl}</h3>
                <ul className="liste mit-bild">{gruppe.map((s) => zeile(s, ort === 'alle'))}</ul>
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
        {treffer.length === 0 ? <p className="leer-zustand">Nichts gefunden.</p> : <ul className="liste mit-bild abstand-oben">{treffer.map((s) => zeile(s, true))}</ul>}
      </>
    );
  }

  const wichtig = heuteWichtig(bestand, heute);
  const kacheln = ortKacheln(bestand, heute);
  const wert = vorratswert(bestand);
  const da = bestand.filter((s) => s.anzahl > 0);
  const anzahl = (id: string) => da.filter((s) => (s.lagerort ?? 'gefrierfach') === id).length;
  const komponenten = da.filter((s) => artVon(s) === 'komponente').length;
  const knapp = bestand.filter((s) => s.nachkochen).length;
  const verbrauch = new Map(nutzung.map((n) => [n.block_typ_id, n.verbrauch_28]));
  // „Deine wichtigsten Vorräte“: was Aufmerksamkeit braucht, dann was am meisten verbraucht wird
  const wichtigste = [...bestand]
    .filter((s) => s.anzahl > 0 || zustand(s, heute))
    .sort((a, b) => {
      const za = zustand(a, heute);
      const zb = zustand(b, heute);
      const rang = (z: Wichtig | null) => (z && z.art !== 'niedrig' ? 0 : 1);
      return rang(za) - rang(zb) || (verbrauch.get(b.id) ?? 0) - (verbrauch.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'de');
    })
    .slice(0, 6);
  const ICON: Record<string, IconName> = Object.fromEntries(LAGERORTE.map((l) => [l.id, l.icon]));
  const TON: Record<string, string> = { kuehlschrank: 'ton-gruen', gefrierfach: 'ton-blau', vorrat: 'ton-gelb' };
  const summe = Math.max(1, da.length);
  const stat = (titel: string, zahl: number, icon: IconName, klasse: string, onClick: () => void) => (
    <button type="button" className="vorrat-zahl" onClick={onClick}>
      <span className={`icon-rund ${klasse}`}><Icon name={icon} groesse={15} /></span>
      <strong>{zahl}</strong>
      <small>{titel}</small>
    </button>
  );

  return (
    <>
      <Suchfeld wert={nav.suche} onAendern={(t) => onNav({ suche: t })} />

      <section className="vorrat-held" aria-label="Dein Vorrat">
        <img src={DEKO.heldGemuese} alt="" aria-hidden="true" />
        <div className="vorrat-held-kopf">
          <div>
            <p className="geld-titel">Dein Vorrat</p>
            <span className="geld-zahl">{da.length} Artikel</span>
          </div>
          <div className="fuellung">
            <Icon name="blatt" groesse={18} />
            <span>
              <strong className={knapp ? 'status-achtung' : ''}>{knapp ? `${knapp} ${knapp === 1 ? 'wird' : 'werden'} knapp` : 'Gut gefüllt'}</strong>
              <small>{wert.cent > 0 ? `Wert ≈ ${euro(wert.cent)}` : 'Preise noch offen'}</small>
            </span>
          </div>
        </div>
        <div className="teilbalken" aria-hidden="true">
          {anzahl('kuehlschrank') > 0 && <span style={{ width: `${(anzahl('kuehlschrank') / summe) * 100}%`, background: 'var(--ok)' }} />}
          {anzahl('gefrierfach') > 0 && <span style={{ width: `${(anzahl('gefrierfach') / summe) * 100}%`, background: 'var(--info)' }} />}
          {anzahl('vorrat') > 0 && <span style={{ width: `${(anzahl('vorrat') / summe) * 100}%`, background: 'var(--gelb)' }} />}
        </div>
        <div className="vorrat-zahlen">
          {stat('Frischware', anzahl('kuehlschrank'), 'blatt', 'farbe-frisch', () => onNav({ ort: 'kuehlschrank' }))}
          {stat('Tiefkühl', anzahl('gefrierfach'), 'schneeflocke', 'farbe-tk', () => onNav({ ort: 'gefrierfach' }))}
          {stat('Vorrat', anzahl('vorrat'), 'glas', 'farbe-vorrat', () => onNav({ ort: 'vorrat' }))}
          {stat('Komponenten', komponenten, 'baustein', 'farbe-komp', () => onNav({ ort: 'alle', art: 'komponente' }))}
        </div>
      </section>

      {wichtig.length > 0 && (
        <Box titel="Heute wichtig" kopfIcon={<WarnIcon />} link={{ text: 'Alle anzeigen', onClick: () => onNav({ ort: 'alle' }), grau: true }}>
          <WichtigKacheln wichtig={wichtig} mitPunkt onOeffnen={onOeffnen} />
        </Box>
      )}

      {auftauen}

      <div className="ort-karten" aria-label="Lagerorte">
        {kacheln.map((k) => (
          <button key={k.id} type="button" className={`ort-karte ${TON[k.id]}`} onClick={() => onNav({ ort: k.id })}>
            <img src={ORT_FOTO[k.id]} alt="" aria-hidden="true" />
            <span className="ort-karte-text">
              <span className="icon-rund"><Icon name={ICON[k.id]} groesse={17} /></span>
              <strong>{LAGERORTE.find((l) => l.id === k.id)!.name}</strong>
              <small>{anzahl(k.id)} Artikel</small>
            </span>
          </button>
        ))}
      </div>

      <Box titel="Wichtigste Vorräte" link={{ text: 'Alle', onClick: () => onNav({ ort: 'alle' }), grau: true }} className="alle-box">
        <ul className="liste mit-bild gross bild-zeile">
          {wichtigste.map((s) => {
            const z = zustand(s, heute);
            return (
              <li key={s.id}>
                <button type="button" className="zeile" onClick={() => onOeffnen(s)}>
                  <Bild name={s.name} farbe={s.farbe} art="rund" bild={sortenBild(s)} />
                  <span className="zeile-haupt">
                    <span className="zeile-titel">{s.name}</span>
                    <span className="zeile-meta ort-meta">
                      <span>{mengeText(s.anzahl, einheitVon(s))}</span> · <span><Icon name={ICON[s.lagerort ?? 'gefrierfach']} groesse={13} /> {lagerort(s.lagerort).name}</span>
                    </span>
                  </span>
                  <span className={`pille ${tonVon(z)}`}>{zustandKurz(z)}</span>
                  <Icon name="pfeil" groesse={16} className="zeile-pfeil" />
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="link breit alle-knopf" onClick={() => onNav({ ort: 'alle' })}>Alle {bestand.length} Sorten</button>
      </Box>
    </>
  );
}
