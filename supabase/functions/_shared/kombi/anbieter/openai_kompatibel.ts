// KI-Anbieter für alle Dienste mit OpenAI-kompatibler Chat-Schnittstelle:
// Groq, Google Gemini, OpenRouter, Ollama (lokal) und weitere.
// Läuft nur serverseitig (Edge Function) – der API-Key kommt aus der Umgebung, nie aus dem Client.
import type { KiAnbieter, KiAuftrag, RohAntwort } from '../typen.ts';
import { auftragAlsText, SYSTEM_PROMPT } from './prompt.ts';

export type OpenAiKonfig = {
  /** Kurzname für Protokoll und Anzeige, z. B. „groq“ */
  name: string;
  basisUrl: string;
  apiKey: string | null;
  modell: string;
  temperatur?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export class KiFehler extends Error {
  status: number;
  constructor(meldung: string, status = 502) {
    super(meldung);
    this.status = status;
  }
}

/** Holt das JSON-Objekt aus der Antwort – auch wenn ein Modell Denk-Text oder ```json davorsetzt. */
export function parseKiAntwort(text: string): RohAntwort {
  const ohneDenken = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const start = ohneDenken.indexOf('{');
  const ende = ohneDenken.lastIndexOf('}');
  if (start < 0 || ende <= start) throw new KiFehler('Die KI hat kein JSON geliefert.');
  let daten: unknown;
  try {
    daten = JSON.parse(ohneDenken.slice(start, ende + 1));
  } catch {
    throw new KiFehler('Die Antwort der KI war kein gültiges JSON.');
  }
  if (!daten || typeof daten !== 'object' || !Array.isArray((daten as RohAntwort).vorschlaege)) {
    throw new KiFehler('Die Antwort der KI hatte nicht das erwartete Format.');
  }
  return daten as RohAntwort;
}

function fehlermeldung(status: number, text: string, konfig: OpenAiKonfig): KiFehler {
  if (status === 401 || status === 403) return new KiFehler(`${konfig.name}: API-Key ungültig oder ohne Berechtigung.`, 502);
  if (status === 404 || /model.*(not found|does not exist|decommission)/i.test(text)) {
    return new KiFehler(`${konfig.name}: Modell „${konfig.modell}“ nicht verfügbar – KI_MODELL anpassen.`, 502);
  }
  if (status === 429) return new KiFehler(`${konfig.name}: kostenloses Kontingent gerade erschöpft – bitte etwas später nochmal.`, 429);
  return new KiFehler(`${konfig.name}: Fehler ${status}.`, 502);
}

export function openAiKompatibel(konfig: OpenAiKonfig): KiAnbieter {
  const f = konfig.fetch ?? fetch;

  async function anfrage(nachrichten: { role: string; content: string }[], jsonModus: boolean) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (konfig.apiKey) headers.authorization = `Bearer ${konfig.apiKey}`;
    const body: Record<string, unknown> = {
      model: konfig.modell,
      messages: nachrichten,
      temperature: konfig.temperatur ?? 1.0,
    };
    if (jsonModus) body.response_format = { type: 'json_object' };
    return await f(`${konfig.basisUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(konfig.timeoutMs ?? 45_000),
    });
  }

  return {
    name: `${konfig.name}:${konfig.modell}`,
    async vorschlagen(auftrag: KiAuftrag): Promise<RohAntwort> {
      const nachrichten = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: auftragAlsText(auftrag) },
      ];
      let jsonModus = true;
      let letzterFehler: KiFehler | null = null;

      // Höchstens zwei Versuche: z. B. wenn ein Modell kein JSON-Format kennt oder Unsinn liefert.
      for (let versuch = 0; versuch < 2; versuch++) {
        let antwort: Response;
        try {
          antwort = await anfrage(nachrichten, jsonModus);
        } catch {
          throw new KiFehler(`${konfig.name}: nicht erreichbar.`, 502);
        }
        const text = await antwort.text();
        if (!antwort.ok) {
          if (antwort.status === 400 && jsonModus && /response_format|json/i.test(text)) {
            jsonModus = false; // Modell unterstützt den JSON-Modus nicht → ohne erneut versuchen
            continue;
          }
          throw fehlermeldung(antwort.status, text, konfig);
        }
        try {
          const daten = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
          return parseKiAntwort(daten.choices?.[0]?.message?.content ?? '');
        } catch (e) {
          letzterFehler = e instanceof KiFehler ? e : new KiFehler('Unerwartete Antwort der KI.');
        }
      }
      throw letzterFehler ?? new KiFehler('Die KI hat nicht geantwortet.');
    },
  };
}
