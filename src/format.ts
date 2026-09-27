// Anzeige-Helfer für Datum und Geld.

/** '2026-09-27' → '27.09.2026' */
export function datum(iso: string): string {
  const [j, m, t] = iso.split('-');
  return `${t}.${m}.${j}`;
}

/** '2026-09-27' + 90 Tage → '26.12.2026' */
export function plusTage(iso: string, tage: number): string {
  const [j, m, t] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t + tage));
  return datum(d.toISOString().slice(0, 10));
}

/** Wie viele Tage ist das Datum her (nach Handy-Kalender)? */
export function tageSeit(iso: string): number {
  const [j, m, t] = iso.split('-').map(Number);
  const jetzt = new Date();
  const heute = Date.UTC(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  return Math.round((heute - Date.UTC(j, m - 1, t)) / 86_400_000);
}

/** 17 → '0,17 €' */
export function euro(cent: number): string {
  return (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

/** '0,17' / '0.17' / '1' → Cent; leer → null; ungültig → NaN */
export function euroZuCent(text: string): number | null {
  const t = text.replace('€', '').trim().replace(',', '.');
  if (t === '') return null;
  const wert = Number(t);
  return Number.isFinite(wert) && wert >= 0 ? Math.round(wert * 100) : NaN;
}
