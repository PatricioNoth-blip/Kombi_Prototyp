-- Kombi: Komponenten-Funktion, Planung, Einkauf, Auftauen, Nutzung
--
-- Voraussetzung: Migration „baukasten“.
--
-- Grundsätze (wie bisher):
--   • Bestände ändern sich nur über einfrieren(), entnehmen() und rueckgaengig().
--     Die neuen Funktionen kochen(), herstellen() und einkauf_buchen() rufen genau diese auf –
--     in EINER Transaktion: entweder alles oder nichts.
--   • Geplante Mahlzeiten und vorgemerkte Komponenten verändern den Bestand nicht.
--     Reservierungen und Einkaufsbedarf rechnet die App daraus (nichts wird doppelt angerechnet).
--   • Auftauen ist nur ein Status – es verbraucht nichts.

-- ───────────── Komponenten: Funktion im Baukasten ─────────────
-- Die Rolle ergibt sich aus der Kombi-Farbe (rot = Basis & Soße, braun = Protein, …).
-- Neu und optional: wofür sich eine Sorte eignet und in welche Richtung sie geht.

alter table block_typ
  add column gerichtstypen text[]
    check (gerichtstypen is null or cardinality(gerichtstypen) between 1 and 16),
  add column richtung text
    check (richtung in ('italienisch', 'indisch', 'mexikanisch', 'asiatisch', 'orientalisch', 'deutsch', 'neutral'));

-- ───────────── Planung ─────────────
-- art = mahlzeit:   ein geplantes Gericht (mit oder ohne Datum)
-- art = komponente: eine vorgemerkte Komponente, die noch eingekauft/hergestellt werden soll
-- daten enthält den geprüften Vorschlag inklusive Bedarf (Zutaten mit Mengen).

create table plan (
  id          uuid primary key default gen_random_uuid(),
  art         text not null check (art in ('mahlzeit', 'komponente')),
  titel       text not null check (length(titel) between 1 and 200),
  datum       date,                          -- null = flexibel
  portionen   integer not null default 2 check (portionen between 1 and 24),
  daten       jsonb not null,
  status      text not null default 'geplant' check (status in ('geplant', 'erledigt')),
  erstellt_am timestamptz not null default now(),
  erledigt_am timestamptz
);

create index plan_status_idx on plan (status, datum);

-- ───────────── Einkauf ─────────────
-- Einträge, die nicht aus Plänen berechnet werden: von Hand, aus einem Rezept, Notfall, Mangel.
create table einkauf_eintrag (
  id           bigint generated always as identity primary key,
  name         text not null check (length(name) between 1 and 80),
  schluessel   text not null check (length(schluessel) between 1 and 80),  -- zum Zusammenführen
  menge        integer check (menge > 0),                                   -- null = Menge offen
  einheit      text check (einheit in ('portion', 'stueck', 'g', 'ml')),
  kategorie    text not null default 'sonstiges'
               check (kategorie in ('rot', 'braun', 'gruen', 'gelb', 'weiss', 'schwarz', 'blau', 'sonstiges')),
  quelle       text not null check (quelle in ('manuell', 'rezept', 'komponente', 'notfall', 'mangel')),
  grund        text check (length(grund) <= 200),
  block_typ_id bigint references block_typ(id),
  plan_id      uuid references plan(id) on delete set null,
  status       text not null default 'offen' check (status in ('offen', 'erledigt', 'geloescht')),
  erstellt_am  timestamptz not null default now(),
  erledigt_am  timestamptz
);

create index einkauf_eintrag_offen_idx on einkauf_eintrag (schluessel, einheit) where status = 'offen';

-- Zustand einer Zeile der Einkaufsliste (abgehakt, zurückgestellt, ausgeblendet).
-- Eine Zeile = Produkt + Einheit; gilt für berechneten Bedarf und Einträge gemeinsam.
create table einkauf_status (
  schluessel  text not null check (length(schluessel) between 1 and 80),
  einheit     text not null check (einheit in ('portion', 'stueck', 'g', 'ml', 'offen')),
  status      text not null check (status in ('gekauft', 'zurueckgestellt', 'ignoriert')),
  geaendert_am timestamptz not null default now(),
  primary key (schluessel, einheit)
);

-- Verlauf: was aus dem Einkauf in den Vorrat gebucht wurde (Grundlage für Rückgängig).
create table einkauf_buchung (
  id                 bigint generated always as identity primary key,
  schluessel         text not null,
  einheit            text not null,
  block_typ_id       bigint not null references block_typ(id),
  menge              integer not null check (menge > 0),
  preis_cent         integer check (preis_cent >= 0),
  bewegung_ids       bigint[] not null,
  eintrag_ids        bigint[] not null default '{}',
  alter_kosten_cent  integer,
  alter_kosten_menge integer,
  rueckgaengig       boolean not null default false,
  erstellt_am        timestamptz not null default now()
);

