import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

/** Für direkte Aufrufe (Health-Check der Edge Function) – der Publishable key ist öffentlich. */
export const SUPABASE_URL = url ?? '';
export const SUPABASE_KEY = key ?? '';

/** false, solange .env bzw. die GitHub-Variablen fehlen */
export const konfiguriert = Boolean(url && key);

// Platzhalter, damit die App ohne Konfiguration nicht abstürzt, sondern den Hinweis zeigt.
export const supabase = createClient(url || 'http://localhost', key || 'fehlt');
