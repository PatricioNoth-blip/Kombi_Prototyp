import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

type BlattProps = { titel: string; untertitel?: string; onSchliessen: () => void; children: ReactNode };

let offeneFenster = 0;

/** Seite hinter offenen Fenstern nicht scrollen – gezählt, weil Fenster übereinander liegen können. */
export function useScrollSperre() {
  useEffect(() => {
    offeneFenster++;
    document.body.classList.add('blatt-offen');
    return () => {
      offeneFenster = Math.max(0, offeneFenster - 1);
      if (offeneFenster === 0) document.body.classList.remove('blatt-offen');
    };
  }, []);
}

/** Von unten einfahrendes Fenster (gut mit dem Daumen erreichbar). */
export function Blatt({ titel, untertitel, onSchliessen, children }: BlattProps) {
  const titelId = useId();
  useScrollSperre();

  useEffect(() => {
    const beiTaste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSchliessen();
    };
    window.addEventListener('keydown', beiTaste);
    return () => window.removeEventListener('keydown', beiTaste);
  }, [onSchliessen]);

  return (
    <div className="blatt-hintergrund" onClick={onSchliessen}>
      <div
        className="blatt"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titelId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="blatt-griff" aria-hidden="true" />
        <div className="blatt-kopf">
          <div>
            <h2 id={titelId}>{titel}</h2>
            {untertitel && <p className="blatt-unter">{untertitel}</p>}
          </div>
          <button type="button" className="icon-knopf klein" onClick={onSchliessen} aria-label="Schließen">
            <Icon name="schliessen" groesse={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type AnzahlProps = {
  werte: number[];
  aktion: string;
  deaktiviert?: boolean;
  /** Beschriftung der Knöpfe, z. B. „250 g“ (sonst nur die Zahl) */
  beschriftung?: (n: number) => string;
  /** Platzhalter für das freie Feld, z. B. „Andere Menge in g“ */
  platzhalter?: string;
  onWahl: (anzahl: number) => void;
};

/** Große Zahlenknöpfe (ein Tap = Buchung) plus Feld für andere Anzahlen. */
export function AnzahlWahl({ werte, aktion, deaktiviert, beschriftung, platzhalter, onWahl }: AnzahlProps) {
  const [eigene, setEigene] = useState('');
  const zahl = Number(eigene);
  const gueltig = Number.isInteger(zahl) && zahl >= 1;

  function absenden(e: FormEvent) {
    e.preventDefault();
    if (gueltig) onWahl(zahl);
  }

  return (
    <>
      <div className={`zahlen${beschriftung ? ' mit-einheit' : ''}`}>
        {werte.map((n) => (
          <button
            key={n}
            type="button"
            className="zahl"
            disabled={deaktiviert}
            onClick={() => onWahl(n)}
            aria-label={`${beschriftung ? beschriftung(n) : n} ${aktion}`}
          >
            {beschriftung ? beschriftung(n) : n}
          </button>
        ))}
      </div>
      <form className="eigene-anzahl" onSubmit={absenden}>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          placeholder={platzhalter ?? 'Andere Anzahl'}
          aria-label="Andere Anzahl"
          value={eigene}
          onChange={(e) => setEigene(e.target.value)}
        />
        <button type="submit" className="knopf" disabled={deaktiviert || !gueltig}>
          {aktion}
        </button>
      </form>
    </>
  );
}
