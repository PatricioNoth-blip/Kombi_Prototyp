-- Kombi – Gefrier-Inventar v0.1
--
-- Grundregel: Bestände (charge.menge_aktuell) ändern sich nur über die Funktionen
-- einfrieren(), entnehmen() und rueckgaengig(). Jede Änderung erzeugt eine Zeile in
-- bewegung. Ein Constraint-Trigger prüft am Ende jeder Transaktion, dass
-- charge.menge_aktuell der Summe ihrer Bewegungen entspricht – auch bei Änderungen
-- von Hand im Supabase-Dashboard.

-- ───────────────────────────── Tabellen ─────────────────────────────

create table block_typ (
  id             bigint generated always as identity primary key,
  name           text not null unique check (name = btrim(name) and name <> ''),
  farbe          text not null check (farbe in
                 ('rot','braun','gruen','gelb','weiss','schwarz','blau')),
  groesse_g      integer not null default 100 check (groesse_g > 0),
  mindestbestand integer not null default 0 check (mindestbestand >= 0),
  haltbar_tage   integer not null default 90 check (haltbar_tage > 0),
  kosten_cent    integer check (kosten_cent >= 0)
);

create table charge (
  id             bigint generated always as identity primary key,
  block_typ_id   bigint not null references block_typ(id),
  menge_start    integer not null check (menge_start > 0),
  menge_aktuell  integer not null check (menge_aktuell >= 0),
  eingefroren_am date not null
);

create index charge_fifo_idx on charge (block_typ_id, eingefroren_am, id);

create table bewegung (
  id          bigint generated always as identity primary key,
  charge_id   bigint not null references charge(id),
  menge       integer not null check (menge <> 0),   -- + Zugang, − Entnahme
  art         text not null check (art in ('kochtag','verbrauch','korrektur')),
  datum       date not null,
  erstellt_am timestamptz not null default now(),
  -- Bei „Rückgängig“: die Bewegung, die hiermit aufgehoben wird (jede höchstens einmal).
  storno_von  bigint unique references bewegung(id),
  check (storno_von is null or art = 'korrektur')
);

create index bewegung_charge_idx on bewegung (charge_id);

-- ───────────────────────────── Hilfsfunktion ─────────────────────────────

-- „Heute“ nach deutscher Zeit. Die Datenbank läuft in UTC – ohne das wäre
-- nachts um halb eins noch „gestern“.
create function heute() returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Berlin')::date $$;

-- ───────────────────────────── Übersicht ─────────────────────────────

create view bestand with (security_invoker = true) as
select t.id,
       t.name,
       t.farbe,
       coalesce(sum(c.menge_aktuell), 0)::integer                  as anzahl,
       t.mindestbestand,
       coalesce(sum(c.menge_aktuell), 0) < t.mindestbestand        as nachkochen,
       min(c.eingefroren_am) filter (where c.menge_aktuell > 0)     as aelteste,
       -- älteste noch volle Charge ist älter als (haltbar_tage − 14) Tage
       coalesce(heute() - min(c.eingefroren_am) filter (where c.menge_aktuell > 0)
                > t.haltbar_tage - 14, false)                       as bald_ablaufen,
       t.haltbar_tage,
       t.groesse_g,
       t.kosten_cent
from block_typ t
left join charge c on c.block_typ_id = t.id
group by t.id;

-- ───────────────────────────── Wächter ─────────────────────────────

-- charge.menge_aktuell muss immer der Summe ihrer Bewegungen entsprechen.
-- Läuft verzögert am Transaktionsende, damit Charge und Bewegung gemeinsam
-- entstehen können.
create function pruefe_charge_bewegungen() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ids    bigint[];
  v_charge record;
