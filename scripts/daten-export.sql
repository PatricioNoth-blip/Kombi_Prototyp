-- Kombi – Datensicherung vor dem Einspielen weiterer Migrationen.
--
-- NUR LESEND: ändert nichts. Supabase-Dashboard → SQL Editor → einfügen → Run.
-- Ergebnis: eine Zelle „sicherung“ mit allen Daten der Tabellen aus den Dateien 1–3
-- (Sorten, Chargen, Bewegungen, „Was essen wir?“) als JSON. Den Inhalt kopieren und als
-- Datei speichern (z. B. kombi-sicherung-2026-09-28.json). Diese Tabellen bleiben durch
-- spätere Migrationen erhalten – das Skript läuft daher auch danach noch.

select json_build_object(
  'stand',              now(),
  'block_typ',          (select coalesce(json_agg(t order by t.id), '[]') from block_typ t),
  'charge',             (select coalesce(json_agg(t order by t.id), '[]') from charge t),
  'bewegung',           (select coalesce(json_agg(t order by t.id), '[]') from bewegung t),
  'koch_session',       (select coalesce(json_agg(t order by t.erstellt_am), '[]') from koch_session t),
  'vorschlag',          (select coalesce(json_agg(t order by t.erstellt_am), '[]') from vorschlag t),
  'vorschlag_feedback', (select coalesce(json_agg(t order by t.erstellt_am), '[]') from vorschlag_feedback t),
  'rezept',             (select coalesce(json_agg(t order by t.erstellt_am), '[]') from rezept t)
) as sicherung;
