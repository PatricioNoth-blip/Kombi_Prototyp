-- Kombi: Baukasten – Lebensmittel sauber beschreiben
--
-- Zwei Ebenen pro Sorte:
--   A) physischer Bestand: wie viel ist da, in welcher Einheit, wie viel ist eine Portion,
--      was kostet es, wann läuft es ab, ist es geöffnet
--   B) optionale Bedeutung: was ist es (Zutat / Komponente / Komplettgericht), selbstgemacht
--      oder gekauft, woraus besteht es. Unbekannt bleibt unbekannt (null) – nichts wird erfunden.
--
-- Die Buchungslogik bleibt: Bestände ändern sich nur über einfrieren(), entnehmen() und
-- rueckgaengig(). Neu ist nur die Reihenfolge beim Entnehmen:
--   zuerst geöffnete Chargen, dann die mit dem frühesten Ablauf, sonst wie bisher FIFO.
-- Alte App-Versionen laufen weiter: Alle neuen Spalten haben Standardwerte oder sind optional.

-- ───────────── Sorten: Art, Herkunft, Einheit, Portion, Preisbezug, Zusammensetzung ─────────────

alter table block_typ
  -- zutat: einzelnes Lebensmittel (Pasta, Reis, Dosentomaten …)
  -- komponente: vorbereiteter Baustein (Tomatensoße, gekochte Linsen …)
  -- komplettgericht: wird als Ganzes gegessen (Pizza, Lasagne-Portion, Suppe …)
  add column art text not null default 'komponente'
    check (art in ('zutat', 'komponente', 'komplettgericht')),
  -- null = unbekannt
  add column herkunft text
    check (herkunft in ('selbstgemacht', 'gekauft')),
  -- In welcher Einheit wird gezählt? Die Bestandszahl (charge.menge_*) ist immer eine ganze Zahl
  -- dieser Einheit: 4 Portionen, 6 Stück, 500 g, 750 ml.
  add column einheit text not null default 'portion'
    check (einheit in ('portion', 'stueck', 'g', 'ml')),
  -- Wie viele Einheiten sind eine Portion? (bei „portion“ immer 1, z. B. 125 bei 125 g Pasta)
  add column portion_menge integer not null default 1
    check (portion_menge > 0 and (einheit <> 'portion' or portion_menge = 1)),
  -- Auf wie viele Einheiten bezieht sich kosten_cent? (2,00 € für 4 Portionen → 200 / 4)
  add column kosten_menge integer not null default 1
    check (kosten_menge > 0),
  -- Bekannte Bestandteile. null = unbekannt, leere Liste ist nicht erlaubt.
  add column zusammensetzung text[]
    check (zusammensetzung is null or cardinality(zusammensetzung) between 1 and 30),
  -- Freitext: kurzes Rezept, Marke, Besonderheiten
  add column notiz text
    check (length(notiz) <= 500);

-- Bestehende Sorten einordnen (lässt sich in der App jederzeit ändern)
update block_typ set art = case
  when farbe = 'blau'                           then 'komplettgericht'
  when lagerort in ('vorrat', 'kuehlschrank')   then 'zutat'
  when name ilike 'TK-%'                        then 'zutat'
  else 'komponente'
end;

-- ───────────── Chargen: Ablaufdatum und „geöffnet“ ─────────────

alter table charge
  add column ablauf_am    date,   -- MHD/Verbrauchsdatum, falls bekannt
  add column geoeffnet_am date;   -- seit wann angebrochen, null = verschlossen

-- ───────────── Übersicht ─────────────
-- Neue Spalten hinten anhängen (create or replace erlaubt nur das).
-- bald_ablaufen gilt jetzt auch, wenn ein bekanntes Ablaufdatum in ≤ 3 Tagen erreicht ist.

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
                                                                    as abgelaufen
from block_typ t
left join charge c on c.block_typ_id = t.id
group by t.id;

-- ───────────── Buchungen ─────────────

-- Mengenangabe für Meldungen: „4×“ bzw. „300 g“ / „250 ml“
create function menge_text(p_menge integer, p_einheit text) returns text
language sql immutable
set search_path = ''
as $$
  select case p_einheit
           when 'g'  then p_menge || ' g'
           when 'ml' then p_menge || ' ml'
           else p_menge || '×'
         end
$$;

-- Einfrieren/Einbuchen: jetzt optional mit Ablaufdatum.
-- Alte Aufrufe mit zwei Argumenten funktionieren weiter (Standardwert null).
drop function einfrieren(bigint, integer);

