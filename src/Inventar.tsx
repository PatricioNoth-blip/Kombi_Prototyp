import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { fehlerText, type Sorte } from './api';
import { Uebersicht } from './Uebersicht';
import { SorteBlatt } from './SorteBlatt';
import { Einfrieren } from './Einfrieren';
import { Sorten } from './Sorten';

type Meldung = { text: string; fehler?: boolean; rueckgaengig?: number[] };

export function Inventar({ onAbmelden }: { onAbmelden: () => void }) {
  const [bestand, setBestand] = useState<Sorte[] | null>(null);
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<'bestand' | 'sorten'>('bestand');
  const [offeneSorteId, setOffeneSorteId] = useState<number | null>(null);
  // null = Dialog zu; sorteId null = Sorte muss noch gewählt werden
  const [einfrierenDialog, setEinfrierenDialog] = useState<{ sorteId: number | null } | null>(null);
  const [laeuft, setLaeuft] = useState<Set<number>>(new Set());
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const laden = useCallback(async () => {
    try {
      setBestand(await api.ladeBestand());
      setLadefehler(null);
    } catch (e) {
      setLadefehler(fehlerText(e));
    }
  }, []);

  // Beim Start und jedes Mal, wenn die App wieder in den Vordergrund kommt,
  // neu laden – so sehen beide immer den aktuellen Bestand.
  useEffect(() => {
    void laden();
    const beiRueckkehr = () => {
      if (document.visibilityState === 'visible') void laden();
    };
    document.addEventListener('visibilitychange', beiRueckkehr);
    window.addEventListener('online', beiRueckkehr);
    return () => {
      document.removeEventListener('visibilitychange', beiRueckkehr);
      window.removeEventListener('online', beiRueckkehr);
    };
  }, [laden]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function zeige(m: Meldung) {
    window.clearTimeout(timer.current);
    setMeldung(m);
    timer.current = window.setTimeout(() => setMeldung(null), m.fehler ? 7000 : 5000);
  }

  async function buchen(sorte: Sorte, aktion: () => Promise<number[]>, text: string) {
    setLaeuft((l) => new Set(l).add(sorte.id));
    try {
      const ids = await aktion();
      zeige({ text, rueckgaengig: ids });
    } catch (e) {
      zeige({ text: fehlerText(e), fehler: true });
    } finally {
      setLaeuft((l) => {
        const neu = new Set(l);
        neu.delete(sorte.id);
        return neu;
      });
      await laden();
    }
  }

  async function rueckgaengigMachen(ids: number[]) {
    window.clearTimeout(timer.current);
    setMeldung(null);
    try {
      await api.rueckgaengig(ids);
      zeige({ text: 'Rückgängig gemacht.' });
    } catch (e) {
      zeige({ text: fehlerText(e), fehler: true });
    } finally {
      await laden();
    }
  }

  function entnehmen(sorte: Sorte, anzahl: number) {
    setOffeneSorteId(null);
    void buchen(sorte, () => api.entnehmen(sorte.id, anzahl), `−${anzahl} ${sorte.name}`);
  }

  function einfrieren(sorte: Sorte, anzahl: number) {
    setEinfrierenDialog(null);
    void buchen(sorte, () => api.einfrieren(sorte.id, anzahl), `+${anzahl} ${sorte.name} eingefroren`);
  }

  const finde = (id: number | null) => bestand?.find((s) => s.id === id) ?? null;
  const offeneSorte = finde(offeneSorteId);

  return (
    <>
      <header className="kopf">
        <h1>Kombi</h1>
        <nav className="reiter" aria-label="Ansicht">
          <button
            type="button"
            className={ansicht === 'bestand' ? 'aktiv' : ''}
            aria-current={ansicht === 'bestand' ? 'page' : undefined}
            onClick={() => setAnsicht('bestand')}
          >
            Bestand
          </button>
          <button
            type="button"
            className={ansicht === 'sorten' ? 'aktiv' : ''}
            aria-current={ansicht === 'sorten' ? 'page' : undefined}
            onClick={() => setAnsicht('sorten')}
          >
            Sorten
          </button>
        </nav>
        <button type="button" className="rund" onClick={() => void laden()} aria-label="Neu laden">
          ↻
        </button>
      </header>

      <main className="inhalt">
        {ladefehler && (
          <p className="fehlerbox">
            {ladefehler}{' '}
            <button type="button" className="link" onClick={() => void laden()}>
              Nochmal versuchen
            </button>
          </p>
        )}
        {bestand === null ? (
          !ladefehler && <p className="leise">Lade Bestand …</p>
        ) : ansicht === 'bestand' ? (
          <Uebersicht
            bestand={bestand}
            laeuft={laeuft}
            onMinusEins={(s) => entnehmen(s, 1)}
            onOeffnen={(s) => setOffeneSorteId(s.id)}
          />
        ) : (
          <Sorten
            bestand={bestand}
            onGespeichert={(text) => {
              zeige({ text });
              void laden();
            }}
            onAbmelden={onAbmelden}
          />
        )}
      </main>

      {ansicht === 'bestand' && bestand && bestand.length > 0 && (
        <div className="unten-leiste">
          <button
            type="button"
            className="knopf haupt"
            onClick={() => setEinfrierenDialog({ sorteId: null })}
          >
            ❄ Einfrieren
          </button>
        </div>
      )}

      {offeneSorte && (
        <SorteBlatt
          sorte={offeneSorte}
          laeuft={laeuft.has(offeneSorte.id)}
          onEntnehmen={(n) => entnehmen(offeneSorte, n)}
          onEinfrieren={() => {
            setOffeneSorteId(null);
            setEinfrierenDialog({ sorteId: offeneSorte.id });
          }}
          onSchliessen={() => setOffeneSorteId(null)}
        />
      )}

      {einfrierenDialog && bestand && (
        <Einfrieren
          bestand={bestand}
          startSorte={finde(einfrierenDialog.sorteId)}
          onEinfrieren={einfrieren}
          onSchliessen={() => setEinfrierenDialog(null)}
        />
      )}

      <div className="meldung-bereich" aria-live="polite">
        {meldung && (
          <div className={`meldung${meldung.fehler ? ' fehler' : ''}`} role={meldung.fehler ? 'alert' : 'status'}>
            <span>{meldung.text}</span>
            {meldung.rueckgaengig && (
              <button type="button" onClick={() => void rueckgaengigMachen(meldung.rueckgaengig!)}>
                Rückgängig
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
