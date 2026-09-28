// Gemeinsame Bausteine im Stil der Entwürfe: Abschnitts-Karte, getönte „Heute wichtig“-Kacheln,
// Angaben mit Icons (Zeit, Preis, kcal, Portionen) und Zustands-Pillen.
import type { ReactNode } from 'react';
import type { Gericht } from '../supabase/functions/_shared/kombi/typen.ts';
import type { Naehrwerte } from '../supabase/functions/_shared/kombi/naehrwerte.ts';
import type { Sorte } from './api';
import type { Wichtig } from './dashboard';
import { Bild } from './Bild';
import { Icon, type IconName } from './Icon';
import { euroKurz, kcalKurz } from './format';

/** Zustand → Tönung: läuft ab / abgelaufen rot, geöffnet gelb, aufgetaut blau, knapp grau */
export function tonVon(w: Wichtig | null): 'ton-rot' | 'ton-gelb' | 'ton-blau' | 'ton-grau' | 'ton-gruen' {
  if (!w) return 'ton-gruen';
  if (w.art === 'abgelaufen' || w.art === 'bald') return 'ton-rot';
  if (w.art === 'geoeffnet') return 'ton-gelb';
  if (w.art === 'aufgetaut') return 'ton-blau';
  return 'ton-grau';
}

/** Kurzer Zustand für Kachel und Pille: „noch 2 Tage“, „geöffnet“, „aufgetaut“, „gut“ */
export function zustandKurz(w: Wichtig | null): string {
  if (!w) return 'gut';
  if (w.art === 'bald') return w.text === 'bald verbrauchen' ? 'läuft ab' : w.text;
  if (w.art === 'niedrig') return 'wird knapp';
  return w.titel.toLocaleLowerCase('de-DE');
}

export function Box({ titel, icon, kopfIcon, link, className = '', children }: {
  titel: string; icon?: IconName; kopfIcon?: ReactNode; link?: { text: string; onClick: () => void; grau?: boolean };
  className?: string; children: ReactNode;
}) {
  return (
    <section className={`box ${className}`} aria-label={titel}>
      <div className="box-kopf">
        {kopfIcon ?? (icon && <Icon name={icon} groesse={24} />)}
        <h2>{titel}</h2>
        {link && (
          <button type="button" className={`mehr-link${link.grau ? ' grau' : ''}`} onClick={link.onClick}>
            {link.text} <Icon name="pfeil" groesse={16} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function WarnIcon() {
  return <span className="warn-icon" aria-hidden="true"><Icon name="warnung" groesse={17} /></span>;
}

/** Getönte Kacheln mit Bild, Name und Zustand – ein Tipp öffnet die Sorte. */
export function WichtigKacheln({ wichtig, mitPunkt = false, onOeffnen }: { wichtig: Wichtig[]; mitPunkt?: boolean; onOeffnen: (s: Sorte) => void }) {
  return (
    <div className="kacheln">
      {wichtig.map((w) => (
        <button key={w.sorte.id} type="button" className={`kachel ${tonVon(w)}`} onClick={() => onOeffnen(w.sorte)}>
          <Bild name={w.sorte.name} farbe={w.sorte.farbe} art="rund" />
          <span className="kachel-text">
            <strong>{w.sorte.name}</strong>
            <span>{mitPunkt && <i className="zustand-punkt" aria-hidden="true" />}{zustandKurz(w)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** 🕒 18 Min  € 1,42 €  🔥 620 kcal / Portion */
export function MetaIcons({ g, n, portionen = false }: { g: Gericht; n: Naehrwerte; portionen?: boolean }) {
  return (
    <p className="meta-icons">
      {portionen && <span><Icon name="personen" groesse={17} /> {g.portionen} {g.portionen === 1 ? 'Portion' : 'Portionen'}</span>}
      <span><Icon name="uhr" groesse={17} /> {g.zeit_min} Min</span>
      <span><Icon name="preis" groesse={17} /> {euroKurz(g.kosten)}</span>
      <span><Icon name="flamme" groesse={17} className="flamme" /> {kcalKurz(n)}{n.kcal_portion !== null ? ' / Portion' : ''}</span>
    </p>
  );
}

/** ✓ Alles da – oder „Fehlt: …“ */
export function Verfuegbar({ g }: { g: Gericht }) {
  if (g.fehlt.length === 0) {
    return <p className="verfuegbar status-ok"><span className="kreis-haken"><Icon name="haken" groesse={13} /></span> Alles vorhanden</p>;
  }
  if (g.fehlt.length === 1) {
    return <p className="verfuegbar status-ok"><span className="kreis-haken"><Icon name="haken" groesse={13} /></span> Fast alles vorhanden <span className="leise">· fehlt: {g.fehlt[0].name}</span></p>;
  }
  return <p className="verfuegbar status-achtung"><Icon name="wagen" groesse={16} /> Fehlt: {g.fehlt.map((f) => f.name).join(', ')}</p>;
}
