// Bildpipeline der Edge Function: erst ein echtes, frei lizenziertes Foto suchen (Wikimedia Commons),
// sonst – nur wenn eingerichtet – ein Bild generieren und dauerhaft im Supabase-Speicher ablegen.
// Nie eine Pflichtabhängigkeit: Klappt nichts, liefert der Dienst „kein Bild“ und die App zeigt ihr
// lokales Bild. Keys kommen nur aus der Umgebung und werden nie zurückgegeben oder protokolliert.
//
// Umgebungsvariablen (alle optional):
//   BILD_API_KEY      Key eines Bild-Anbieters (ohne Key: keine Generierung, nur Suche)
//   BILD_ANBIETER     openai (Standard) | together | eigen
//   BILD_MODELL       optional, sonst Standard des Anbieters
//   BILD_BASIS_URL    optional, Pflicht bei „eigen“ (OpenAI-kompatible /images/generations)
//   BILD_SUCHE        „aus“ schaltet die Commons-Suche ab
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  stellt Supabase in Edge Functions selbst bereit –
//                     nur zum Ablegen generierter Bilder im öffentlichen Bucket „bilder“
import {
  alsBildDaten, type BildAnfrage, type BildDaten, bildPrompt, commonsSuchUrl, schluesselHash, sichereBildUrl, werteCommonsAus,
} from './bilder.ts';

type Env = (name: string) => string | undefined;
const USER_AGENT = 'Kombi/1.0 (https://github.com/PatricioNoth-blip/Kombi_Prototyp; Haushalts-App)';

export type BildGenerator = {
  readonly name: string;
  readonly modell: string;
  erzeugen(prompt: string, format: BildAnfrage['format']): Promise<{ bytes: Uint8Array; mime: string }>;
};

type Voreinstellung = { basisUrl: string; modell: string };
export const BILD_VOREINSTELLUNGEN: Record<string, Voreinstellung> = {
  openai: { basisUrl: 'https://api.openai.com/v1', modell: 'gpt-image-1' },
  together: { basisUrl: 'https://api.together.xyz/v1', modell: 'black-forest-labs/FLUX.1-schnell' },
};

const GROESSE: Record<BildAnfrage['format'], string> = { '4:3': '1536x1024', '3:2': '1536x1024', '16:9': '1536x1024', '1:1': '1024x1024' };

