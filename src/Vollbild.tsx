import { useEffect, useId, type ReactNode } from 'react';
import { Icon } from './Icon';

type Props = {
  titel: string;
  untertitel?: string;
  /** Schließen-Knopf oben links (z. B. „Abbrechen“) */
  onSchliessen: () => void;
  schliessenText?: string;
  /** feste Leiste unten (Hauptaktion) */
  fuss?: ReactNode;
  children: ReactNode;
};

/** Ganze Seite über der App – für Abläufe mit mehreren Schritten (Bon-Import, Produktion). */
export function Vollbild({ titel, untertitel, onSchliessen, schliessenText = 'Abbrechen', fuss, children }: Props) {
  const titelId = useId();

  useEffect(() => {
    const beiTaste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSchliessen();
    };
    window.addEventListener('keydown', beiTaste);
    document.body.classList.add('blatt-offen');
    return () => {
      window.removeEventListener('keydown', beiTaste);
      document.body.classList.remove('blatt-offen');
    };
  }, [onSchliessen]);

  return (
    <div className="vollbild" role="dialog" aria-modal="true" aria-labelledby={titelId}>
      <header className="vollbild-kopf">
        <button type="button" className="link vollbild-zurueck" onClick={onSchliessen}>
          <Icon name="schliessen" groesse={18} /> {schliessenText}
        </button>
        <h2 id={titelId}>{titel}</h2>
        {untertitel && <p className="blatt-unter">{untertitel}</p>}
      </header>
      <div className="vollbild-inhalt">{children}</div>
      {fuss && <div className="vollbild-fuss">{fuss}</div>}
    </div>
  );
}
