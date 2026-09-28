-- Kombi: Bilder und semantische Zutaten
--
-- Voraussetzung: Migration „kosten_naehrwerte“.
--
-- Grundsätze:
--   • Rückwärtskompatibel: nur neue Spalten und eine neue Tabelle – nichts wird ersetzt oder gelöscht.
--   • Bilder sind Illustration. Eine Bild-URL wird nur gespeichert, wenn sie https ist; gefundene und
--     generierte Bilder nur von dauerhaften Quellen (Wikimedia Commons, eigener Supabase-Speicher).
--     Die KI liefert nie eine URL – sie kommt ausschließlich aus Bildsuche oder -generierung.
--   • Bild-Cache „bild“: Hat ein Inhalt (z. B. „gericht:bowl:gurke+joghurt+tomate“) schon ein gültiges
--     Bild, wird nicht erneut gesucht oder generiert. Nichts wird gelöscht; kaputte Bilder werden als
--     „fehler“ markiert, der nächste gültige Eintrag gewinnt.
--   • Semantische Zutat: Die Sorte bleibt das gekaufte Produkt („REWE Strauchtomaten 500 g“);
--     „zutat“ sagt optional, was es als Lebensmittel ist (Katalog-id wie „tomate“). Leer = automatisch
--     aus dem Namen erkannt (siehe supabase/functions/_shared/kombi/zutaten.ts).

-- ───────────── Bild und Zutat je Sorte ─────────────
alter table block_typ
  add column image_url        text check (image_url ~ '^https://[^[:space:]]+$' and length(image_url) <= 2000),
  add column image_source     text check (image_source in ('eigen', 'gefunden', 'generiert', 'lokal', 'keins')),
  add column image_status     text check (image_status in ('ok', 'ausstehend', 'fehler', 'fehlt')),
  add column image_query      text check (length(image_query) <= 200),
  add column image_alt        text check (length(image_alt) <= 200),
  add column image_generated  boolean not null default false,
  add column image_updated_at timestamptz,
  add column zutat            text check (zutat ~ '^[a-z0-9_]{2,40}$');

-- ───────────── Übersicht ─────────────
-- Neu hinten angehängt: Bild und semantische Zutat.
create or replace view bestand with (security_invoker = true) as
select t.id,
       t.name,
       t.farbe,
       coalesce(sum(c.menge_aktuell), 0)::integer                  as anzahl,
       t.mindestbestand,
       coalesce(sum(c.menge_aktuell), 0) < t.mindestbestand        as nachkochen,
       min(c.eingefroren_am) filter (where c.menge_aktuell > 0)     as aelteste,
       coalesce(heute() - min(c.eingefroren_am) filter (where c.menge_aktuell > 0)
                > t.haltbar_tage - 14, false)
         or coalesce(min(c.ablauf_am) filter (where c.menge_aktuell > 0) <= heute() + 3, false)
                                                                    as bald_ablaufen,
       t.haltbar_tage,
       t.groesse_g,
       t.kosten_cent,
       t.lagerort,
       t.art,
       t.herkunft,
       t.einheit,
       t.portion_menge,
       t.kosten_menge,
       t.zusammensetzung,
       t.notiz,
       min(c.ablauf_am) filter (where c.menge_aktuell > 0)          as naechster_ablauf,
       coalesce(sum(c.menge_aktuell) filter (where c.geoeffnet_am is not null), 0)::integer
                                                                    as geoeffnet,
       min(c.geoeffnet_am) filter (where c.menge_aktuell > 0)       as geoeffnet_seit,
       coalesce(sum(c.menge_aktuell) filter (where c.ablauf_am < heute()), 0)::integer
                                                                    as abgelaufen,
       t.gerichtstypen,
       t.richtung,
       coalesce(sum(c.menge_start) filter (where c.menge_aktuell > 0), 0)::integer
                                                                    as start_menge,
       (select coalesce(sum(a.menge), 0) from auftauen a
         where a.block_typ_id = t.id and a.status = 'aufgetaut')::integer  as aufgetaut,
       (select coalesce(sum(a.menge), 0) from auftauen a
         where a.block_typ_id = t.id and a.status = 'geplant')::integer    as auftauen_geplant,
       t.kcal,
       t.protein_g,
       t.kohlenhydrate_g,
       t.fett_g,
       t.naehrwert_menge,
       t.image_url,
       t.image_source,
       t.image_status,
       t.image_query,
       t.image_alt,
       t.image_generated,
       t.image_updated_at,
       t.zutat
from block_typ t
left join charge c on c.block_typ_id = t.id
group by t.id;

-- ───────────── Bild-Cache ─────────────
create table bild (
  id               bigint generated always as identity primary key,
  schluessel       text not null check (schluessel ~ '^[a-z]+:[a-z0-9-]+:[a-z0-9+-]+$' and length(schluessel) <= 200),
  art              text not null check (art in ('gericht', 'komponente', 'zutat')),
  image_url        text not null check (
                     image_url ~ '^https://(upload\.wikimedia\.org/|[a-z0-9-]+\.supabase\.co/storage/v1/object/public/)[^[:space:]]+$'
                     and length(image_url) <= 2000),
  image_source     text not null check (image_source in ('gefunden', 'generiert')),
  image_status     text not null default 'ok' check (image_status in ('ok', 'fehler')),
  image_query      text check (length(image_query) <= 200),
  image_alt        text check (length(image_alt) <= 200),
  image_generated  boolean not null default false,
  image_updated_at timestamptz not null default now(),
  -- Lizenz- und Quelleninformation (bei gefundenen Bildern Pflicht)
  lizenz           text check (length(lizenz) <= 120),
  urheber          text check (length(urheber) <= 200),
  quelle_seite     text check (quelle_seite ~ '^https://[^[:space:]]+$' and length(quelle_seite) <= 2000),
  erstellt_am      timestamptz not null default now(),
  check (image_generated = (image_source = 'generiert')),
  check (image_source <> 'gefunden' or (lizenz is not null and quelle_seite is not null))
);

create index bild_schluessel_idx on bild (schluessel, image_updated_at desc);

-- Status ändern setzt den Zeitstempel (von der App nicht direkt setzbar)
create function bild_zeitstempel() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.image_updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger bild_zeitstempel before update on bild
  for each row execute function bild_zeitstempel();

alter table bild enable row level security;
revoke all on bild from public, anon, authenticated;
grant select on bild to anon, authenticated;
-- anlegen nur mit Inhalt; ändern nur den Status („fehler“, wenn ein Bild nicht mehr lädt)
grant insert (schluessel, art, image_url, image_source, image_query, image_alt, image_generated, lizenz, urheber, quelle_seite)
  on bild to anon, authenticated;
grant update (image_status) on bild to anon, authenticated;

create policy "App liest Bilder"      on bild for select to anon, authenticated using (true);
create policy "App merkt sich Bilder" on bild for insert to anon, authenticated with check (image_status = 'ok');
create policy "App markiert Bilder"   on bild for update to anon, authenticated using (true) with check (true);

-- ───────────── Speicher für generierte Bilder ─────────────
-- Öffentlich lesbar; schreiben darf nur die Edge Function (Service-Rolle). Lokale Test-Datenbanken
-- ohne Supabase-Speicher überspringen das.
do $$
begin
  if exists (select from pg_namespace where nspname = 'storage')
     and exists (select from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public) values ('bilder', 'bilder', true) on conflict (id) do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';
