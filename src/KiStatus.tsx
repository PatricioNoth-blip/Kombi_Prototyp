// Ehrlich zeigen, ob die KI wirklich angebunden ist: Health-Check beim Öffnen (ohne KI-Aufruf),
// „Verbindung testen“ macht einen echten, kleinen Probelauf (Antwortzeit, JSON, Schema, Prüfung).
import { useEffect, useState } from 'react';
import { pruefeKi, type KiStatus as Status } from './essenApi';
import type { KiProbe } from '../supabase/functions/_shared/kombi/gesundheit.ts';
import { Icon } from './Icon';

type Zustand = (Status & { probe?: KiProbe }) | null;

function probeText(p: KiProbe): string {
  if (!p.json_gueltig) return `Test fehlgeschlagen: keine gültige JSON-Antwort${p.fehler ? ` (${p.fehler})` : ''}.`;
  if (!p.schema_gueltig) return `Test fehlgeschlagen: ${p.fehler ?? 'unerwartetes Format'}.`;
  const zeit = `${(p.ms / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} s`;
  const teile = [`Live getestet: ${zeit}`, 'JSON ✓', 'Format ✓', `${p.gerichte} von ${p.vorschlaege_roh} Vorschlägen bestanden die Prüfung`];
  if (p.bildanforderungen) teile.push(`${p.bildanforderungen_ok}/${p.bildanforderungen} Bildanforderungen passend`);
  return teile.join(' · ');
}

export function KiStatus() {
  const [z, setZ] = useState<Zustand>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function pruefen(probe: boolean) {
    setLaeuft(true);
    try {
      setZ(await pruefeKi(probe));
    } finally {
      setLaeuft(false);
    }
  }
  useEffect(() => {
    void pruefen(false);
  }, []);

  const ok = z?.art === 'ok' ? z : null;
  const eingerichtet = !!ok?.gesundheit.ki.eingerichtet;
  let zeile: string;
  if (!z || z.art === 'laedt') zeile = 'Prüfe die KI-Verbindung …';
  else if (z.art !== 'ok') zeile = z.hinweis;
  else if (!eingerichtet) zeile = 'Nicht eingerichtet (KI_API_KEY fehlt) – Vorschläge nach Kombi-Regeln.';
  else zeile = `${z.gesundheit.ki.anbieter} · ${z.gesundheit.ki.modell ?? 'Modell unbekannt'}${z.aktuell ? '' : ` · Version ${z.gesundheit.version} – bitte neu deployen`}`;
  const bilder = ok
    ? `Bilder: ${ok.gesundheit.bilder.suche === 'aus' ? 'Suche aus' : 'Suche (Wikimedia Commons)'}${ok.gesundheit.bilder.generierung.eingerichtet ? ` + Generierung (${ok.gesundheit.bilder.generierung.anbieter})` : ', Generierung nicht eingerichtet'}`
    : null;

  return (
    <div className="option-zeile ki-status" aria-live="polite">
      <span className="option-name"><Icon name="funken" groesse={18} /> KI</span>
      <div className="ki-status-text">
        <small>{zeile}</small>
        {bilder && <small className="leise">{bilder}</small>}
        {z?.probe && <small className={z.probe.ok ? 'status-ok' : 'status-achtung'}>{probeText(z.probe)}</small>}
      </div>
      {eingerichtet && (
        <button type="button" className="link" onClick={() => void pruefen(true)} disabled={laeuft}>
          {laeuft ? 'Teste …' : 'Testen'}
        </button>
      )}
    </div>
  );
}
