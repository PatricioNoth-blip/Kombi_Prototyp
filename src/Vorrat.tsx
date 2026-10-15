import { type ReactNode, useEffect, useRef } from 'react';
import type { Sorte } from './api';
import { gruppe, type GruppeId, lagerort, LAGERORTE } from './farben';
import { Icon, type IconName } from './Icon';
import { artVon, einheitVon, mengeKurz, portionenText, portionenVon, portionMengeVon } from './format';
import {
  gruppenKacheln, gruppeVon, heuteWichtig, ortKacheln, sortenFuer, vorratsLage, vorratsLageText, zustand, type GruppenKachel, type Wichtig,
} from './dashboard';
import { Bild, DEKO, GRUPPE_EMOJI, GRUPPE_FOTO, ORT_FOTO } from './Bild';
import { sortenBild } from './bildApi';
import { Box, WarnIcon, WichtigKacheln } from './Karten';
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
  /** „Hinzufügen“: Einbuchen oder neue Sorte */
  onHinzufuegen: () => void;
};

/** Eine Portion – oder der Rest, wenn weniger da ist. */
export const einePortion = (s: Sorte) => Math.min(portionMengeVon(s), s.anzahl);

/** Was die Zeile über eine Sorte sagt: bei Gramm/ml wie viele Portionen das sind, sonst woher sie kommt. */
function ueberSorte(s: Sorte, zeigeOrt: boolean): string {
  const e = einheitVon(s);
  const teile = [
    zeigeOrt ? lagerort(s.lagerort).name : null,
    (e === 'g' || e === 'ml') && portionenVon(s) >= 1 ? `≈ ${portionenText(portionenVon(s))}`
      : artVon(s) === 'komplettgericht' ? 'Fertiggericht'
        : s.herkunft === 'selbstgemacht' ? 'Selbst gemacht' : s.herkunft === 'gekauft' ? 'Gekauft' : null,
  ];
  return teile.filter(Boolean).join(' · ');
}

/** Nichts da und nichts zu sagen (kein „nachkochen“): kommt als Knopf unter „Gerade nicht da“ statt als Zeile. */
const nurLeer = (s: Sorte, heute: string) => s.anzahl <= 0 && !zustand(s, heute);

/** Farbe des Zustands – wie die Kacheln: läuft ab/abgelaufen rot, geöffnet gelb, aufgetaut blau, knapp/aufgebraucht neutral */
export const zustandKlasse = (w: Wichtig) =>
  w.art === 'abgelaufen' || w.art === 'bald' ? 'status-kritisch' : w.art === 'geoeffnet' ? 'status-achtung' : w.art === 'aufgetaut' ? 'status-info' : w.art === 'leer' ? 'status-leer' : '';

function Suchfeld({ wert, onAendern }: { wert: string; onAendern: (t: string) => void }) {
  return (
    <label className="suchfeld">
      <Icon name="suche" groesse={17} />
      <input type="search" value={wert} onChange={(e) => onAendern(e.target.value)} placeholder="Suchen (z. B. Nudeln, Reis, …)" aria-label="Im Vorrat suchen" />
      {wert && (
        <button type="button" className="such-leeren" onClick={() => onAendern('')} aria-label="Suche leeren">
          <Icon name="schliessen" groesse={12} />
        </button>
      )}
    </label>
  );
}

/** Foto der Obergruppe – rund (Abschnitt) oder als Fläche (Karte); Extras mit Symbol. */
function GruppeBild({ id, art }: { id: GruppeId; art: 'rund' | 'flaeche' }) {
  const foto = GRUPPE_FOTO[id];
  if (foto) return <img className={`gruppe-bild gruppe-bild-${art}`} src={foto} alt="" aria-hidden="true" draggable={false} />;
  return <span className={`gruppe-bild gruppe-bild-${art} gruppe-symbol`} aria-hidden="true"><span>{GRUPPE_EMOJI[id]}</span></span>;
}

