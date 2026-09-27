// Kassenbon-Fotos abschreiben lassen – über jeden OpenAI-kompatiblen Anbieter mit Bildverständnis.
// Läuft nur serverseitig (Edge Function „bon-lesen“): Der API-Key kommt aus der Umgebung.
//
//   KI_ANBIETER     groq (Standard) | gemini | openrouter | ollama | eigen – wie bei „was-essen“
//   KI_API_KEY      API-Key des Anbieters
//   KI_BON_MODELL   optional: Modell MIT Bildverständnis (sonst Standard des Anbieters, siehe unten)
//   KI_BASIS_URL    optional, Pflicht bei „eigen“
//
// Die KI liefert nur Text (pruefeBonLesung). Bedeutung, Mengen und Preise bestimmt der Parser.
import { VOREINSTELLUNGEN } from '../anbieter/konfiguration.ts';
import { KiFehler } from '../anbieter/openai_kompatibel.ts';
import { BON_NUTZER_TEXT, BON_SYSTEM_PROMPT, pruefeBonLesung, type BonLesung } from './ki.ts';

/** Modelle mit Bildverständnis (Stand der Entwicklung – Anbieter ändern Modelle gelegentlich). */
export const BON_MODELLE: Record<string, string> = {
  groq: 'meta-llama/llama-4-scout-17b-16e-instruct',
  gemini: 'gemini-2.5-flash',
  openrouter: 'google/gemma-3-27b-it:free',
  ollama: 'llama3.2-vision',
};

/** Nur Gemini liest PDFs direkt; bei anderen Anbietern bitte Foto oder Text. */
const PDF_ANBIETER = new Set(['gemini']);

export type BonDatei = { mime: string; daten: string };
export type BonLeserKonfig = { name: string; basisUrl: string; apiKey: string | null; modell: string; fetch?: typeof fetch; timeoutMs?: number };

export function bonLeserAusUmgebung(env: (name: string) => string | undefined, f?: typeof fetch): BonLeserKonfig | null {
  const name = (env('KI_ANBIETER') || 'groq').trim().toLowerCase();
  const apiKey = env('KI_API_KEY')?.trim() || null;
  const vor = VOREINSTELLUNGEN[name];
  const basisUrl = env('KI_BASIS_URL')?.trim() || vor?.basisUrl;
  const modell = env('KI_BON_MODELL')?.trim() || BON_MODELLE[name] || env('KI_MODELL')?.trim();
  if (!basisUrl || !modell) return null;
  if (!apiKey && !vor?.ohneKey) return null;
  return { name, basisUrl, apiKey, modell, fetch: f };
}

const ERLAUBT = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
export const MAX_DATEIEN = 6;

/** Prüft die Anfrage der App: 1–6 Bilder (bzw. PDF), nur Base64. */
export function pruefeDateien(roh: unknown): BonDatei[] {
  const dateien = (roh && typeof roh === 'object' ? (roh as { dateien?: unknown }).dateien : null);
  if (!Array.isArray(dateien) || dateien.length === 0 || dateien.length > MAX_DATEIEN) {
    throw new KiFehler(`Bitte 1 bis ${MAX_DATEIEN} Fotos schicken.`, 400);
  }
  return dateien.map((d) => {
    const mime = typeof d?.mime === 'string' ? d.mime.toLowerCase() : '';
    const daten = typeof d?.daten === 'string' ? d.daten : '';
    if (!ERLAUBT.test(mime) || !/^[A-Za-z0-9+/=]+$/.test(daten.slice(0, 200)) || daten.length < 100) {
      throw new KiFehler('Nur Fotos (JPEG, PNG, WebP) oder PDF.', 400);
    }
    return { mime, daten };
  });
}

function fehler(status: number, text: string, k: BonLeserKonfig): KiFehler {
  if (status === 401 || status === 403) return new KiFehler(`${k.name}: API-Key ungültig oder ohne Berechtigung.`, 502);
  if (status === 404 || /model.*(not found|does not exist|decommission)/i.test(text)) {
    return new KiFehler(`${k.name}: Modell „${k.modell}“ nicht verfügbar – KI_BON_MODELL auf ein Modell mit Bildverständnis setzen.`, 502);
  }
  if (status === 413) return new KiFehler('Die Fotos sind zu groß – bitte weniger oder kleinere Fotos.', 400);
  if (status === 429) return new KiFehler(`${k.name}: kostenloses Kontingent gerade erschöpft – bitte etwas später nochmal.`, 429);
  if (status === 400 && /image|vision|multimodal|content/i.test(text)) {
    return new KiFehler(`${k.name}: Modell „${k.modell}“ kann keine Bilder lesen – KI_BON_MODELL setzen.`, 502);
  }
  return new KiFehler(`${k.name}: Fehler ${status}.`, 502);
}

/** Schickt die Fotos an die KI und gibt nur geprüften Text zurück. */
export async function leseBon(k: BonLeserKonfig, dateien: BonDatei[]): Promise<BonLesung> {
  if (dateien.some((d) => d.mime === 'application/pdf') && !PDF_ANBIETER.has(k.name)) {
    throw new KiFehler('Dieser KI-Anbieter kann keine PDFs lesen. Bitte ein Foto des E-Bons oder den Text einfügen.', 400);
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (k.apiKey) headers.authorization = `Bearer ${k.apiKey}`;
  const inhalt = [
    { type: 'text', text: `${BON_NUTZER_TEXT} ${dateien.length > 1 ? `Es sind ${dateien.length} Fotos desselben Bons.` : ''}`.trim() },
    ...dateien.map((d) => ({ type: 'image_url', image_url: { url: `data:${d.mime};base64,${d.daten}` } })),
  ];
  const body = (jsonModus: boolean) =>
    JSON.stringify({
      model: k.modell,
      temperature: 0,
      messages: [{ role: 'system', content: BON_SYSTEM_PROMPT }, { role: 'user', content: inhalt }],
      ...(jsonModus ? { response_format: { type: 'json_object' } } : {}),
    });

  const f = k.fetch ?? fetch;
  let jsonModus = true;
  for (let versuch = 0; versuch < 2; versuch++) {
    let antwort: Response;
    try {
      antwort = await f(`${k.basisUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: body(jsonModus),
        signal: AbortSignal.timeout(k.timeoutMs ?? 60_000),
      });
    } catch {
      throw new KiFehler(`${k.name}: nicht erreichbar.`, 502);
    }
    const text = await antwort.text();
    if (!antwort.ok) {
      if (antwort.status === 400 && jsonModus && /response_format|json_object/i.test(text)) {
        jsonModus = false;
        continue;
      }
      throw fehler(antwort.status, text, k);
    }
    let inhaltText = '';
    try {
      inhaltText = (JSON.parse(text) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '';
    } catch {
      throw new KiFehler('Unerwartete Antwort der KI.');
    }
    const ohneDenken = inhaltText.replace(/<think>[\s\S]*?<\/think>/gi, '');
    const start = ohneDenken.indexOf('{');
    const ende = ohneDenken.lastIndexOf('}');
    let daten: unknown = null;
    try {
      daten = start >= 0 && ende > start ? JSON.parse(ohneDenken.slice(start, ende + 1)) : null;
    } catch {
      daten = null;
    }
    const lesung = pruefeBonLesung(daten);
    if (lesung.seiten.length === 0) throw new KiFehler('Auf dem Foto konnte kein Bon-Text gelesen werden. Bitte schärfer oder heller fotografieren.', 422);
    return lesung;
  }
  throw new KiFehler('Die KI hat nicht geantwortet.');
}
