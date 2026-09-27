import { useEffect, useState } from 'react';
import type { ImportQuelle } from '../supabase/functions/_shared/kombi/bon/typen.ts';
import { fehlerText } from './api';
import { bonRueckgaengig, ladeLetzteImporte, type ImportKurz } from './bonApi';
import { Blatt } from './Blatt';
import { Icon, type IconName } from './Icon';
import { datum } from './format';

type Props = {
  onBon: (quelle: ImportQuelle) => void;
  onManuell: () => void;
  /** nach „Rückgängig“ eines Imports: Meldung zeigen und Bestand neu laden */
  onRueckgaengig: (text: string, fehler?: boolean) => void;
  onSchliessen: () => void;
};

const WEGE: { quelle: ImportQuelle | 'manuell'; emoji: string; icon: IconName; titel: string; text: string }[] = [
  { quelle: 'kassenbon', emoji: '🧾', icon: 'kamera', titel: 'Kassenbon scannen', text: 'Foto vom Bon – bei langen Bons mehrere' },
  { quelle: 'e_bon', emoji: '📱', icon: 'datei', titel: 'E-Bon importieren', text: 'PDF, Bild oder Text aus App oder Mail' },
  { quelle: 'text', emoji: '📋', icon: 'text', titel: 'Bon-Text einfügen', text: 'Kopierten Bon-Text einfügen' },
  { quelle: 'manuell', emoji: '✍️', icon: 'plus', titel: 'Manuell hinzufügen', text: 'Sorte wählen, Menge antippen' },
];

/** Einstieg „+ Bestand aktualisieren“ oben im Vorrat. */
export function BestandAktualisieren({ onBon, onManuell, onRueckgaengig, onSchliessen }: Props) {
  const [importe, setImporte] = useState<ImportKurz[]>([]);
  useEffect(() => {
    ladeLetzteImporte().then(setImporte).catch(() => setImporte([]));
  }, []);

  async function rueckgaengig(i: ImportKurz) {
    try {
      await bonRueckgaengig(i.id);
      setImporte((alt) => alt.filter((x) => x.id !== i.id));
      onRueckgaengig(`Bon${i.haendler ? ` von ${i.haendler}` : ''} rückgängig gemacht – der Bestand ist wie vorher.`);
    } catch (e) {
      onRueckgaengig(fehlerText(e), true);
    }
  }

  return (
    <Blatt titel="Bestand aktualisieren" untertitel="Nach dem Einkauf: Bon scannen – Kombi erledigt den Rest. Gebucht wird erst nach deiner Bestätigung." onSchliessen={onSchliessen}>
      <ul className="wege">
        {WEGE.map((w) => (
          <li key={w.quelle}>
            <button type="button" className="weg" onClick={() => (w.quelle === 'manuell' ? onManuell() : onBon(w.quelle))}>
              <span className="weg-emoji" aria-hidden="true">{w.emoji}</span>
              <span className="weg-text">
                <strong>{w.titel}</strong>
                <small>{w.text}</small>
              </span>
              <Icon name="pfeil" groesse={18} />
            </button>
          </li>
        ))}
      </ul>
      {importe.length > 0 && (
        <section className="abschnitt">
          <h3>Zuletzt importiert</h3>
          <ul className="chargen">
            {importe.map((i) => (
              <li key={i.id}>
                <span className="charge-links">
                  <span>{i.haendler ?? 'Bon'}{i.kaufdatum ? ` · ${datum(i.kaufdatum)}` : ''}</span>
                  <small>{i.artikel === 1 ? '1 Artikel' : `${i.artikel} Artikel`} übernommen · importiert {datum(i.erstellt_am.slice(0, 10))}</small>
                </span>
                <button type="button" className="link inline" onClick={() => void rueckgaengig(i)}>Rückgängig</button>
              </li>
            ))}
          </ul>
          <p className="leise klein">Rückgängig geht, solange aus den Einkaufschargen noch nichts verbraucht wurde.</p>
        </section>
      )}
    </Blatt>
  );
}
