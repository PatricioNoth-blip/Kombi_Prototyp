-- Kombi: Bon-Import und Produktion mit echten Chargenkosten
--
-- Voraussetzung: Migration „planung_einkauf“ (entnehme_posten, kochen_rueckgaengig, plan).
-- Architektur und Begründung: docs/bon_produktion.md
--
-- Grundsätze (wie bisher):
--   • Bestände ändern sich nur über einfrieren(), entnehmen() und rueckgaengig(). Die neuen
--     Funktionen bon_buchen() und produzieren() rufen genau diese auf – in EINER Transaktion.
--   • Ein Bon oder eine geplante Produktion ändert nichts am Bestand. Erst die ausdrückliche
--     Bestätigung (bon_buchen / produzieren) bucht.
--   • Kosten rechnet die Datenbank selbst aus Chargen und Bewegungen. Nichts wird geschätzt:
--     Unbekannt bleibt unbekannt, teilweise bekannt heißt „teilweise“.
--
-- Neu:
--   • charge: Kosten (kosten_cent für kosten_menge Einheiten), Status, Quelle, Lagerort je Charge
--   • bewegung_kosten: Wert jeder Bewegung aus ihrer Charge – dadurch sind Verbrauchskosten FIFO-genau
--   • bon_import / bon_position, bon_buchen(), bon_rueckgaengig(), View bon_gewohnheit
--   • produktion / produktion_eingang, produzieren(), produktion_rueckgaengig()

-- ───────────── Chargen: Kosten, Quelle, Lagerort ─────────────

alter table charge
  -- Wert von kosten_menge Einheiten dieser Charge in Cent – exakt, gerundet wird erst in der Anzeige.
  add column kosten_cent   numeric(14,4) check (kosten_cent >= 0),
  add column kosten_menge  integer check (kosten_menge > 0),
  -- berechnet: alles bekannt · teilweise: nur ein Teil der Eingänge hatte Preise · unbekannt
  add column kosten_status text not null default 'unbekannt'
    check (kosten_status in ('berechnet', 'teilweise', 'unbekannt')),
  -- woher der Preis stammt: Kassenbon, Produktion oder der hinterlegte Sortenpreis
  add column kosten_quelle text check (kosten_quelle in ('sortenpreis', 'bon', 'produktion')),
  -- wie die Charge entstanden ist; null = von Hand eingebucht / Kochtag
  add column quelle        text check (quelle in ('bon', 'e_bon', 'produktion')),
  -- Lagerort dieser Charge; null = Lagerort der Sorte
  add column lagerort      text check (lagerort in ('gefrierfach', 'kuehlschrank', 'vorrat')),
  add constraint charge_kosten_vollstaendig check (
    (kosten_cent is null) = (kosten_menge is null)
    and (kosten_status = 'unbekannt') = (kosten_cent is null)
  );

-- Neue Chargen ohne eigenen Preis übernehmen den hinterlegten Sortenpreis („X € für N Einheiten“).
-- So hat jede Charge ihren Preis vom Zeitpunkt des Einbuchens – spätere Preisänderungen der Sorte
-- verändern alte Chargen nicht mehr.
create function charge_kosten_vorbelegen() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kosten_cent is null and new.kosten_quelle is null then
    select t.kosten_cent, t.kosten_menge into new.kosten_cent, new.kosten_menge
    from block_typ t
    where t.id = new.block_typ_id and t.kosten_cent is not null;
    if new.kosten_cent is not null then
      new.kosten_menge  := coalesce(new.kosten_menge, 1);
      new.kosten_status := 'berechnet';
      new.kosten_quelle := 'sortenpreis';
    else
      new.kosten_menge  := null;
      new.kosten_status := 'unbekannt';
    end if;
  end if;
  return new;
end;
$$;

create trigger charge_kosten_vorbelegen
  before insert on charge
  for each row execute function charge_kosten_vorbelegen();

-- Vorhandene Chargen einmalig mit dem Sortenpreis vorbelegen (ändert keine Mengen).
update charge c
set kosten_cent   = t.kosten_cent,
    kosten_menge  = coalesce(t.kosten_menge, 1),
    kosten_status = 'berechnet',
    kosten_quelle = 'sortenpreis'
from block_typ t
where t.id = c.block_typ_id and t.kosten_cent is not null and c.kosten_quelle is null;

-- Wert jeder Bewegung aus ihrer Charge: |Menge| × kosten_cent / kosten_menge.
-- entnehmen() bucht FIFO je Charge – damit sind auch die Verbrauchskosten FIFO-genau.
create view bewegung_kosten with (security_invoker = true) as
select b.id                                                                   as bewegung_id,
       b.charge_id,
       c.block_typ_id,
       b.menge,
       b.art,
       b.datum,
       b.storno_von,
       case when c.kosten_cent is null then null
            else abs(b.menge) * c.kosten_cent / c.kosten_menge end            as wert_cent,
       c.kosten_status
