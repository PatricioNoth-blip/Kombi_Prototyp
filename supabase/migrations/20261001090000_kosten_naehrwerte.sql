-- Kombi: echte Kosten je Charge, Protokoll für Kochen und Produktion, Nährwerte
--
-- Voraussetzung: Migration „planung_einkauf“.
--
-- Grundsätze:
--   • Kosten entstehen genau einmal: beim Einkauf (bezahlter Preis) oder bei der Produktion
--     (Wert der verbrauchten Zutaten). Jede Charge merkt sich ihre Kosten.
--   • Beim Kochen zählt der Wert genau der Chargen, die entnommen wurden (geöffnet → Ablauf → FIFO).
--     Beispiel: Tomaten-Basis, 1,44 € für 6 Portionen → 2 Portionen gegessen = 0,48 €.
--     Die Tomaten von damals werden nicht noch einmal gezählt.
--   • Ist ein Wert nicht bekannt, wird nichts geschätzt: Gespeichert wird die Summe der bekannten
--     Werte und wie viele Posten unbekannt sind.
--   • Nährwerte sind optional und werden wie der Preis angegeben: „X kcal für N Einheiten“
--     (z. B. 359 kcal für 100 g). NULL heißt unbekannt – nicht 0.
--   • Bestände ändern sich weiterhin nur über einfrieren(), entnehmen() und rueckgaengig().

-- ───────────── Nährwerte je Sorte ─────────────
alter table block_typ
  add column kcal            numeric(8, 1) check (kcal >= 0),
  add column protein_g       numeric(7, 1) check (protein_g >= 0),
  add column kohlenhydrate_g numeric(7, 1) check (kohlenhydrate_g >= 0),
  add column fett_g          numeric(7, 1) check (fett_g >= 0),
  -- worauf sich die Nährwerte beziehen (in der Einheit der Sorte); NULL = 100 g/ml bzw. 1 Portion/Stück
  add column naehrwert_menge integer check (naehrwert_menge > 0);

-- ───────────── Kosten je Charge ─────────────
-- Was diese Charge insgesamt gekostet hat (für menge_start). NULL = unbekannt → es gilt der Sortenpreis.
alter table charge add column kosten_cent integer check (kosten_cent >= 0);

-- Einkäufe ohne Einkaufsliste (direkt eingebucht mit Preis)
alter table einkauf_buchung add column direkt boolean not null default false;

-- ───────────── Protokoll ─────────────
-- Was gekocht wurde – mit dem Wert und den Kalorien der TATSÄCHLICH entnommenen Mengen.
create table mahlzeit (
  id               bigint generated always as identity primary key,
  datum            date not null default heute(),
  titel            text not null check (length(titel) between 1 and 200),
  portionen        integer not null check (portionen between 1 and 24),
  plan_id          uuid references plan(id) on delete set null,
  bewegung_ids     bigint[] not null,
  kosten_cent      integer,                          -- Summe der bekannten Werte; NULL = keiner bekannt
  kosten_unbekannt integer not null default 0,       -- Sorten ohne Preis
  kcal             integer,                          -- Summe der bekannten kcal; NULL = keine bekannt
  kcal_unbekannt   integer not null default 0,       -- Sorten ohne Nährwerte
  rueckgaengig     boolean not null default false,
  erstellt_am      timestamptz not null default now()
);

-- Was hergestellt wurde – mit der tatsächlichen Menge und den tatsächlichen Kosten.
create table herstellung (
  id                 bigint generated always as identity primary key,
  datum              date not null default heute(),
  block_typ_id       bigint not null references block_typ(id),
  menge              integer not null check (menge > 0),
  plan_id            uuid references plan(id) on delete set null,
  charge_id          bigint references charge(id),
  bewegung_ids       bigint[] not null,
  kosten_cent        integer,                        -- Wert der verarbeiteten Zutaten (bekannte)
  kosten_unbekannt   integer not null default 0,     -- Zutaten ohne Preis oder nicht im Vorrat erfasst
  charge_kosten_cent integer,                        -- Kosten der neuen Charge; nur wenn vollständig bekannt
  alter_kosten_cent  integer,
  alter_kosten_menge integer,
  preis_gelernt      boolean not null default false,
  rueckgaengig       boolean not null default false,
  erstellt_am        timestamptz not null default now()
);

