import type { ImportQuelle } from '../supabase/functions/_shared/kombi/bon/typen.ts';
import { Blatt } from './Blatt';
import { Icon, type IconName } from './Icon';

type Props = {
  onBon: (quelle: ImportQuelle) => void;
  onManuell: () => void;
  onSchliessen: () => void;
};

const WEGE: { quelle: ImportQuelle | 'manuell'; emoji: string; icon: IconName; titel: string; text: string }[] = [
  { quelle: 'kassenbon', emoji: '🧾', icon: 'kamera', titel: 'Kassenbon scannen', text: 'Foto vom Bon – bei langen Bons mehrere' },
  { quelle: 'e_bon', emoji: '📱', icon: 'datei', titel: 'E-Bon importieren', text: 'PDF, Bild oder Text aus App oder Mail' },
  { quelle: 'text', emoji: '📋', icon: 'text', titel: 'Bon-Text einfügen', text: 'Kopierten Bon-Text einfügen' },
  { quelle: 'manuell', emoji: '✍️', icon: 'plus', titel: 'Manuell hinzufügen', text: 'Sorte wählen, Menge antippen' },
];

/** Einstieg „+ Bestand aktualisieren“ oben im Vorrat. */
export function BestandAktualisieren({ onBon, onManuell, onSchliessen }: Props) {
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
    </Blatt>
  );
}