from bewegung b
join charge c on c.id = b.charge_id;

-- ───────────── Bon-Import ─────────────
-- Eine Zeile je BESTÄTIGTEM Import. Entwürfe gibt es nur in der App – ein Abbruch kann deshalb
-- nie etwas verändern.

create table bon_import (
  id              uuid primary key default gen_random_uuid(),
  quelle          text not null check (quelle in ('kassenbon', 'e_bon', 'text')),
  quelle_ref      text check (length(quelle_ref) <= 300),         -- z. B. Dateinamen
  erkennung       text check (length(erkennung) <= 120),          -- z. B. „text“ oder „ki:gemini-2.5-flash“
  -- Händler + Datum + Summe + Positionen: erkennt denselben Bon ein zweites Mal
  fingerabdruck   text not null check (length(fingerabdruck) between 8 and 128),
  haendler        text check (length(haendler) <= 80),
  filiale         text check (length(filiale) <= 120),
  kaufdatum       date,
  summe_cent      integer,
  status          text not null default 'gebucht' check (status in ('gebucht', 'rueckgaengig')),
  -- Sortenpreise vor dem Import (für Rückgängig): [{block_typ_id, alt_cent, alt_menge, neu_cent, neu_menge}]
  alte_preise     jsonb not null default '[]',
  erstellt_am     timestamptz not null default now(),   -- = bestätigt am
  rueckgaengig_am timestamptz
);

create index bon_import_fingerabdruck_idx on bon_import (fingerabdruck) where status = 'gebucht';

create table bon_position (
  id                  bigint generated always as identity primary key,
  import_id           uuid not null references bon_import(id),
  nr                  integer not null check (nr between 1 and 500),
  bon_text            text not null check (length(bon_text) between 1 and 200),
  -- normalisierter Bon-Text (für Wiedererkennen und Lernen)
  schluessel          text not null check (length(schluessel) between 1 and 120),
  typ                 text not null
                      check (typ in ('lebensmittel', 'nicht_lebensmittel', 'pfand', 'rabatt', 'unbekannt')),
  anzahl              numeric(10,3) check (anzahl > 0),               -- Stück/Packungen laut Bon
  packung_menge       integer check (packung_menge > 0),              -- aus dem Namen, z. B. 500 bei „500G“
  packung_einheit     text check (packung_einheit in ('g', 'ml', 'stueck')),
  einzelpreis_cent    integer,
  gesamtpreis_cent    integer,
  rabatt_cent         integer not null default 0 check (rabatt_cent >= 0),
  endpreis_cent       integer,                                        -- tatsächlich bezahlt (gesamt − Rabatt)
  block_typ_id        bigint references block_typ(id),
  neu_angelegt        boolean not null default false,
  sicherheit          numeric(4,3) check (sicherheit between 0 and 1),
  entscheidung        text not null check (entscheidung in ('uebernehmen', 'teilweise', 'nicht')),
  menge_pro_einheit   numeric(12,3) check (menge_pro_einheit > 0),    -- 1 Stück laut Bon = x Einheiten der Sorte
  bestand_menge       integer not null default 0 check (bestand_menge >= 0),
  bestand_kosten_cent numeric(14,4) check (bestand_kosten_cent >= 0), -- Kosten der gebuchten Menge
  grund               text check (grund in ('direkt_gegessen', 'fuer_andere', 'anderweitig', 'sonstiges')),
  grund_text          text check (length(grund_text) <= 200),
  hinweis             text check (length(hinweis) <= 300),
  ablauf_am           date,
  lagerort            text check (lagerort in ('gefrierfach', 'kuehlschrank', 'vorrat')),
  bewegung_ids        bigint[] not null default '{}',
  charge_id           bigint references charge(id),
  unique (import_id, nr)
);

create index bon_position_schluessel_idx on bon_position (schluessel);

