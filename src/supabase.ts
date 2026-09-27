import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

/** false, solange .env bzw. die GitHub-Variablen fehlen */
export const konfiguriert = Boolean(url && key);

// Platzhalter, damit die App ohne Konfiguration nicht abstürzt, sondern den Hinweis zeigt.
export const supabase = createClient(url || 'http://localhost', key || 'fehlt');
