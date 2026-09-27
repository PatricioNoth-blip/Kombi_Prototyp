import { konfiguriert } from './supabase';
import { Inventar } from './Inventar';

// v0.1 läuft ohne Login: Wer die Adresse kennt, sieht und bucht den gemeinsamen Bestand.
export default function App() {
  if (!konfiguriert) {
    return (
      <main className="mitte">
        <div className="karte">
          <h1>Kombi</h1>
          <p>
            Supabase ist noch nicht eingerichtet: <code>VITE_SUPABASE_URL</code> und{' '}
            <code>VITE_SUPABASE_KEY</code> fehlen. Siehe README.
          </p>
        </div>
      </main>
    );
  }
  return <Inventar />;
}