-- Bon bestätigen: legt neue Sorten an, bucht jede übernommene Position als eigene Einkaufscharge
-- mit dem tatsächlich bezahlten Preis ein und protokolliert alles – oder nichts.
--
-- p_bon: { quelle, quelle_ref, erkennung, fingerabdruck, haendler, filiale, kaufdatum, summe_cent,
--          positionen: [{ nr, bon_text, schluessel, typ, anzahl, packung_menge, packung_einheit,
--                         einzelpreis_cent, gesamtpreis_cent, rabatt_cent, block_typ_id | neu,
--                         sicherheit, menge_pro_einheit, bestand_menge, grund, grund_text, hinweis,
--                         ablauf_am, lagerort }] }
-- Kosten rechnet die Datenbank selbst: bezahlter Preis × Anteil der gebuchten an der gekauften Menge.
create function bon_buchen(p_bon jsonb, p_trotz_doppelt boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import_id   uuid;
  v_fp          text;
  v_doppelt     timestamptz;
  v_kaufdatum   date;
  v_p           jsonb;
  v_nr          integer;
  v_typ         text;
  v_sorte       bigint;
  v_neu         boolean;
  v_menge       integer;
  v_anzahl      numeric;
  v_mpe         numeric;
  v_gesamt      integer;
  v_rabatt      integer;
  v_end         integer;
  v_kosten      numeric;
  v_ids         bigint[];
  v_charge      bigint;
  v_alle_ids    bigint[] := '{}';
  v_preise      jsonb := '[]';
  v_alt         record;
  v_rest_preise jsonb;
  v_hinzu       integer := 0;
  v_nicht       integer := 0;
  v_neue        integer := 0;
begin
  if p_bon is null or jsonb_typeof(p_bon -> 'positionen') <> 'array' then
    raise exception 'Der Bon hat keine Positionen. Es wurde nichts gebucht.';
  end if;
  if jsonb_array_length(p_bon -> 'positionen') = 0 or jsonb_array_length(p_bon -> 'positionen') > 300 then
    raise exception 'Ein Bon braucht 1 bis 300 Positionen. Es wurde nichts gebucht.';
  end if;

  v_fp := nullif(btrim(p_bon ->> 'fingerabdruck'), '');
  if v_fp is null then
    raise exception 'Fingerabdruck des Bons fehlt. Es wurde nichts gebucht.';
  end if;

  -- Zwei gleichzeitige Bestätigungen desselben Bons laufen nacheinander.
  perform pg_advisory_xact_lock(hashtext('kombi-bon:' || v_fp));
  select erstellt_am into v_doppelt from bon_import
  where fingerabdruck = v_fp and status = 'gebucht'
  order by erstellt_am desc limit 1;
  if found and not coalesce(p_trotz_doppelt, false) then
    raise exception 'Dieser Bon wurde am % schon importiert. Es wurde nichts gebucht.',
      to_char(v_doppelt at time zone 'Europe/Berlin', 'DD.MM.YYYY')
      using hint = 'doppelt';
  end if;

  v_kaufdatum := nullif(p_bon ->> 'kaufdatum', '')::date;

  insert into bon_import (quelle, quelle_ref, erkennung, fingerabdruck, haendler, filiale, kaufdatum, summe_cent)
  values (coalesce(p_bon ->> 'quelle', 'text'),
          left(p_bon ->> 'quelle_ref', 300),
          left(p_bon ->> 'erkennung', 120),
          v_fp,
          left(nullif(btrim(p_bon ->> 'haendler'), ''), 80),
          left(nullif(btrim(p_bon ->> 'filiale'), ''), 120),
          v_kaufdatum,
          (p_bon ->> 'summe_cent')::integer)
  returning id into v_import_id;

  for v_p in select e from jsonb_array_elements(p_bon -> 'positionen') e
  loop
    v_nr     := (v_p ->> 'nr')::integer;
    v_typ    := coalesce(v_p ->> 'typ', 'unbekannt');
    v_menge  := coalesce((v_p ->> 'bestand_menge')::integer, 0);
    v_anzahl := coalesce((v_p ->> 'anzahl')::numeric, 1);
    v_mpe    := (v_p ->> 'menge_pro_einheit')::numeric;
    v_gesamt := (v_p ->> 'gesamtpreis_cent')::integer;
    v_rabatt := coalesce((v_p ->> 'rabatt_cent')::integer, 0);
    v_end    := case when v_gesamt is null then null else v_gesamt - v_rabatt end;
    v_sorte  := (v_p ->> 'block_typ_id')::bigint;
    v_neu    := false;
    v_ids    := '{}';
    v_charge := null;
    v_kosten := null;

    if v_menge < 0 then
      raise exception 'Position %: Menge darf nicht negativ sein. Es wurde nichts gebucht.', v_nr;
    end if;
    if v_anzahl <= 0 or v_mpe <= 0 then
      raise exception 'Position %: Anzahl und Menge pro Einheit müssen größer als 0 sein. Es wurde nichts gebucht.', v_nr;
    end if;
    if v_rabatt < 0 then
      raise exception 'Position %: Rabatt als positiven Betrag angeben. Es wurde nichts gebucht.', v_nr;
    end if;
    if v_rabatt > 0 and v_end is not null and v_end < 0 then
      raise exception 'Position %: Rabatt ist größer als der Preis. Es wurde nichts gebucht.', v_nr;
    end if;

    if v_menge > 0 then
      if v_typ not in ('lebensmittel', 'unbekannt') then
        raise exception 'Position % („%“) ist kein Lebensmittel und kommt nicht in den Bestand. Es wurde nichts gebucht.',
          v_nr, v_p ->> 'bon_text';
      end if;
      if v_mpe is null then
        raise exception 'Position % („%“): Es fehlt, wie viel eine Einheit laut Bon ist. Es wurde nichts gebucht.',
          v_nr, v_p ->> 'bon_text';
      end if;

      -- Neues Produkt: Sorte im selben Schritt anlegen (Name muss eindeutig sein).
      if v_sorte is null and jsonb_typeof(v_p -> 'neu') = 'object' then
        insert into block_typ (name, farbe, art, lagerort, einheit, portion_menge, groesse_g, haltbar_tage, herkunft)
        values (btrim(v_p -> 'neu' ->> 'name'),
                coalesce(v_p -> 'neu' ->> 'farbe', 'gruen'),
                coalesce(v_p -> 'neu' ->> 'art', 'zutat'),
                coalesce(v_p -> 'neu' ->> 'lagerort', 'vorrat'),
                coalesce(v_p -> 'neu' ->> 'einheit', 'stueck'),
                coalesce((v_p -> 'neu' ->> 'portion_menge')::integer, 1),
                coalesce((v_p -> 'neu' ->> 'groesse_g')::integer, 100),
                coalesce((v_p -> 'neu' ->> 'haltbar_tage')::integer, 90),
                'gekauft')
        returning id into v_sorte;
        v_neu := true;
        v_neue := v_neue + 1;
      end if;
      if v_sorte is null then
        raise exception 'Position % („%“): Kein Produkt zugeordnet. Es wurde nichts gebucht.', v_nr, v_p ->> 'bon_text';
      end if;
      if not exists (select 1 from block_typ where id = v_sorte) then
        raise exception 'Position %: Diese Sorte gibt es nicht. Es wurde nichts gebucht.', v_nr;
      end if;

      -- Tatsächlich bezahlter Preis × Anteil der gebuchten Menge (höchstens alles).
      if v_end is not null then
        v_kosten := v_end * least(1::numeric, v_menge / (v_anzahl * v_mpe));
      end if;

      v_ids := einfrieren(v_sorte, v_menge, nullif(v_p ->> 'ablauf_am', '')::date);
      select charge_id into v_charge from bewegung where id = v_ids[1];

      update charge
      set kosten_cent   = v_kosten,
          kosten_menge  = case when v_kosten is null then null else v_menge end,
          kosten_status = case when v_kosten is null then 'unbekannt' else 'berechnet' end,
          kosten_quelle = 'bon',
          quelle        = case when p_bon ->> 'quelle' = 'e_bon' then 'e_bon' else 'bon' end,
          lagerort      = nullif(v_p ->> 'lagerort', ''),
          eingefroren_am = case when v_kaufdatum between heute() - 60 and heute() then v_kaufdatum
                                else eingefroren_am end
      where id = v_charge;

      -- Bezahlter Preis wird zum Referenzpreis der Sorte (wie bei einkauf_buchen), alter Preis für Rückgängig.
      if v_kosten is not null then
        select kosten_cent, kosten_menge into v_alt from block_typ where id = v_sorte;
        if not exists (select 1 from jsonb_array_elements(v_preise) x where (x ->> 'block_typ_id')::bigint = v_sorte) then
          v_preise := v_preise || jsonb_build_object('block_typ_id', v_sorte,
                                                     'alt_cent', case when v_neu then null else v_alt.kosten_cent end,
                                                     'alt_menge', case when v_neu then null else v_alt.kosten_menge end);
        end if;
        update block_typ set kosten_cent = round(v_kosten)::integer, kosten_menge = v_menge where id = v_sorte;
        v_preise := (
          select jsonb_agg(case when (x ->> 'block_typ_id')::bigint = v_sorte
                                then x || jsonb_build_object('neu_cent', round(v_kosten)::integer, 'neu_menge', v_menge)
                                else x end)
          from jsonb_array_elements(v_preise) x);
      end if;

      v_alle_ids := v_alle_ids || v_ids;
      v_hinzu := v_hinzu + 1;
    elsif v_typ in ('lebensmittel', 'unbekannt') then
      v_nicht := v_nicht + 1;
    end if;

    insert into bon_position (
      import_id, nr, bon_text, schluessel, typ, anzahl, packung_menge, packung_einheit,
      einzelpreis_cent, gesamtpreis_cent, rabatt_cent, endpreis_cent, block_typ_id, neu_angelegt, sicherheit,
      entscheidung, menge_pro_einheit, bestand_menge, bestand_kosten_cent, grund, grund_text, hinweis,
      ablauf_am, lagerort, bewegung_ids, charge_id)
    values (
      v_import_id, v_nr, left(coalesce(nullif(btrim(v_p ->> 'bon_text'), ''), '?'), 200),
      left(coalesce(nullif(btrim(v_p ->> 'schluessel'), ''), '?'), 120), v_typ,
      (v_p ->> 'anzahl')::numeric, (v_p ->> 'packung_menge')::integer, v_p ->> 'packung_einheit',
      (v_p ->> 'einzelpreis_cent')::integer, v_gesamt, v_rabatt, v_end,
      coalesce(v_sorte, (v_p ->> 'block_typ_id')::bigint), v_neu, (v_p ->> 'sicherheit')::numeric,
      case when v_menge = 0 then 'nicht'
           when v_mpe is not null and v_menge < v_anzahl * v_mpe then 'teilweise'
           else 'uebernehmen' end,
      v_mpe, v_menge, v_kosten,
      nullif(v_p ->> 'grund', ''), left(nullif(btrim(v_p ->> 'grund_text'), ''), 200),
      left(nullif(btrim(v_p ->> 'hinweis'), ''), 300),
      nullif(v_p ->> 'ablauf_am', '')::date, nullif(v_p ->> 'lagerort', ''), v_ids, v_charge);
  end loop;

  update bon_import set alte_preise = v_preise where id = v_import_id;

  return jsonb_build_object(
    'import_id', v_import_id,
    'bewegung_ids', to_jsonb(v_alle_ids),
    'hinzugefuegt', v_hinzu,
    'nicht_uebernommen', v_nicht,
    'neue_sorten', v_neue);
end;
$$;

-- Sortenpreise zurücksetzen – aber nur dort, wo seitdem niemand einen anderen Preis gesetzt hat.
create function preise_zuruecksetzen(p_preise jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_x jsonb;
begin
  for v_x in select e from jsonb_array_elements(coalesce(p_preise, '[]')) e
  loop
    update block_typ
    set kosten_cent  = (v_x ->> 'alt_cent')::integer,
        kosten_menge = coalesce((v_x ->> 'alt_menge')::integer, 1)
    where id = (v_x ->> 'block_typ_id')::bigint
      and kosten_cent is not distinct from (v_x ->> 'neu_cent')::integer
      and kosten_menge is not distinct from (v_x ->> 'neu_menge')::integer;
  end loop;
end;
$$;

-- Ganzen Import mit einer Aktion rückgängig machen. Klappt nur, solange aus keiner seiner Chargen
-- entnommen wurde – sonst bleibt alles, wie es ist. Neu angelegte Sorten bleiben (ohne Bestand) erhalten.
create function bon_rueckgaengig(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_i   record;
  v_ids bigint[];
begin
  select * into v_i from bon_import where id = p_import_id for update;
  if not found then
    raise exception 'Import nicht gefunden – nichts wurde geändert.';
  end if;
  if v_i.status <> 'gebucht' then
    raise exception 'Das wurde schon rückgängig gemacht.';
  end if;

  select coalesce(array_agg(x order by x), '{}') into v_ids
  from bon_position p, unnest(p.bewegung_ids) x
  where p.import_id = p_import_id;

  if cardinality(v_ids) > 0 then
    perform rueckgaengig(v_ids);
  end if;
  perform preise_zuruecksetzen(v_i.alte_preise);

  update bon_import set status = 'rueckgaengig', rueckgaengig_am = now() where id = p_import_id;
end;
$$;

-- Was der Haushalt früher mit einem Bon-Artikel gemacht hat – Grundlage für Hinweise wie
-- „Du übernimmst Joghurt normalerweise nicht in deinen Bestand.“ Entscheidet nie selbst.
create view bon_gewohnheit with (security_invoker = true) as
select p.schluessel,
       count(*) filter (where p.bestand_menge > 0)::integer                               as uebernommen,
       count(*) filter (where p.bestand_menge = 0
                          and p.typ in ('lebensmittel', 'unbekannt'))::integer            as nicht_uebernommen,
       count(*) filter (where p.entscheidung = 'teilweise')::integer                      as teilweise,
       (array_agg(p.block_typ_id order by p.id desc)
          filter (where p.block_typ_id is not null and p.bestand_menge > 0))[1]            as letzte_sorte,
       (array_agg(p.menge_pro_einheit order by p.id desc)
          filter (where p.menge_pro_einheit is not null and p.bestand_menge > 0))[1]       as letzte_menge_pro_einheit,
       (array_agg(p.grund order by p.id desc) filter (where p.grund is not null))[1]     as letzter_grund,
       max(i.erstellt_am)                                                                 as zuletzt
from bon_position p
join bon_import i on i.id = p.import_id
where i.status = 'gebucht'
group by p.schluessel;

-- ───────────── Produktion ─────────────
-- Geplant → abgeschlossen (→ ggf. rückgängig). Eine geplante Produktion ändert keinen Bestand.

create table produktion (
  id               uuid primary key default gen_random_uuid(),
  art              text not null check (art in ('komponente', 'komplettgericht')),
  block_typ_id     bigint not null references block_typ(id),         -- was entsteht
  status           text not null default 'geplant'
                   check (status in ('geplant', 'abgeschlossen', 'rueckgaengig', 'verworfen')),
  geplant          boolean not null default true,                     -- false = direkt produziert
  geplant_fuer     date,                                              -- null = flexibel
  geplante_menge   integer check (geplante_menge > 0),                -- in der Einheit der Sorte
  -- Eingänge [{block_typ_id, menge}] – geplant bzw. nach Abschluss tatsächlich verwendet
  zutaten          jsonb not null default '[]' check (jsonb_typeof(zutaten) = 'array'),
  menge            integer check (menge > 0),                         -- tatsächliche Ausbeute
  lagerort         text check (lagerort in ('gefrierfach', 'kuehlschrank', 'vorrat')),
  ablauf_am        date,
  notiz            text check (length(notiz) <= 300),
  charge_id        bigint references charge(id),                      -- neue Produktionscharge
  bewegung_ids     bigint[] not null default '{}',
  kosten_cent      numeric(14,4) check (kosten_cent >= 0),
  kosten_status    text check (kosten_status in ('berechnet', 'teilweise', 'unbekannt')),
  alter_preis      jsonb,
  plan_id          uuid references plan(id) on delete set null,
  erstellt_am      timestamptz not null default now(),
  abgeschlossen_am timestamptz,
  rueckgaengig_am  timestamptz
);

create index produktion_status_idx on produktion (status, geplant_fuer);
create index produktion_sorte_idx on produktion (block_typ_id, abgeschlossen_am);

-- Kostenherkunft: je entnommener Bewegung die Eingangs-Charge und ihr Wert.
create table produktion_eingang (
  id            bigint generated always as identity primary key,
  produktion_id uuid not null references produktion(id),
  bewegung_id   bigint not null unique references bewegung(id),
  charge_id     bigint not null references charge(id),
  block_typ_id  bigint not null references block_typ(id),
  menge         integer not null check (menge > 0),
  wert_cent     numeric(14,4) check (wert_cent >= 0),                 -- null = Preis unbekannt
  kosten_status text not null check (kosten_status in ('berechnet', 'teilweise', 'unbekannt'))
);

create index produktion_eingang_produktion_idx on produktion_eingang (produktion_id);

-- Art folgt immer der Sorte; Zutaten werden nicht „produziert“.
create function produktion_art_pruefen() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_art  text;
  v_name text;
begin
  select art, name into v_art, v_name from block_typ where id = new.block_typ_id;
  if not found then
    raise exception 'Diese Sorte gibt es nicht.';
  end if;
  if v_art not in ('komponente', 'komplettgericht') then
    raise exception 'Produziert werden Komponenten und Komplettgerichte – „%“ ist eine Zutat.', v_name;
  end if;
  new.art := v_art;
  return new;
end;
$$;

create trigger produktion_art_pruefen
  before insert or update of block_typ_id on produktion
  for each row execute function produktion_art_pruefen();

-- Produzieren: Eingänge entnehmen (FIFO, Auftau-Status), Kosten aus genau diesen Bewegungen
-- berechnen und die TATSÄCHLICHE Menge als neue Charge einbuchen – alles oder nichts.
-- p_eingaenge: [{block_typ_id, menge}] in der Einheit der jeweiligen Sorte.
create function produzieren(p_block_typ_id bigint, p_eingaenge jsonb, p_menge integer,
                            p_lagerort text default null, p_ablauf_am date default null,
                            p_produktion_id uuid default null, p_plan_id uuid default null,
                            p_geplante_menge integer default null, p_notiz text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eing     jsonb := coalesce(p_eingaenge, '[]');
  v_prod     record;
  v_id       uuid;
  v_plan     uuid := p_plan_id;
  v_ein_ids  bigint[] := '{}';
  v_aus_ids  bigint[];
  v_charge   bigint;
  v_summe    numeric;
  v_anzahl   integer;
  v_unbek    integer;
  v_teil     integer;
  v_status   text;
  v_alt      record;
  v_preis    jsonb := null;
begin
  if p_menge is null or p_menge < 1 then
    raise exception 'Die tatsächliche Menge muss mindestens 1 sein. Es wurde nichts gebucht.';
  end if;
  if jsonb_typeof(v_eing) <> 'array' then
    raise exception 'Eingänge fehlen. Es wurde nichts gebucht.';
  end if;
  if exists (select 1 from jsonb_array_elements(v_eing) e
             where (e ->> 'menge')::integer is null or (e ->> 'menge')::integer < 1
                or (e ->> 'block_typ_id') is null) then
    raise exception 'Jeder Eingang braucht eine Sorte und eine Menge von mindestens 1. Es wurde nichts gebucht.';
  end if;
  if exists (select 1 from jsonb_array_elements(v_eing) e where (e ->> 'block_typ_id')::bigint = p_block_typ_id) then
    raise exception 'Eine Sorte kann nicht aus sich selbst produziert werden. Es wurde nichts gebucht.';
  end if;
  if p_lagerort is not null and p_lagerort not in ('gefrierfach', 'kuehlschrank', 'vorrat') then
    raise exception 'Unbekannter Lagerort. Es wurde nichts gebucht.';
  end if;

  if p_produktion_id is not null then
    select * into v_prod from produktion where id = p_produktion_id for update;
    if not found then
      raise exception 'Diese Produktion gibt es nicht. Es wurde nichts gebucht.';
    end if;
    if v_prod.status <> 'geplant' then
      raise exception 'Diese Produktion ist schon abgeschlossen oder verworfen. Es wurde nichts gebucht.';
    end if;
    if v_prod.block_typ_id <> p_block_typ_id then
      raise exception 'Die Produktion gehört zu einer anderen Sorte. Es wurde nichts gebucht.';
    end if;
    v_id := p_produktion_id;
    v_plan := coalesce(p_plan_id, v_prod.plan_id);
  else
    -- Direkt produziert: Datensatz jetzt anlegen (prüft Sorte und Art über den Trigger).
    insert into produktion (art, block_typ_id, geplant, geplante_menge, zutaten, notiz, plan_id)
    values ('komponente', p_block_typ_id, false, coalesce(p_geplante_menge, p_menge), v_eing,
            left(p_notiz, 300), p_plan_id)
    returning id into v_id;
  end if;

  if jsonb_array_length(v_eing) > 0 then
    v_ein_ids := entnehme_posten(v_eing, v_plan);   -- Fehler → alles wird zurückgerollt
  end if;

  -- Kostenherkunft: genau die entnommenen Bewegungen mit dem Preis ihrer Charge.
  insert into produktion_eingang (produktion_id, bewegung_id, charge_id, block_typ_id, menge, wert_cent, kosten_status)
  select v_id, b.id, b.charge_id, c.block_typ_id, -b.menge,
         case when c.kosten_cent is null then null else -b.menge * c.kosten_cent / c.kosten_menge end,
         c.kosten_status
  from bewegung b
  join charge c on c.id = b.charge_id
  where b.id = any(v_ein_ids);

  select sum(wert_cent), count(*)::integer,
         count(*) filter (where wert_cent is null)::integer,
         count(*) filter (where kosten_status = 'teilweise')::integer
  into v_summe, v_anzahl, v_unbek, v_teil
  from produktion_eingang where produktion_id = v_id;

  v_status := case
    when v_anzahl = 0 or v_summe is null then 'unbekannt'
    when v_unbek = 0 and v_teil = 0 then 'berechnet'
    else 'teilweise'
  end;
  if v_status = 'unbekannt' then
    v_summe := null;
  end if;

  v_aus_ids := einfrieren(p_block_typ_id, p_menge, p_ablauf_am);
  select charge_id into v_charge from bewegung where id = v_aus_ids[1];

  update charge
  set kosten_cent   = v_summe,
      kosten_menge  = case when v_summe is null then null else p_menge end,
      kosten_status = v_status,
      kosten_quelle = 'produktion',
      quelle        = 'produktion',
      lagerort      = p_lagerort
  where id = v_charge;

  -- Vollständig berechnete Kosten werden zum Referenzpreis der Sorte (für „Heute essen“).
  if v_status = 'berechnet' then
    select kosten_cent, kosten_menge into v_alt from block_typ where id = p_block_typ_id;
    v_preis := jsonb_build_array(jsonb_build_object(
      'block_typ_id', p_block_typ_id, 'alt_cent', v_alt.kosten_cent, 'alt_menge', v_alt.kosten_menge,
      'neu_cent', round(v_summe)::integer, 'neu_menge', p_menge));
    update block_typ set kosten_cent = round(v_summe)::integer, kosten_menge = p_menge where id = p_block_typ_id;
  end if;

  if v_plan is not null then
    update plan set status = 'erledigt', erledigt_am = now() where id = v_plan and status = 'geplant';
    if not found then
      raise exception 'Dieser Plan ist schon erledigt. Es wurde nichts gebucht.';
    end if;
  end if;

  update produktion
  set status           = 'abgeschlossen',
      zutaten          = v_eing,
      geplante_menge   = coalesce(p_geplante_menge, geplante_menge, p_menge),
      menge            = p_menge,
      lagerort         = p_lagerort,
      ablauf_am        = p_ablauf_am,
      notiz            = coalesce(left(p_notiz, 300), notiz),
      charge_id        = v_charge,
      bewegung_ids     = v_ein_ids || v_aus_ids,
      kosten_cent      = v_summe,
      kosten_status    = v_status,
      alter_preis      = v_preis,
      plan_id          = v_plan,
      abgeschlossen_am = now(),
      rueckgaengig_am  = null
  where id = v_id;

  return jsonb_build_object(
    'produktion_id', v_id,
    'charge_id', v_charge,
    'bewegung_ids', to_jsonb(v_ein_ids || v_aus_ids),
    'kosten_cent', v_summe,
    'kosten_status', v_status);
end;
$$;

-- Produktion rückgängig: Eingänge zurück, Produktionscharge weg, Plan/Auftauen zurück, Preis zurück.
-- Geht nur, solange aus der neuen Charge nichts entnommen wurde. Eine vorher geplante Produktion
-- ist danach wieder „geplant“.
create function produktion_rueckgaengig(p_produktion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p record;
begin
  select * into v_p from produktion where id = p_produktion_id for update;
  if not found then
    raise exception 'Diese Produktion gibt es nicht – nichts wurde geändert.';
  end if;
  if v_p.status <> 'abgeschlossen' then
    raise exception 'Diese Produktion ist nicht abgeschlossen – nichts wurde geändert.';
  end if;

  perform kochen_rueckgaengig(v_p.bewegung_ids, v_p.plan_id);
  perform preise_zuruecksetzen(v_p.alter_preis);
  delete from produktion_eingang where produktion_id = p_produktion_id;

  update produktion
  set status           = case when geplant then 'geplant' else 'rueckgaengig' end,
      menge            = case when geplant then null else menge end,
      charge_id        = case when geplant then null else charge_id end,
      bewegung_ids     = case when geplant then '{}' else bewegung_ids end,
      kosten_cent      = null,
      kosten_status    = null,
      alter_preis      = null,
      abgeschlossen_am = null,
      rueckgaengig_am  = now()
  where id = p_produktion_id;
end;
$$;

-- ───────────── Rechte ─────────────
-- Wie bisher: App ohne Login (anon), später mit Login (authenticated).
-- Bon-Importe und Produktionsergebnisse schreiben nur die Funktionen. Die App darf Produktionen
-- planen (nur Planungsfelder, nur solange „geplant“) – Ergebnisfelder bleiben den Funktionen vorbehalten.

alter table bon_import         enable row level security;
alter table bon_position       enable row level security;
alter table produktion         enable row level security;
alter table produktion_eingang enable row level security;

revoke all on bon_import, bon_position, produktion, produktion_eingang, bewegung_kosten, bon_gewohnheit
  from public, anon, authenticated;

grant select on bon_import, bon_position, produktion, produktion_eingang, bewegung_kosten, bon_gewohnheit
  to anon, authenticated;
grant insert (block_typ_id, geplant_fuer, geplante_menge, zutaten, lagerort, ablauf_am, notiz, plan_id)
  on produktion to anon, authenticated;
grant update (geplant_fuer, geplante_menge, zutaten, lagerort, ablauf_am, notiz, status)
  on produktion to anon, authenticated;

create policy "App liest Bon-Importe"     on bon_import         for select to anon, authenticated using (true);
create policy "App liest Bon-Positionen"  on bon_position       for select to anon, authenticated using (true);
create policy "App liest Produktionen"    on produktion         for select to anon, authenticated using (true);
create policy "App plant Produktionen"    on produktion         for insert to anon, authenticated
  with check (status = 'geplant' and geplant);
create policy "App ändert Planungen"      on produktion         for update to anon, authenticated
  using (status = 'geplant') with check (status in ('geplant', 'verworfen'));
create policy "App liest Kostenherkunft"  on produktion_eingang for select to anon, authenticated using (true);

revoke execute on function charge_kosten_vorbelegen(), produktion_art_pruefen(),
  bon_buchen(jsonb, boolean), preise_zuruecksetzen(jsonb), bon_rueckgaengig(uuid),
  produzieren(bigint, jsonb, integer, text, date, uuid, uuid, integer, text), produktion_rueckgaengig(uuid)
  from public, anon, authenticated;

grant execute on function bon_buchen(jsonb, boolean), bon_rueckgaengig(uuid),
  produzieren(bigint, jsonb, integer, text, date, uuid, uuid, integer, text), produktion_rueckgaengig(uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';