-- ───────────── Auftauen ─────────────
-- geplant → aufgetaut → verbraucht (oder abgebrochen). Ändert keine Bestände.
create table auftauen (
  id            bigint generated always as identity primary key,
  block_typ_id  bigint not null references block_typ(id),
  menge         integer not null check (menge > 0),
  auftauen_am   date not null,                       -- an diesem Tag herausnehmen
  plan_id       uuid references plan(id) on delete set null,
  status        text not null default 'geplant'
                check (status in ('geplant', 'aufgetaut', 'verbraucht', 'abgebrochen')),
  status_vorher text,                                -- für Rückgängig nach dem Kochen
  bewegung_id   bigint,                              -- Entnahme, die es verbraucht hat
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now()
);

create index auftauen_offen_idx on auftauen (block_typ_id) where status in ('geplant', 'aufgetaut');

-- ───────────── Übersicht ─────────────
-- Neu hinten angehängt: Funktion, Startmenge der aktuellen Chargen (für „6 / 8 Portionen“),
-- aufgetaute und zum Auftauen vorgemerkte Mengen.

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
         where a.block_typ_id = t.id and a.status = 'geplant')::integer    as auftauen_geplant
from block_typ t
left join charge c on c.block_typ_id = t.id
group by t.id;

-- Tatsächliche Nutzung (ohne rückgängig gemachte Buchungen) – Grundlage für Batch-Cooking-Empfehlungen.
create view nutzung with (security_invoker = true) as
with echt as (
  select c.block_typ_id, b.art, b.menge, b.datum
  from bewegung b
  join charge c on c.id = b.charge_id
  where b.art in ('kochtag', 'verbrauch')
    and not exists (select 1 from bewegung k where k.storno_von = b.id)
)
select t.id                                                                         as block_typ_id,
       coalesce(sum(-e.menge) filter (where e.art = 'verbrauch' and e.datum > heute() - 28), 0)::integer
                                                                                    as verbrauch_28,
       count(distinct e.datum) filter (where e.art = 'verbrauch' and e.datum > heute() - 28)::integer
                                                                                    as verbrauchstage_28,
       count(*) filter (where e.art = 'kochtag' and e.datum > heute() - 56)::integer as herstellungen_56,
       coalesce(round(avg(e.menge) filter (where e.art = 'kochtag' and e.datum > heute() - 56)), 0)::integer
                                                                                    as mittlere_menge,
       max(e.datum) filter (where e.art = 'kochtag')                                as letzte_herstellung
from block_typ t
left join echt e on e.block_typ_id = t.id
group by t.id;

-- ───────────── Buchungen in einem Schritt ─────────────

-- Intern: mehrere Posten entnehmen (sortiert nach Sorte, damit sich gleichzeitige Buchungen
-- nicht gegenseitig blockieren) und passende Auftau-Vormerkungen als verbraucht markieren.
create function entnehme_posten(p_posten jsonb, p_plan_id uuid)
returns bigint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p    record;
  v_a    record;
  v_neu  bigint[];
  v_ids  bigint[] := '{}';
  v_rest integer;
begin
  if p_posten is null or jsonb_typeof(p_posten) <> 'array' then
    raise exception 'Posten fehlen.';
  end if;

  for v_p in
    select (e->>'block_typ_id')::bigint as id, sum((e->>'menge')::integer)::integer as menge
    from jsonb_array_elements(p_posten) e
    group by 1
    order by 1
  loop
    v_neu := entnehmen(v_p.id, v_p.menge);   -- Fehler → alles wird zurückgerollt
    v_ids := v_ids || v_neu;

    v_rest := v_p.menge;
    for v_a in
      select id, menge from auftauen
      where block_typ_id = v_p.id and status in ('aufgetaut', 'geplant')
      order by plan_id is not distinct from p_plan_id desc, status = 'aufgetaut' desc, auftauen_am, id
    loop
      exit when v_rest <= 0;
      update auftauen
      set status_vorher = status, status = 'verbraucht', bewegung_id = v_neu[1], geaendert_am = now()
      where id = v_a.id;
      v_rest := v_rest - v_a.menge;
    end loop;
  end loop;

  return v_ids;
end;
$$;