function base64ZuBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Generator aus der Umgebung – oder null, wenn keiner eingerichtet ist (dann nur Suche). */
export function bildGeneratorAusUmgebung(env: Env, f: typeof fetch = fetch): BildGenerator | null {
  const key = env('BILD_API_KEY')?.trim();
  if (!key) return null;
  const name = (env('BILD_ANBIETER') || 'openai').trim().toLowerCase();
  const vor = BILD_VOREINSTELLUNGEN[name];
  const basisUrl = (env('BILD_BASIS_URL')?.trim() || vor?.basisUrl)?.replace(/\/$/, '');
  const modell = env('BILD_MODELL')?.trim() || vor?.modell;
  if (!basisUrl || !modell) return null;
  return {
    name,
    modell,
    async erzeugen(prompt, format) {
      const body: Record<string, unknown> = { model: modell, prompt, n: 1, size: GROESSE[format] };
      // gpt-image-* liefert immer base64 und kennt ein kleines Ausgabeformat; andere: base64 anfordern
      if (/^gpt-image/.test(modell)) Object.assign(body, { output_format: 'webp', output_compression: 70, quality: 'low' });
      else body.response_format = 'b64_json';
      const r = await f(`${basisUrl}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`${name}: Bildgenerierung fehlgeschlagen (${r.status}).`);
      const d = (await r.json()) as { data?: { b64_json?: string; url?: string }[] };
      const eintrag = d.data?.[0];
      if (eintrag?.b64_json) return { bytes: base64ZuBytes(eintrag.b64_json), mime: /^gpt-image/.test(modell) ? 'image/webp' : 'image/png' };
      if (eintrag?.url && /^https:\/\//.test(eintrag.url)) {
        // Temporäre URL des Anbieters → Bild holen und selbst dauerhaft ablegen (kein Hotlink)
        const bild = await f(eintrag.url, { signal: AbortSignal.timeout(30_000) });
        const mime = bild.headers.get('content-type') ?? '';
        if (!bild.ok || !/^image\/(png|jpeg|webp)$/.test(mime)) throw new Error(`${name}: Bild nicht abrufbar.`);
        return { bytes: new Uint8Array(await bild.arrayBuffer()), mime };
      }
      throw new Error(`${name}: Antwort ohne Bild.`);
    },
  };
}

export type BildSpeicher = { ablegen(pfad: string, bytes: Uint8Array, mime: string): Promise<string> };

/** Öffentlicher Bucket „bilder“ im eigenen Supabase-Projekt – oder null, wenn nicht verfügbar. */
export function bildSpeicherAusUmgebung(env: Env, f: typeof fetch = fetch): BildSpeicher | null {
  const url = env('SUPABASE_URL')?.replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key || !/^https:\/\//.test(url)) return null;
  return {
    async ablegen(pfad, bytes, mime) {
      const r = await f(`${url}/storage/v1/object/bilder/${pfad}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': mime, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
        // als ArrayBuffer – passt für alle TypeScript-/Deno-Versionen
        body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(`Speicher: Ablegen fehlgeschlagen (${r.status}) – gibt es den Bucket „bilder“?`);
      return `${url}/storage/v1/object/public/bilder/${pfad}`;
    },
  };
}

export type BildErgebnis = {
  bild: BildDaten | null;
  /** was versucht wurde – für Anzeige und Live-Check, ohne Keys */
  weg: ('suche' | 'suche_leer' | 'suche_fehler' | 'generiert' | 'generierung_fehler' | 'keine_generierung')[];
  hinweis: string | null;
};

/** Prüft, ob eine gefundene URL wirklich ein Bild liefert (kein toter Link). */
async function istErreichbar(url: string, f: typeof fetch): Promise<boolean> {
  try {
    const r = await f(url, { method: 'HEAD', headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(8_000) });
    return r.ok && /^image\//.test(r.headers.get('content-type') ?? '');
  } catch {
    return false;
  }
}

/**
 * Sucht bzw. erzeugt ein Bild für die (bereits geprüfte) Anfrage.
 * Reihenfolge: echtes Foto (Commons, freie Lizenz, passend, erreichbar) → generiert → nichts.
 */
export async function findeBild(
  anfrage: BildAnfrage,
  o: { fetch: typeof fetch; generator: BildGenerator | null; speicher: BildSpeicher | null; jetzt: string; suche?: boolean },
): Promise<BildErgebnis> {
  const weg: BildErgebnis['weg'] = [];
  if (o.suche !== false) {
    try {
      const r = await o.fetch(commonsSuchUrl(anfrage.suchbegriff), { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
      const funde = r.ok ? werteCommonsAus(await r.json(), anfrage) : [];
      weg.push(r.ok ? 'suche' : 'suche_fehler');
      for (const f of funde.slice(0, 3)) {
        if (await istErreichbar(f.url, o.fetch)) return { bild: alsBildDaten(f, anfrage, o.jetzt), weg, hinweis: null };
      }
      weg.push('suche_leer');
    } catch {
      weg.push('suche_fehler');
    }
  }
  if (!o.generator || !o.speicher) {
    weg.push('keine_generierung');
    return { bild: null, weg, hinweis: 'Kein passendes Foto gefunden – Bildgenerierung ist nicht eingerichtet.' };
  }
  try {
    // Beschreibung immer aus dem geprüften Motiv – nie aus mitgeschicktem Freitext
    const { bytes, mime } = await o.generator.erzeugen(bildPrompt(anfrage.motiv, anfrage.stil), anfrage.format);
    if (bytes.length === 0 || bytes.length > 6_000_000) throw new Error('Bildgröße unplausibel');
    const endung = mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : 'png';
    const url = await o.speicher.ablegen(`generiert/${schluesselHash(anfrage.schluessel)}.${endung}`, bytes, mime);
    if (!sichereBildUrl(url, 'generiert')) throw new Error('Speicher-URL unerwartet');
    weg.push('generiert');
    return {
      bild: {
        image_url: url, image_source: 'generiert', image_status: 'ok', image_query: anfrage.suchbegriff, image_alt: anfrage.alt,
        image_generated: true, image_updated_at: o.jetzt, lizenz: `KI-generiert (${o.generator.name}: ${o.generator.modell})`,
        urheber: null, quelle_seite: null,
      },
      weg,
      hinweis: null,
    };
  } catch (e) {
    weg.push('generierung_fehler');
    return { bild: null, weg, hinweis: e instanceof Error ? e.message : 'Bildgenerierung fehlgeschlagen.' };
  }
}
