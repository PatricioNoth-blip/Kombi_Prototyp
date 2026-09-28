-- Kombi: sonstige Ausgaben (alles, was nicht über den Vorrat läuft – z. B. Essen bestellt, Kaffee, Kantine)
--
-- Voraussetzung: Migration „kosten_naehrwerte“ (für die Startseite; die Tabelle selbst ist unabhängig).
--
-- Grundsätze:
--   • Nur echte, von Hand eingetragene Beträge. Kombi schätzt nichts.
--   • Sonstiges hat keinen Bezug zum Vorrat und wird nie mit Einkäufen oder Warenwert verrechnet.
--   • Nichts wird gelöscht: Ein Eintrag lässt sich nur als „entfernt“ markieren – und wieder zurückholen.

create table ausgabe (
  id          bigint generated always as identity primary key,
  datum       date not null default heute(),
  betrag_cent integer not null check (betrag_cent > 0 and betrag_cent <= 1000000),   -- höchstens 10.000 €
  notiz       text check (length(notiz) <= 80),
  entfernt    boolean not null default false,
  erstellt_am timestamptz not null default now()
);

create index ausgabe_datum_idx on ausgabe (datum) where not entfernt;

alter table ausgabe enable row level security;
revoke all on ausgabe from anon, authenticated;
grant select on ausgabe to anon, authenticated;
-- anlegen nur mit Datum, Betrag und Notiz; ändern nur „entfernt“
grant insert (datum, betrag_cent, notiz) on ausgabe to anon, authenticated;
grant update (entfernt) on ausgabe to anon, authenticated;

create policy "App liest Ausgaben"      on ausgabe for select to anon, authenticated using (true);
create policy "App trägt Ausgaben ein"  on ausgabe for insert to anon, authenticated
  with check (not entfernt and datum between heute() - 400 and heute() + 1);
create policy "App entfernt Ausgaben"   on ausgabe for update to anon, authenticated using (true) with check (true);
