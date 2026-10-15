// Gemeinsame Bausteine: Abschnitts-Karte, getönte „Jetzt wichtig“-Kacheln und Zustands-Pillen.
import type { ReactNode } from 'react';
import type { Sorte } from './api';
import type { Wichtig } from './dashboard';
import { Bild } from './Bild';
import { Icon, type IconName } from './Icon';

/** Zustand → Tönung: läuft ab / abgelaufen rot, geöffnet gelb, aufgetaut blau, knapp grau, aufgebraucht dunkel */
export function tonVon(w: Wichtig | null): 'ton-rot' | 'ton-gelb' | 'ton-blau' | 'ton-grau' | 'ton-gruen' | 'ton-leer' {
  if (!w) return 'ton-gruen';
  if (w.art === 'abgelaufen' || w.art === 'bald') return 'ton-rot';
  if (w.art === 'geoeffnet') return 'ton-gelb';
  if (w.art === 'aufgetaut') return 'ton-blau';
  if (w.art === 'leer') return 'ton-leer';
  return 'ton-grau';
}

/** Kurzer Zustand für Kachel und Pille: „noch 2 Tage“, „geöffnet“, „aufgetaut“, „wird knapp“, „aufgebraucht“, „gut“ */
export function zustandKurz(w: Wichtig | null): string {
  if (!w) return 'gut';
  if (w.art === 'bald') return w.text === 'bald verbrauchen' ? 'läuft ab' : w.text;
  if (w.art === 'niedrig') return 'wird knapp';
  if (w.art === 'leer') return 'aufgebraucht';
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
