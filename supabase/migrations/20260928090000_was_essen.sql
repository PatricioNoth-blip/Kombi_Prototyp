-- Kombi: „Was essen wir?“ (KI-Rezeptvorschläge)
--
-- Die bestehende Bestandslogik (einfrieren, entnehmen, rueckgaengig) bleibt unverändert.
-- Neu:
--   • block_typ.lagerort: Neben Gefrierblöcken können Vorrat (Pasta, Reis, Dosen …) und
--     Kühlschrank-Sachen als normale Sorten mit Preis pro Portion geführt werden.
--   • koch_session, vorschlag, vorschlag_feedback: was gezeigt wurde und wie entschieden wurde.
--   • rezept: gespeicherte Gerichte.
-- Die KI selbst schreibt nichts in die Datenbank. Alle Zeilen hier legt die App an,
-- und Bestände ändern sich weiterhin nur über die Buchungsfunktionen.

-- ───────────── Lagerort ─────────────

alter table block_typ
  add column lagerort text not null default 'gefrierfach'
  check (lagerort in ('gefrierfach', 'kuehlschrank', 'vorrat'));

-- Neue Spalte hinten anhängen (create or replace erlaubt nur das).
create or replace view bestand with (security_invoker = true) as
select t.id,
       t.name,
       t.farbe,
       coalesce(sum(c.menge_aktuell), 0)::integer                  as anzahl,
       t.mindestbestand,
       coalesce(sum(c.menge_aktuell), 0) < t.mindestbestand        as nachkochen,
       min(c.eingefroren_am) filter (where c.menge_aktuell > 0)     as aelteste,
       coalesce(heute() - min(c.eingefroren_am) filter (where c.menge_aktuell > 0)
                > t.haltbar_tage - 14, false)                       as bald_ablaufen,
       t.haltbar_tage,
       t.groesse_g,
       t.kosten_cent,
       t.lagerort
from block_typ t
left join charge c on c.block_typ_id = t.id
group by t.id;

-- ───────────── Sessions, Vorschläge, Feedback ─────────────

create table koch_session (
  id          uuid primary key default gen_random_uuid(),
  erstellt_am timestamptz not null default now(),
  personen    integer not null default 2 check (personen between 1 and 12),
  max_minuten integer check (max_minuten between 5 and 240),
  guenstig    boolean not null default true,
  kuehlschrank text check (length(kuehlschrank) <= 1000)
);

create table vorschlag (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references koch_session(id) on delete cascade,
  erstellt_am timestamptz not null default now(),
  art         text not null check (art in ('gericht', 'einkauf', 'baustein')),
  name        text not null check (length(name) between 1 and 200),
  daten       jsonb not null,                 -- geprüfter Vorschlag (Zutaten, Kosten, Eigenschaften …)
  anbieter    text not null                   -- z. B. „regelbasiert“ oder „groq:openai/gpt-oss-120b“
);

create index vorschlag_session_idx on vorschlag (session_id, erstellt_am);

create table vorschlag_feedback (
  id           bigint generated always as identity primary key,
  vorschlag_id uuid not null references vorschlag(id) on delete cascade,
  aktion       text not null check (aktion in ('like', 'dislike', 'similar', 'skip', 'save', 'cook')),
  erstellt_am  timestamptz not null default now()
);

create index vorschlag_feedback_vorschlag_idx on vorschlag_feedback (vorschlag_id);

create table rezept (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(name) between 1 and 200),
  daten        jsonb not null,
  vorschlag_id uuid references vorschlag(id) on delete set null,
  erstellt_am  timestamptz not null default now()
);

-- ───────────── Rechte ─────────────
-- Wie beim Bestand: App ohne Login (anon) und später mit Login (authenticated).
-- Nur lesen und anlegen – Verlauf und Feedback werden nie geändert oder gelöscht.

alter table koch_session       enable row level security;
alter table vorschlag          enable row level security;
alter table vorschlag_feedback enable row level security;
alter table rezept             enable row level security;

revoke all on koch_session, vorschlag, vorschlag_feedback, rezept
  from public, anon, authenticated;

grant select, insert on koch_session, vorschlag, vorschlag_feedback, rezept
  to anon, authenticated;

create policy "App liest Sessions"     on koch_session       for select to anon, authenticated using (true);
create policy "App legt Sessions an"   on koch_session       for insert to anon, authenticated with check (true);
create policy "App liest Vorschläge"   on vorschlag          for select to anon, authenticated using (true);
create policy "App legt Vorschläge an" on vorschlag          for insert to anon, authenticated with check (true);
create policy "App liest Feedback"     on vorschlag_feedback for select to anon, authenticated using (true);
create policy "App legt Feedback an"   on vorschlag_feedback for insert to anon, authenticated with check (true);
create policy "App liest Rezepte"      on rezept             for select to anon, authenticated using (true);
create policy "App speichert Rezepte"  on rezept             for insert to anon, authenticated with check (true);

notify pgrst, 'reload schema';
