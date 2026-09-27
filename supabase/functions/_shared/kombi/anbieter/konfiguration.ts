// Welcher KI-Anbieter wird genutzt? Alles über Umgebungsvariablen der Edge Function:
//   KI_ANBIETER   groq (Standard) | gemini | openrouter | ollama | eigen
//   KI_API_KEY    API-Key des Anbieters (bei ollama nicht nötig)
//   KI_MODELL     optional, sonst der Standard des Anbieters
//   KI_BASIS_URL  optional, Pflicht bei „eigen“
import type { KiAnbieter } from '../typen.ts';
import { openAiKompatibel } from './openai_kompatibel.ts';

type Voreinstellung = { basisUrl: string; modell: string; ohneKey?: boolean };

/** Kostenlose Stufen (Stand der Entwicklung) – Modelle können sich beim Anbieter ändern. */
export const VOREINSTELLUNGEN: Record<string, Voreinstellung> = {
  groq: { basisUrl: 'https://api.groq.com/openai/v1', modell: 'openai/gpt-oss-120b' },
  gemini: { basisUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', modell: 'gemini-2.5-flash' },
  openrouter: { basisUrl: 'https://openrouter.ai/api/v1', modell: 'meta-llama/llama-3.3-70b-instruct:free' },
  ollama: { basisUrl: 'http://localhost:11434/v1', modell: 'llama3.1', ohneKey: true },
};

export function anbieterAusUmgebung(
  env: (name: string) => string | undefined,
  f?: typeof fetch,
): KiAnbieter | null {
  const name = (env('KI_ANBIETER') || 'groq').trim().toLowerCase();
  const apiKey = env('KI_API_KEY')?.trim() || null;
  const vor = VOREINSTELLUNGEN[name];
  const basisUrl = env('KI_BASIS_URL')?.trim() || vor?.basisUrl;
  const modell = env('KI_MODELL')?.trim() || vor?.modell;
  if (!basisUrl || !modell) return null;
  if (!apiKey && !vor?.ohneKey) return null; // nicht eingerichtet → App nutzt den Demo-Modus
  return openAiKompatibel({ name, basisUrl, apiKey, modell, fetch: f });
}