-- Kochen: alle Zutaten auf einmal entnehmen – oder keine. Optional die geplante Mahlzeit abhaken.
create function kochen(p_posten jsonb, p_plan_id uuid default null)
returns bigint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids bigint[];
begin
  if p_posten is null or jsonb_typeof(p_posten) <> 'array' or jsonb_array_length(p_posten) = 0 then
    raise exception 'Nichts zu entnehmen.';
  end if;
  v_ids := entnehme_posten(p_posten, p_plan_id);
  if p_plan_id is not null then
    update plan set status = 'erledigt', erledigt_am = now() where id = p_plan_id and status = 'geplant';
    if not found then
      raise exception 'Diese Mahlzeit ist schon gekocht oder nicht mehr geplant. Es wurde nichts entnommen.';
    end if;
  end if;
  return v_ids;
end;
$$;

-- Herstellen: Zutaten entnehmen (falls aus dem Vorrat) und die fertige Komponente einbuchen – ein Schritt.
create function herstellen(p_posten jsonb, p_block_typ_id bigint, p_menge integer,
                           p_ablauf_am date default null, p_plan_id uuid default null)
returns bigint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids bigint[] := '{}';
begin
  if p_posten is not null and jsonb_array_length(p_posten) > 0 then
    v_ids := entnehme_posten(p_posten, p_plan_id);
  end if;
  v_ids := v_ids || einfrieren(p_block_typ_id, p_menge, p_ablauf_am);
  if p_plan_id is not null then
    update plan set status = 'erledigt', erledigt_am = now() where id = p_plan_id and status = 'geplant';
    if not found then
      raise exception 'Diese Komponente ist schon hergestellt oder nicht mehr vorgemerkt. Es wurde nichts gebucht.';
    end if;
  end if;
  return v_ids;
end;
$$;

