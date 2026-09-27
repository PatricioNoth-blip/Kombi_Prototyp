import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { konfiguriert, supabase } from './supabase';
import { Inventar } from './Inventar';

export default function App() {
  // undefined = wird noch geprüft, null = nicht angemeldet
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!konfiguriert) return;
    const { data } = supabase.auth.onAuthStateChange((_ereignis, neu) => setSession(neu));
    return () => data.subscription.unsubscribe();
  }, []);

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
  if (session === undefined) return null;
  if (session === null) return <Login />;
  return <Inventar onAbmelden={() => void supabase.auth.signOut()} />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function anmelden(e: FormEvent) {
    e.preventDefault();
    setLaeuft(true);
    setFehler(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: passwort,
      });
      if (error) {
        setFehler(
          error.code === 'invalid_credentials' || error.message === 'Invalid login credentials'
            ? 'E-Mail oder Passwort stimmt nicht.'
            : error.message,
        );
      }
    } catch {
      setFehler('Keine Verbindung. Bist du online?');
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <main className="mitte">
      <form className="karte formular" onSubmit={anmelden}>
        <h1>Kombi</h1>
        <p className="leise">Mit dem gemeinsamen WG-Login anmelden. Das Handy bleibt angemeldet.</p>
        <label className="feld">
          E-Mail
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="feld">
          Passwort
          <input
            type="password"
            autoComplete="current-password"
            required
            value={passwort}
            onChange={(e) => setPasswort(e.target.value)}
          />
        </label>
        {fehler && <p className="fehlertext">{fehler}</p>}
        <button type="submit" className="knopf haupt" disabled={laeuft}>
          {laeuft ? 'Anmelden …' : 'Anmelden'}
        </button>
      </form>
    </main>
  );
}