create function einfrieren(p_block_typ_id bigint, p_anzahl integer, p_ablauf_am date default null)
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

  insert into charge (block_typ_id, menge_start, menge_aktuell, eingefroren_am, ablauf_am)
  values (p_block_typ_id, p_anzahl, p_anzahl, heute(), p_ablauf_am)
  returning id into v_charge_id;

  insert into bewegung (charge_id, menge, art, datum)
  values (v_charge_id, p_anzahl, 'kochtag', heute())
  returning id into v_bewegung_id;

  return array[v_bewegung_id];
end;
$$;

-- Entnehmen: Reihenfolge der Chargen
--   1. geöffnete zuerst
--   2. frühester Ablauf (bekanntes Ablaufdatum, sonst eingefroren_am + haltbar_tage)
--   3. FIFO: älteste zuerst, bei gleichem Datum die zuerst angelegte
-- Ohne Ablaufdaten und ohne geöffnete Chargen ist das genau das bisherige FIFO.
-- Reicht der Gesamtbestand nicht, wird nichts entnommen.
create or replace function entnehmen(p_block_typ_id bigint, p_anzahl integer)
returns bigint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text;
  v_einheit text;
  v_haltbar integer;
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

  select name, einheit, haltbar_tage into v_name, v_einheit, v_haltbar
  from block_typ where id = p_block_typ_id for no key update;
  if not found then
    raise exception 'Diese Sorte gibt es nicht.';
  end if;

  select coalesce(sum(menge_aktuell), 0) into v_bestand
  from charge where block_typ_id = p_block_typ_id;

  if v_bestand = 0 then
    raise exception 'Von % ist nichts mehr da. Es wurde nichts entnommen.', v_name;
  elsif v_bestand < p_anzahl then
    raise exception 'Nur noch % % da – % angefragt. Es wurde nichts entnommen.',
      menge_text(v_bestand, v_einheit), v_name, menge_text(p_anzahl, v_einheit);
  end if;

  for v_charge in
    select id, menge_aktuell
    from charge
    where block_typ_id = p_block_typ_id and menge_aktuell > 0
    order by geoeffnet_am is null,
             coalesce(ablauf_am, eingefroren_am + v_haltbar),
             eingefroren_am,
             id
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

-- Charge als geöffnet markieren (oder wieder als verschlossen). Ändert keine Menge.
create function setze_geoeffnet(p_charge_id bigint, p_geoeffnet boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_menge integer;
begin
  perform 1 from block_typ
  where id = (select block_typ_id from charge where id = p_charge_id)
  for no key update;

  select menge_aktuell into v_menge from charge where id = p_charge_id;
  if not found then
    raise exception 'Diese Charge gibt es nicht.';
  end if;
  if p_geoeffnet and v_menge = 0 then
    raise exception 'Diese Charge ist schon aufgebraucht.';
  end if;

  update charge
  set geoeffnet_am = case when p_geoeffnet then coalesce(geoeffnet_am, heute()) end
  where id = p_charge_id;
end;
$$;

-- Ablaufdatum einer Charge setzen oder entfernen (null). Ändert keine Menge.
create function setze_ablauf(p_charge_id bigint, p_ablauf_am date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from block_typ
  where id = (select block_typ_id from charge where id = p_charge_id)
  for no key update;

  update charge set ablauf_am = p_ablauf_am where id = p_charge_id;
  if not found then
    raise exception 'Diese Charge gibt es nicht.';
  end if;
end;
$$;

-- ───────────── Rezepte strukturiert speichern ─────────────
-- Alles optional, damit ältere App-Versionen weiter speichern können.
-- daten enthält weiterhin den vollständigen, geprüften Vorschlag.

alter table rezept
  add column gerichtstyp   text check (length(gerichtstyp) <= 40),
  add column portionen     integer check (portionen between 1 and 12),
  add column zutaten       jsonb,        -- [{name, menge, einheit, art, sorte_id|null}]
  add column schritte      text[] check (cardinality(schritte) <= 20),
  add column bestandsarten text[] check (cardinality(bestandsarten) <= 10),  -- z. B. {komplettgericht, komponente}
  add column tags          text[] check (cardinality(tags) <= 20),
  add column kosten_pro_portion_cent integer check (kosten_pro_portion_cent >= 0),
  add column kosten_status text check (kosten_status in ('berechnet', 'teilweise', 'unbekannt')),
  add column feedback      text[] check (cardinality(feedback) <= 10);  -- z. B. {like, cook}

-- ───────────── Rechte ─────────────

revoke execute on function menge_text(integer, text),
  einfrieren(bigint, integer, date),
  setze_geoeffnet(bigint, boolean),
  setze_ablauf(bigint, date)
  from public, anon, authenticated;

grant execute on function einfrieren(bigint, integer, date),
  setze_geoeffnet(bigint, boolean),
  setze_ablauf(bigint, date)
  to anon, authenticated;

notify pgrst, 'reload schema';