function SorteZeile({ s, heute, reserviert, zeigeOrt, laeuft, onOeffnen, onEntnehmen }: {
  s: Sorte; heute: string; reserviert: number; zeigeOrt: boolean; laeuft: boolean;
  onOeffnen: (s: Sorte) => void; onEntnehmen: (s: Sorte, menge: number) => void;
}) {
  const menge = mengeKurz(s.anzahl, einheitVon(s));
  const z = zustand(s, heute);
  const unter = z
    ? <span className={zustandKlasse(z)}>{z.art === 'bald' ? z.text : z.art === 'leer' || z.art === 'niedrig' ? `${z.titel} · ${z.text}` : z.titel}</span>
    : s.anzahl <= 0
      ? <span>Gerade nicht da</span>
      : reserviert > 0
        ? <span>{mengeKurz(reserviert, einheitVon(s)).zahl} eingeplant</span>
        : <span>{ueberSorte(s, zeigeOrt)}</span>;
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

/** Sorten ohne Bestand: kleine Knöpfe – antippen öffnet die Sorte, dort „Einbuchen“. */
function LeereSorten({ sorten, alle, onOeffnen }: { sorten: Sorte[]; alle: boolean; onOeffnen: (s: Sorte) => void }) {
  return (
    <div className="leer-sorten">
      <p>{alle ? 'Noch nichts eingebucht' : 'Gerade nicht da'} – antippen zum Einbuchen</p>
      <div className="chips">
        {sorten.map((s) => (
          <button key={s.id} type="button" className="chip leer-sorte" onClick={() => onOeffnen(s)}>
            <Bild name={s.name} farbe={s.farbe} art="klein" className="bild-mini" bild={sortenBild(s)} />
            {s.name}
            <Icon name="plus" groesse={14} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Filter nach Obergruppe – die gewählte ist beim Öffnen sichtbar, auch wenn sie weiter rechts liegt. */
function GruppenFilter({ gruppen, gewaehlt, onWahl }: { gruppen: GruppenKachel[]; gewaehlt: GruppeId | null; onWahl: (id: GruppeId | null) => void }) {
  const leiste = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const l = leiste.current;
    const chip = l?.querySelector<HTMLElement>('.gewaehlt');
    if (l && chip && (chip.offsetLeft + chip.offsetWidth > l.scrollLeft + l.clientWidth || chip.offsetLeft < l.scrollLeft)) {
      l.scrollLeft = chip.offsetLeft - 20;
    }
  }, [gewaehlt]);
  return (
    <div ref={leiste} className="chips scroll abstand-oben" role="group" aria-label="Nach Gruppe filtern">
      <button type="button" className={`chip${gewaehlt === null ? ' gewaehlt' : ''}`} aria-pressed={gewaehlt === null} onClick={() => onWahl(null)}>
        Alle
      </button>
      {gruppen.map((k) => (
        <button key={k.id} type="button" className={`chip${gewaehlt === k.id ? ' gewaehlt' : ''}`} aria-pressed={gewaehlt === k.id} onClick={() => onWahl(k.id)}>
          <span className={`punkt f-${gruppe(k.id).farbe}`} aria-hidden="true" />
          {gruppe(k.id).name}
        </button>
      ))}
    </div>
  );
}

/** Obergruppen als Fotokarten: wie viele Sorten da sind und was dazugehört. */
function GruppenKarten({ kacheln, onWahl }: { kacheln: GruppenKachel[]; onWahl: (id: GruppeId) => void }) {
  return (
    <div className="gruppen-karten">
      {kacheln.map((k) => {
        const g = gruppe(k.id);
        const weitere = k.sorten - k.namen.length;
        return (
          <button key={k.id} type="button" className={`gruppe-karte f-${g.farbe}`} onClick={() => onWahl(k.id)}>
            <GruppeBild id={k.id} art="flaeche" />
            {k.achtung > 0 && <span className="gruppe-achtung"><Icon name="info" groesse={13} /> {k.achtung} bald verbrauchen</span>}
            <span className="gruppe-karte-text">
              <strong>{g.name}</strong>
              <span className="gruppe-stand">{k.da} von {k.sorten} da</span>
              <span className="gruppe-balken" aria-hidden="true"><span style={{ width: `${Math.round((100 * k.da) / k.sorten)}%` }} /></span>
              <small>{k.namen.join(', ')}{weitere > 0 ? ` +${weitere}` : ''}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Der Vorrat: erst was wichtig ist, dann wo was liegt und welche Bausteine da sind – Einzelheiten beim Öffnen. */
export function Vorrat({ bestand, heute, nav, onNav, onZurueck, laeuft, reserviert, auftauen, onOeffnen, onEntnehmen, onHinzufuegen }: Props) {
  if (bestand.length === 0) {
    return (
      <div className="leer-karte">
        <span className="leer-icon" aria-hidden="true"><Icon name="vorrat" groesse={28} /></span>
        <h2>Noch nichts im Vorrat</h2>
        <p>Trag ein, was bei dir zu Hause liegt – dann kann Kombi vorschlagen, was du daraus kochst.</p>
        <button type="button" className="knopf haupt" onClick={onHinzufuegen}><Icon name="plus" /> Vorrat eintragen</button>
      </div>
    );
  }

  /** Nichts gefunden – mit einem sinnvollen nächsten Schritt statt einer Sackgasse. */
  const nichtsGefunden = (
    <div className="leer-zustand">
      <Icon name="suche" groesse={36} />
      <p>{nav.suche ? `Nichts gefunden für „${nav.suche}“.` : 'Hier ist gerade nichts.'}</p>
      {nav.suche && <button type="button" className="knopf zweit" onClick={() => onNav({ suche: '' })}>Suche leeren</button>}
      <button type="button" className="link" onClick={onHinzufuegen}>Etwas Neues eintragen</button>
    </div>
  );

  const zeile = (s: Sorte, zeigeOrt: boolean) => (
    <SorteZeile key={s.id} s={s} heute={heute} reserviert={reserviert.get(s.id) ?? 0} zeigeOrt={zeigeOrt}
      laeuft={laeuft.has(s.id)} onOeffnen={onOeffnen} onEntnehmen={onEntnehmen} />
  );

  // ───────── Ein Lagerort, eine Gruppe oder alles ─────────
  if (nav.ort) {
    const ort = nav.ort;
    const titel = ort !== 'alle' ? lagerort(ort).name : nav.gruppe ? gruppe(nav.gruppe).name : 'Alle Sorten';
    const imOrt = sortenFuer(bestand, { ort, gruppe: null, suche: '' }, heute);
    const gruppen = gruppenKacheln(bestand, heute, ort);
    const sorten = sortenFuer(bestand, { ort, gruppe: nav.gruppe, suche: nav.suche }, heute);
    const gezaehlt = nav.gruppe ? imOrt.filter((s) => gruppeVon(s) === nav.gruppe) : imOrt;
    return (
      <div className="ort-ansicht">
        <button type="button" className="zurueck-knopf" onClick={onZurueck}>
          <Icon name="zurueck" groesse={18} /> Vorrat
        </button>
        <div className={`ort-kopf${ort === 'alle' && nav.gruppe ? ' mit-bild' : ''}`}>
          {ort === 'alle' && nav.gruppe && <GruppeBild id={nav.gruppe} art="rund" />}
          <div>
            <h2>{titel}</h2>
            <p className="leise klein">{gezaehlt.filter((s) => s.anzahl > 0).length} von {gezaehlt.length} Sorten da</p>
          </div>
        </div>
        <Suchfeld wert={nav.suche} onAendern={(t) => onNav({ suche: t })} />
        {gruppen.length > 1 && <GruppenFilter gruppen={gruppen} gewaehlt={nav.gruppe} onWahl={(id) => onNav({ gruppe: id })} />}
        {sorten.length === 0 ? (
          nichtsGefunden
        ) : nav.suche ? (
          <ul className="liste mit-bild abstand-oben">{sorten.map((s) => zeile(s, ort === 'alle'))}</ul>
        ) : (
          gruppen.map((k) => {
            const inGruppe = sorten.filter((s) => gruppeVon(s) === k.id);
            if (inGruppe.length === 0) return null;
            const g = gruppe(k.id);
            const zeilen = inGruppe.filter((s) => !nurLeer(s, heute));
            const leer = inGruppe.filter((s) => nurLeer(s, heute));
            return (
              <section key={k.id} className={`gruppe-abschnitt f-${g.farbe}`} aria-label={g.name}>
                {!nav.gruppe && (
                  <div className="gruppe-kopf">
                    <GruppeBild id={k.id} art="rund" />
                    <h3>{g.name}</h3>
                    <span className="gruppe-zahl">{inGruppe.filter((s) => s.anzahl > 0).length} von {inGruppe.length} da</span>
                  </div>
                )}
                {zeilen.length > 0 && <ul className="liste mit-bild">{zeilen.map((s) => zeile(s, ort === 'alle'))}</ul>}
                {leer.length > 0 && <LeereSorten sorten={leer} alle={zeilen.length === 0} onOeffnen={onOeffnen} />}
              </section>
            );
          })
        )}
      </div>
    );
  }

  // ───────── Übersicht ─────────
  if (nav.suche) {
    const treffer = sortenFuer(bestand, { ort: 'alle', gruppe: null, suche: nav.suche }, heute);
    return (
      <>
        <Suchfeld wert={nav.suche} onAendern={(t) => onNav({ suche: t })} />
        {treffer.length === 0 ? nichtsGefunden : <ul className="liste mit-bild abstand-oben">{treffer.map((s) => zeile(s, true))}</ul>}
      </>
    );
  }

  const wichtig = heuteWichtig(bestand, heute);
  const orte = ortKacheln(bestand, heute);
  const gruppen = gruppenKacheln(bestand, heute);
  const lage = vorratsLage(bestand, heute);
  const lageText = vorratsLageText(lage);
  const ICON: Record<string, IconName> = Object.fromEntries(LAGERORTE.map((l) => [l.id, l.icon]));
  const TON: Record<string, string> = { kuehlschrank: 'ton-gruen', gefrierfach: 'ton-blau', vorrat: 'ton-gelb' };

  return (
    <>
      <Suchfeld wert={nav.suche} onAendern={(t) => onNav({ suche: t })} />

      <section className="vorrat-held" aria-label="Dein Vorrat">
        <img src={DEKO.heldGemuese} alt="" aria-hidden="true" />
        <div className="vorrat-held-kopf">
          <p className="vorrat-held-titel">Dein Vorrat</p>
          <span className="vorrat-held-zahl">{lage.artikel} Artikel</span>
          <p className="vorrat-held-unter">{bestand.length} Sorten · {bestand.length - lage.artikel} gerade nicht da</p>
          <p className={`vorrat-lage${lageText ? ' status-achtung' : ' status-ok'}`}>
            <Icon name={lageText ? 'info' : 'haken'} groesse={16} /> {lageText ?? 'Alles in Ordnung'}
          </p>
        </div>
      </section>

      {wichtig.length > 0 && (
        <Box titel="Jetzt wichtig" kopfIcon={<WarnIcon />} link={{ text: 'Alle anzeigen', onClick: () => onNav({ ort: 'alle' }), grau: true }}>
          <WichtigKacheln wichtig={wichtig} mitPunkt onOeffnen={onOeffnen} />
        </Box>
      )}

      {auftauen}

      <section className="abschnitt" aria-label="Lagerorte">
        <div className="abschnitt-kopf"><h2>Wo liegt was?</h2></div>
        <div className="ort-karten">
          {orte.map((k) => (
            <button key={k.id} type="button" className={`ort-karte ${TON[k.id]}`} onClick={() => onNav({ ort: k.id })}>
              <img src={ORT_FOTO[k.id]} alt="" aria-hidden="true" />
              <span className="ort-karte-text">
                <span className="icon-rund"><Icon name={ICON[k.id]} groesse={17} /></span>
                <strong>{LAGERORTE.find((l) => l.id === k.id)!.name}</strong>
                <small>{k.sorten ? `${k.sorten - k.leer} von ${k.sorten} da` : 'noch leer'}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="abschnitt" aria-label="Gruppen">
        <div className="abschnitt-kopf"><h2>Deine Bausteine</h2></div>
        <GruppenKarten kacheln={gruppen} onWahl={(id) => onNav({ ort: 'alle', gruppe: id })} />
      </section>

      <button type="button" className="knopf zweit breit alle-knopf" onClick={() => onNav({ ort: 'alle', gruppe: null })}>
        Alle {bestand.length} Sorten
      </button>
    </>
  );
}