create index mahlzeit_datum_idx on mahlzeit (datum);
create index herstellung_datum_idx on herstellung (datum);

-- ───────────── Übersicht ─────────────
-- Neu hinten angehängt: Nährwerte.
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
       t.naehrwert_menge
from block_typ t
left join charge c on c.block_typ_id = t.id
group by t.id;

-- ───────────── Wert einer Entnahme ─────────────
-- Intern: Wert und kcal der Verbrauchs-Bewegungen – aus den Kosten der entnommenen Charge,
-- sonst aus dem Sortenpreis. Unbekanntes wird je Sorte gezählt, nie geschätzt.
create function wert_der_entnahme(p_bewegung_ids bigint[])
returns table (kosten_cent integer, kosten_unbekannt integer, kcal integer, kcal_unbekannt integer)
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select t.id as sorte,
           -b.menge::numeric as menge,
           c.menge_start,
           c.kosten_cent as charge_kosten,
           t.kosten_cent as sorte_kosten,
           greatest(t.kosten_menge, 1) as kosten_menge,
           t.kcal,
           coalesce(t.naehrwert_menge, case when t.einheit in ('g', 'ml') then 100 else 1 end) as nw_menge
    from bewegung b
    join charge c on c.id = b.charge_id
    join block_typ t on t.id = c.block_typ_id
    where b.id = any(p_bewegung_ids) and b.art = 'verbrauch'
  )
  select round(sum(case when charge_kosten is not null then menge * charge_kosten / menge_start
                        when sorte_kosten is not null then menge * sorte_kosten / kosten_menge end))::integer,
         (count(distinct sorte) filter (where charge_kosten is null and sorte_kosten is null))::integer,
         round(sum(menge * kcal / nw_menge))::integer,
         (count(distinct sorte) filter (where kcal is null))::integer
  from e;
$$;