-- Rückgängig für kochen()/herstellen(): Bestand zurück, Plan wieder offen, Auftau-Status zurück.
create function kochen_rueckgaengig(p_bewegung_ids bigint[], p_plan_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform rueckgaengig(p_bewegung_ids);
  update auftauen
  set status = coalesce(status_vorher, 'aufgetaut'), status_vorher = null, bewegung_id = null, geaendert_am = now()
  where bewegung_id = any(p_bewegung_ids);
  if p_plan_id is not null then
    update plan set status = 'geplant', erledigt_am = null where id = p_plan_id;
  end if;
end;
$$;

-- Einkauf in den Vorrat: tatsächlich gekaufte Menge einbuchen. Nur für abgehakte Zeilen und nur
-- einmal: Die Zeile wird gesperrt und danach entfernt – ein zweiter Aufruf bucht nichts mehr.
create function einkauf_buchen(p_schluessel text, p_einheit text, p_block_typ_id bigint, p_menge integer,
                               p_ablauf_am date default null, p_preis_cent integer default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_ids       bigint[];
  v_eintraege bigint[];
  v_alt       record;
  v_id        bigint;
begin
  if p_menge is null or p_menge < 1 then
    raise exception 'Menge muss mindestens 1 sein.';
  end if;
  if p_preis_cent is not null and p_preis_cent < 0 then
    raise exception 'Preis darf nicht negativ sein.';
  end if;

  select status into v_status from einkauf_status
  where schluessel = p_schluessel and einheit = p_einheit
  for update;
  if v_status is distinct from 'gekauft' then
    raise exception 'Das ist schon im Vorrat oder nicht als gekauft markiert. Es wurde nichts gebucht.';
  end if;

  select kosten_cent, kosten_menge into v_alt from block_typ where id = p_block_typ_id;
  v_ids := einfrieren(p_block_typ_id, p_menge, p_ablauf_am);

  select coalesce(array_agg(id), '{}') into v_eintraege from einkauf_eintrag
  where schluessel = p_schluessel and coalesce(einheit, 'offen') = p_einheit and status = 'offen';
  update einkauf_eintrag set status = 'erledigt', erledigt_am = now() where id = any(v_eintraege);

  -- Bezahlter Preis wird zum neuen Preis der Sorte („X € für die gekaufte Menge“)
  if p_preis_cent is not null then
    update block_typ set kosten_cent = p_preis_cent, kosten_menge = p_menge where id = p_block_typ_id;
  end if;

  delete from einkauf_status where schluessel = p_schluessel and einheit = p_einheit;

  insert into einkauf_buchung (schluessel, einheit, block_typ_id, menge, preis_cent, bewegung_ids, eintrag_ids,
                               alter_kosten_cent, alter_kosten_menge)
  values (p_schluessel, p_einheit, p_block_typ_id, p_menge, p_preis_cent, v_ids, v_eintraege,
          v_alt.kosten_cent, v_alt.kosten_menge)
  returning id into v_id;
  return v_id;
end;
$$;

create function einkauf_rueckgaengig(p_buchung_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b record;
begin
  select * into v_b from einkauf_buchung where id = p_buchung_id for update;
  if not found then
    raise exception 'Buchung nicht gefunden – nichts wurde geändert.';
  end if;
  if v_b.rueckgaengig then
    raise exception 'Das wurde schon rückgängig gemacht.';
  end if;

  perform rueckgaengig(v_b.bewegung_ids);
  update einkauf_eintrag set status = 'offen', erledigt_am = null where id = any(v_b.eintrag_ids);
  if v_b.preis_cent is not null then
    update block_typ set kosten_cent = v_b.alter_kosten_cent, kosten_menge = coalesce(v_b.alter_kosten_menge, 1)
    where id = v_b.block_typ_id;
  end if;
  insert into einkauf_status (schluessel, einheit, status) values (v_b.schluessel, v_b.einheit, 'gekauft')
  on conflict (schluessel, einheit) do update set status = 'gekauft', geaendert_am = now();
  update einkauf_buchung set rueckgaengig = true where id = p_buchung_id;
end;
$$;

-- ───────────── Rechte ─────────────
-- Wie bisher: App ohne Login (anon), später mit Login (authenticated).

alter table plan            enable row level security;
alter table einkauf_eintrag enable row level security;
alter table einkauf_status  enable row level security;
alter table einkauf_buchung enable row level security;
alter table auftauen        enable row level security;

revoke all on plan, einkauf_eintrag, einkauf_status, einkauf_buchung, auftauen, nutzung
  from public, anon, authenticated;

-- Pläne: anlegen, ändern (Datum, Tausch), entfernen.
grant select, insert, update, delete on plan to anon, authenticated;
-- Einträge: anlegen, Menge/Status ändern – nicht löschen (Status „geloescht“).
grant select, insert, update on einkauf_eintrag to anon, authenticated;
grant select, insert, update, delete on einkauf_status to anon, authenticated;
-- Buchungsverlauf schreibt nur einkauf_buchen().
grant select on einkauf_buchung to anon, authenticated;
grant select, insert, update on auftauen to anon, authenticated;
grant select on nutzung to anon, authenticated;

create policy "App liest Pläne"          on plan            for select to anon, authenticated using (true);
create policy "App legt Pläne an"        on plan            for insert to anon, authenticated with check (true);
create policy "App ändert Pläne"         on plan            for update to anon, authenticated using (true) with check (true);
create policy "App entfernt Pläne"       on plan            for delete to anon, authenticated using (true);
create policy "App liest Einkauf"        on einkauf_eintrag for select to anon, authenticated using (true);
create policy "App legt Einkauf an"      on einkauf_eintrag for insert to anon, authenticated with check (true);
create policy "App ändert Einkauf"       on einkauf_eintrag for update to anon, authenticated using (true) with check (true);
create policy "App liest Einkaufsstatus" on einkauf_status  for select to anon, authenticated using (true);
create policy "App setzt Einkaufsstatus" on einkauf_status  for insert to anon, authenticated with check (true);
create policy "App ändert Einkaufsstatus" on einkauf_status for update to anon, authenticated using (true) with check (true);
create policy "App löscht Einkaufsstatus" on einkauf_status for delete to anon, authenticated using (true);
create policy "App liest Einkaufsverlauf" on einkauf_buchung for select to anon, authenticated using (true);
create policy "App liest Auftauen"       on auftauen        for select to anon, authenticated using (true);
create policy "App plant Auftauen"       on auftauen        for insert to anon, authenticated with check (true);
create policy "App ändert Auftauen"      on auftauen        for update to anon, authenticated using (true) with check (true);

revoke execute on function entnehme_posten(jsonb, uuid),
  kochen(jsonb, uuid), herstellen(jsonb, bigint, integer, date, uuid), kochen_rueckgaengig(bigint[], uuid),
  einkauf_buchen(text, text, bigint, integer, date, integer), einkauf_rueckgaengig(bigint)
  from public, anon, authenticated;

grant execute on function
  kochen(jsonb, uuid), herstellen(jsonb, bigint, integer, date, uuid), kochen_rueckgaengig(bigint[], uuid),
  einkauf_buchen(text, text, bigint, integer, date, integer), einkauf_rueckgaengig(bigint)
  to anon, authenticated;

notify pgrst, 'reload schema';