begin
  if tg_table_name = 'charge' then
    v_ids := array[new.id];
  elsif tg_op = 'INSERT' then
    v_ids := array[new.charge_id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.charge_id];
  else
    v_ids := array[old.charge_id, new.charge_id];
  end if;

  for v_charge in
    select c.id, c.menge_aktuell,
           coalesce((select sum(b.menge) from bewegung b where b.charge_id = c.id), 0) as summe
    from charge c
    where c.id = any(v_ids)
  loop
    if v_charge.menge_aktuell <> v_charge.summe then
      raise exception 'Charge %: Bestand % passt nicht zur Summe der Bewegungen (%). Bestände nur über einfrieren(), entnehmen() oder rueckgaengig() ändern.',
        v_charge.id, v_charge.menge_aktuell, v_charge.summe
        using errcode = 'check_violation';
    end if;
  end loop;

  return null;
end;
$$;

create constraint trigger charge_bewegungen_pruefen
  after insert or update of menge_aktuell on charge
  deferrable initially deferred
  for each row execute function pruefe_charge_bewegungen();

create constraint trigger bewegung_pruefen
  after insert or update or delete on bewegung
  deferrable initially deferred
  for each row execute function pruefe_charge_bewegungen();

-- ───────────────────────────── Buchungen ─────────────────────────────
-- Alle drei Funktionen sperren zuerst die betroffene Sorte. Dadurch laufen
-- gleichzeitige Buchungen derselben Sorte (z. B. beide drücken „−1“) sauber
-- nacheinander. Rückgabe: IDs der erzeugten Bewegungen (für „Rückgängig“).

-- Einfrieren: neue Charge mit heutigem Datum.
create function einfrieren(p_block_typ_id bigint, p_anzahl integer)
returns bigint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge_id   bigint;
  v_bewegung_id bigint;
begin
  if p_anzahl is null or p_anzahl < 1 then
    raise exception 'Anzahl muss mindestens 1 sein.';
  end if;

  perform 1 from block_typ where id = p_block_typ_id for no key update;
  if not found then
    raise exception 'Diese Sorte gibt es nicht.';
  end if;

  insert into charge (block_typ_id, menge_start, menge_aktuell, eingefroren_am)
  values (p_block_typ_id, p_anzahl, p_anzahl, heute())
  returning id into v_charge_id;

  insert into bewegung (charge_id, menge, art, datum)
  values (v_charge_id, p_anzahl, 'kochtag', heute())
  returning id into v_bewegung_id;

  return array[v_bewegung_id];
end;
$$;

-- Entnehmen: FIFO – erst die älteste Charge leeren, dann die nächste.
-- Reicht der Gesamtbestand nicht, wird nichts entnommen.
create function entnehmen(p_block_typ_id bigint, p_anzahl integer)
returns bigint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text;
  v_bestand integer;
  v_rest    integer := p_anzahl;
  v_nimm    integer;
  v_charge  record;
  v_id      bigint;
  v_ids     bigint[] := '{}';
begin
  if p_anzahl is null or p_anzahl < 1 then
    raise exception 'Anzahl muss mindestens 1 sein.';
  end if;

  select name into v_name from block_typ where id = p_block_typ_id for no key update;
  if not found then
    raise exception 'Diese Sorte gibt es nicht.';
  end if;

  select coalesce(sum(menge_aktuell), 0) into v_bestand
  from charge where block_typ_id = p_block_typ_id;

  if v_bestand = 0 then
    raise exception 'Von % ist nichts mehr da. Es wurde nichts entnommen.', v_name;
  elsif v_bestand < p_anzahl then
    raise exception 'Nur noch %× % da – %× angefragt. Es wurde nichts entnommen.',
      v_bestand, v_name, p_anzahl;
  end if;

  for v_charge in
    select id, menge_aktuell
    from charge
    where block_typ_id = p_block_typ_id and menge_aktuell > 0
    order by eingefroren_am, id
  loop
    exit when v_rest = 0;
    v_nimm := least(v_rest, v_charge.menge_aktuell);

    update charge set menge_aktuell = menge_aktuell - v_nimm where id = v_charge.id;

    insert into bewegung (charge_id, menge, art, datum)
    values (v_charge.id, -v_nimm, 'verbrauch', heute())
    returning id into v_id;

    v_ids := v_ids || v_id;
    v_rest := v_rest - v_nimm;
  end loop;

  -- Sicherheitsnetz: bricht die ganze Buchung ab, statt nur teilweise zu entnehmen.
  if v_rest > 0 then
    raise exception 'Bestand von % hat sich geändert. Es wurde nichts entnommen – bitte neu laden.', v_name;
  end if;

  return v_ids;