-- ───────────── Kochen mit Protokoll ─────────────
-- Wie kochen() (alles oder nichts, Plan abhaken, Auftauen verbraucht) – zusätzlich wird festgehalten,
-- was gekocht wurde, was es tatsächlich gekostet hat und wie viele kcal es hatte (soweit bekannt).
create function essen(p_posten jsonb, p_plan_id uuid, p_titel text, p_portionen integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids bigint[];
  v_w   record;
  v_id  bigint;
begin
  if p_titel is null or length(trim(p_titel)) = 0 then
    raise exception 'Name des Gerichts fehlt. Es wurde nichts entnommen.';
  end if;
  v_ids := kochen(p_posten, p_plan_id);
  select * into v_w from wert_der_entnahme(v_ids);
  insert into mahlzeit (titel, portionen, plan_id, bewegung_ids, kosten_cent, kosten_unbekannt, kcal, kcal_unbekannt)
  values (left(trim(p_titel), 200), greatest(1, least(24, coalesce(p_portionen, 1))), p_plan_id, v_ids,
          v_w.kosten_cent, v_w.kosten_unbekannt, v_w.kcal, v_w.kcal_unbekannt)
  returning id into v_id;
  return jsonb_build_object(
    'mahlzeit_id', v_id, 'bewegung_ids', to_jsonb(v_ids),
    'kosten_cent', v_w.kosten_cent, 'kosten_unbekannt', v_w.kosten_unbekannt,
    'kcal', v_w.kcal, 'kcal_unbekannt', v_w.kcal_unbekannt);
end;
$$;

create function essen_rueckgaengig(p_mahlzeit_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m record;
begin
  select * into v_m from mahlzeit where id = p_mahlzeit_id for update;
  if not found then
    raise exception 'Mahlzeit nicht gefunden – nichts wurde geändert.';
  end if;
  if v_m.rueckgaengig then
    raise exception 'Das wurde schon rückgängig gemacht.';
  end if;
  perform kochen_rueckgaengig(v_m.bewegung_ids, v_m.plan_id);
  update mahlzeit set rueckgaengig = true where id = p_mahlzeit_id;
end;
$$;

-- ───────────── Produktion mit echten Kosten ─────────────
-- Wie herstellen(): Zutaten raus, Produkt rein – mit der TATSÄCHLICH hergestellten Menge.
-- Die neue Charge bekommt die Kosten der verbrauchten Zutaten, aber nur, wenn alle bekannt sind
-- (p_nicht_erfasst = Zutaten, die nicht im Vorrat geführt werden und deshalb keinen Preis haben).
-- Dann wird das auch der neue Preis der Sorte („1,44 € für 6 Portionen“).
create function produzieren(p_posten jsonb, p_block_typ_id bigint, p_menge integer,
                            p_ablauf_am date default null, p_plan_id uuid default null,
                            p_nicht_erfasst integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alt    record;
  v_ids    bigint[];
  v_w      record;
  v_charge bigint;
  v_kosten integer;
  v_id     bigint;
begin
  select kosten_cent, kosten_menge into v_alt from block_typ where id = p_block_typ_id;
  if not found then
    raise exception 'Diese Sorte gibt es nicht. Es wurde nichts gebucht.';
  end if;
  v_ids := herstellen(p_posten, p_block_typ_id, p_menge, p_ablauf_am, p_plan_id);
  select * into v_w from wert_der_entnahme(v_ids);
  select b.charge_id into v_charge
  from bewegung b join charge c on c.id = b.charge_id
  where b.id = any(v_ids) and b.art = 'kochtag' and c.block_typ_id = p_block_typ_id
  order by b.id desc limit 1;

  v_kosten := case
    when p_posten is not null and jsonb_array_length(p_posten) > 0
         and v_w.kosten_unbekannt = 0 and coalesce(p_nicht_erfasst, 0) = 0
      then v_w.kosten_cent
  end;
  if v_kosten is not null then
    update charge set kosten_cent = v_kosten where id = v_charge;
    update block_typ set kosten_cent = v_kosten, kosten_menge = p_menge where id = p_block_typ_id;
  end if;

  insert into herstellung (block_typ_id, menge, plan_id, charge_id, bewegung_ids, kosten_cent, kosten_unbekannt,
                           charge_kosten_cent, alter_kosten_cent, alter_kosten_menge, preis_gelernt)
  values (p_block_typ_id, p_menge, p_plan_id, v_charge, v_ids, v_w.kosten_cent,
          v_w.kosten_unbekannt + greatest(coalesce(p_nicht_erfasst, 0), 0),
          v_kosten, v_alt.kosten_cent, v_alt.kosten_menge, v_kosten is not null)
  returning id into v_id;
  return jsonb_build_object(
    'herstellung_id', v_id, 'bewegung_ids', to_jsonb(v_ids),
    'kosten_cent', v_kosten, 'kosten_bekannt_cent', v_w.kosten_cent,
    'kosten_unbekannt', v_w.kosten_unbekannt + greatest(coalesce(p_nicht_erfasst, 0), 0));
end;
$$;

create function produzieren_rueckgaengig(p_herstellung_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h record;
begin
  select * into v_h from herstellung where id = p_herstellung_id for update;
  if not found then
    raise exception 'Herstellung nicht gefunden – nichts wurde geändert.';
  end if;
  if v_h.rueckgaengig then
    raise exception 'Das wurde schon rückgängig gemacht.';
  end if;
  perform kochen_rueckgaengig(v_h.bewegung_ids, v_h.plan_id);
  if v_h.preis_gelernt then
    update block_typ set kosten_cent = v_h.alter_kosten_cent, kosten_menge = coalesce(v_h.alter_kosten_menge, 1)
    where id = v_h.block_typ_id;
  end if;
  update herstellung set rueckgaengig = true where id = p_herstellung_id;
end;
$$;

-- ───────────── Einkauf mit bezahltem Preis ─────────────
-- Wie bisher – zusätzlich bekommt die neue Charge ihren bezahlten Preis.
create or replace function einkauf_buchen(p_schluessel text, p_einheit text, p_block_typ_id bigint, p_menge integer,
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
  if p_preis_cent is not null then
    update charge set kosten_cent = p_preis_cent where id = (select charge_id from bewegung where id = v_ids[1]);
  end if;

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

-- Direkt eingebucht (ohne Einkaufsliste), mit bezahltem Preis: zählt als Einkaufsausgabe.
create function einkaufen(p_block_typ_id bigint, p_menge integer, p_ablauf_am date, p_preis_cent integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t   record;
  v_ids bigint[];
  v_id  bigint;
begin
  if p_preis_cent is null or p_preis_cent < 0 then
    raise exception 'Bitte einen gültigen Preis angeben – ohne Preis einfach normal einbuchen.';
  end if;
  select name, einheit, kosten_cent, kosten_menge into v_t from block_typ where id = p_block_typ_id;
  if not found then
    raise exception 'Diese Sorte gibt es nicht. Es wurde nichts gebucht.';
  end if;
  v_ids := einfrieren(p_block_typ_id, p_menge, p_ablauf_am);   -- prüft die Menge
  update charge set kosten_cent = p_preis_cent where id = (select charge_id from bewegung where id = v_ids[1]);
  update block_typ set kosten_cent = p_preis_cent, kosten_menge = p_menge where id = p_block_typ_id;
  insert into einkauf_buchung (schluessel, einheit, block_typ_id, menge, preis_cent, bewegung_ids,
                               alter_kosten_cent, alter_kosten_menge, direkt)
  values (lower(v_t.name), v_t.einheit, p_block_typ_id, p_menge, p_preis_cent, v_ids, v_t.kosten_cent, v_t.kosten_menge, true)
  returning id into v_id;
  return v_id;
end;
$$;

-- Rückgängig: direkte Einkäufe kommen nicht auf die Einkaufsliste zurück.
create or replace function einkauf_rueckgaengig(p_buchung_id bigint)
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
  if not v_b.direkt then
    insert into einkauf_status (schluessel, einheit, status) values (v_b.schluessel, v_b.einheit, 'gekauft')
    on conflict (schluessel, einheit) do update set status = 'gekauft', geaendert_am = now();
  end if;
  update einkauf_buchung set rueckgaengig = true where id = p_buchung_id;
end;
$$;

-- ───────────── Rechte ─────────────
alter table mahlzeit    enable row level security;
alter table herstellung enable row level security;
revoke all on mahlzeit, herstellung from public, anon, authenticated;
-- Protokolle schreiben nur essen() und produzieren()
grant select on mahlzeit, herstellung to anon, authenticated;
create policy "App liest Mahlzeiten"    on mahlzeit    for select to anon, authenticated using (true);
create policy "App liest Herstellungen" on herstellung for select to anon, authenticated using (true);

revoke execute on function wert_der_entnahme(bigint[]),
  essen(jsonb, uuid, text, integer), essen_rueckgaengig(bigint),
  produzieren(jsonb, bigint, integer, date, uuid, integer), produzieren_rueckgaengig(bigint),
  einkaufen(bigint, integer, date, integer)
  from public, anon, authenticated;
grant execute on function
  essen(jsonb, uuid, text, integer), essen_rueckgaengig(bigint),
  produzieren(jsonb, bigint, integer, date, uuid, integer), produzieren_rueckgaengig(bigint),
  einkaufen(bigint, integer, date, integer)
  to anon, authenticated;

-- create or replace behält die Rechte; zur Sicherheit noch einmal ausdrücklich
revoke execute on function einkauf_buchen(text, text, bigint, integer, date, integer), einkauf_rueckgaengig(bigint)
  from public;
grant execute on function einkauf_buchen(text, text, bigint, integer, date, integer), einkauf_rueckgaengig(bigint)
  to anon, authenticated;

notify pgrst, 'reload schema';
