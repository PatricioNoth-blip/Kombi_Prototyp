// Gespeicherte Rezepte ohne Doppelte. Die App darf Rezepte nur lesen und anlegen (nicht löschen) –
// deshalb wird beim Anzeigen zusammengefasst und beim Speichern geprüft, ob es das Rezept schon gibt.
// Rein und ohne Laufzeit-Importe, damit es sich ohne Browser testen lässt.
import { normalisiere } from '../supabase/functions/_shared/kombi/text.ts';

/** „ Linsen-Bolognese “, „linsen bolognese“ und „Linsen-Bolognese“ sind dasselbe Rezept. */
export function rezeptSchluessel(name: string): string {
  return normalisiere(name.normalize('NFC'));
}

/** Je Name nur das neueste Rezept; Reihenfolge: neueste zuerst. */
export function ohneDoppelte<T extends { name: string; erstellt_am: string }>(rezepte: T[]): T[] {
  const neueste = new Map<string, T>();
  for (const r of rezepte) {
    const k = rezeptSchluessel(r.name);
    if (!k) continue;
    const bisher = neueste.get(k);
    if (!bisher || r.erstellt_am > bisher.erstellt_am) neueste.set(k, r);
  }
  return [...neueste.values()].sort((a, b) => b.erstellt_am.localeCompare(a.erstellt_am));
}

/** Gibt es dieses Rezept schon? Dann wird es nicht noch einmal gespeichert. */
export function schonGespeichert(rezepte: { name: string }[], name: string): boolean {
  const k = rezeptSchluessel(name);
  return rezepte.some((r) => rezeptSchluessel(r.name) === k);
}