end;
$$;

-- Rückgängig: hebt Einfrieren/Entnehmen durch Gegenbuchungen (art = 'korrektur')
-- auf derselben Charge auf. Jede Bewegung lässt sich nur einmal aufheben.
create function rueckgaengig(p_bewegung_ids bigint[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b      record;
  v_anzahl integer := 0;
begin
  if p_bewegung_ids is null or cardinality(p_bewegung_ids) = 0 then
    raise exception 'Nichts zum Rückgängigmachen angegeben.';
  end if;

  perform 1 from block_typ
  where id in (select c.block_typ_id
               from bewegung b join charge c on c.id = b.charge_id
               where b.id = any(p_bewegung_ids))
  order by id
  for no key update;

  for v_b in
    select id, charge_id, menge, art
    from bewegung
    where id = any(p_bewegung_ids)
    order by id
  loop
    v_anzahl := v_anzahl + 1;

    if v_b.art = 'korrektur' then
      raise exception 'Eine Korrektur kann nicht rückgängig gemacht werden.';
    end if;
    if exists (select 1 from bewegung where storno_von = v_b.id) then
      raise exception 'Das wurde schon rückgängig gemacht.';
    end if;

    update charge set menge_aktuell = menge_aktuell - v_b.menge
    where id = v_b.charge_id and menge_aktuell - v_b.menge >= 0;
    if not found then
      raise exception 'Aus dieser Charge wurde inzwischen schon entnommen – Rückgängig ist nicht mehr möglich.';
    end if;

    insert into bewegung (charge_id, menge, art, datum, storno_von)
    values (v_b.charge_id, -v_b.menge, 'korrektur', heute(), v_b.id);
  end loop;

  if v_anzahl <> cardinality(p_bewegung_ids) then
    raise exception 'Buchung nicht gefunden – nichts wurde geändert.';
  end if;
end;
$$;

-- ───────────────────────────── Zugriffsrechte ─────────────────────────────
-- Ohne Login (Rolle anon): kein Zugriff.
-- Mit dem WG-Login (Rolle authenticated): alles lesen, Sorten anlegen/bearbeiten,
-- Bestände nur über die Buchungsfunktionen ändern.

alter table block_typ enable row level security;
alter table charge    enable row level security;
alter table bewegung  enable row level security;

revoke all on block_typ, charge, bewegung, bestand from public, anon, authenticated;

grant select, insert, update on block_typ to authenticated;
grant select on charge, bewegung, bestand to authenticated;

create policy "WG liest Sorten"      on block_typ for select to authenticated using (true);
create policy "WG legt Sorten an"    on block_typ for insert to authenticated with check (true);
create policy "WG bearbeitet Sorten" on block_typ for update to authenticated using (true) with check (true);
create policy "WG liest Chargen"     on charge    for select to authenticated using (true);
create policy "WG liest Bewegungen"  on bewegung  for select to authenticated using (true);

revoke execute on function heute(), pruefe_charge_bewegungen(),
  einfrieren(bigint, integer), entnehmen(bigint, integer), rueckgaengig(bigint[])
  from public, anon, authenticated;

grant execute on function heute(), einfrieren(bigint, integer),
  entnehmen(bigint, integer), rueckgaengig(bigint[])
  to authenticated;

-- Supabase-API (PostgREST) soll die neuen Tabellen und Funktionen sofort kennen.
notify pgrst, 'reload schema';
