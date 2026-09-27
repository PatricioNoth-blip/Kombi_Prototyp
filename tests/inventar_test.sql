-- Tests für die Akzeptanzkriterien (Aufruf: npm test bzw. scripts/test.sh).
-- Erwartet eine Datenbank mit Migration + Seed. Alles läuft in einer Transaktion,
-- die am Ende zurückgerollt wird – die Datenbank bleibt unverändert.

\set ON_ERROR_STOP on
\set QUIET on
begin;

-- Aktuelle Mengen der Chargen einer Sorte in FIFO-Reihenfolge (alt → neu)
create function pg_temp.mengen(p_name text) returns integer[]
language sql as $$
  select coalesce(array_agg(c.menge_aktuell order by c.eingefroren_am, c.id), '{}')
  from charge c join block_typ t on t.id = c.block_typ_id
  where t.name = p_name
$$;

-- Führt SQL aus und liefert die Fehlermeldung (oder null, falls kein Fehler kam)
create function pg_temp.fehler(p_sql text) returns text
language plpgsql as $$
declare v_text text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_text = message_text;
  return v_text;
end $$;


-- ─── Seed ───
do $$
begin
  assert (select count(*) from block_typ) = 17, 'Seed: 17 Sorten erwartet';
  assert (select sum(anzahl) from bestand) = 106, 'Seed: 106 Blöcke erwartet';
  assert (select anzahl from bestand where name = 'Brötchen') = 12, 'Seed: 12 Brötchen erwartet';
  assert (select count(*) from charge where eingefroren_am = date '2026-09-27') = 17,
    'Seed: alle Chargen vom 27.09.2026';
  assert not exists (select from bestand where nachkochen), 'Seed: nichts unter Mindestbestand';
end $$;
\echo 'ok  Seed: 17 Sorten, 106 Blöcke vom 27.09.2026'


-- ─── Einfrieren ───
do $$
declare
  v_id  bigint;
  v_ids bigint[];
begin
  insert into block_typ (name, farbe) values ('Test Einfrieren', 'rot') returning id into v_id;
  v_ids := einfrieren(v_id, 6);

  assert pg_temp.mengen('Test Einfrieren') = array[6], 'neue Charge mit 6 Stück';
  assert (select eingefroren_am from charge where block_typ_id = v_id) = heute(), 'Datum = heute';
  assert (select array[menge::text, art] from bewegung where id = v_ids[1]) = array['6', 'kochtag'],
    'Bewegung +6 kochtag';
  assert pg_temp.fehler(format('select einfrieren(%s, 0)', v_id)) = 'Anzahl muss mindestens 1 sein.',
    'Anzahl 0 wird abgelehnt';
  assert pg_temp.fehler('select einfrieren(-1, 1)') = 'Diese Sorte gibt es nicht.',
    'unbekannte Sorte wird abgelehnt';
end $$;
\echo 'ok  Einfrieren: neue Charge mit heutigem Datum + Bewegung „kochtag“'


-- ─── FIFO: Chargen [2 (alt), 5 (neu)] − 3 → [0, 4] ───
do $$
declare
  v_id  bigint;
  v_ids bigint[];
begin
  insert into block_typ (name, farbe) values ('Test FIFO', 'braun') returning id into v_id;
  perform einfrieren(v_id, 2);
  update charge set eingefroren_am = heute() - 10 where block_typ_id = v_id;  -- ältere Charge
  perform einfrieren(v_id, 5);
  assert pg_temp.mengen('Test FIFO') = array[2, 5], 'Ausgangslage [2, 5]';

  v_ids := entnehmen(v_id, 3);

  assert pg_temp.mengen('Test FIFO') = array[0, 4],
    format('FIFO: erwartet {0,4}, ist %s', pg_temp.mengen('Test FIFO'));
  assert (select array_agg(menge order by id) from bewegung where id = any(v_ids)) = array[-2, -1],
    'je Charge eine Bewegung: −2 (alt), −1 (neu)';
  assert (select bool_and(art = 'verbrauch') from bewegung where id = any(v_ids)), 'art = verbrauch';
end $$;
\echo 'ok  FIFO: Chargen [2 alt, 5 neu] − 3 → [0, 4]'


-- ─── FIFO bei gleichem Datum: zuerst angelegte Charge zuerst ───
do $$
declare v_id bigint;
begin
  insert into block_typ (name, farbe) values ('Test gleicher Tag', 'gruen') returning id into v_id;
  perform einfrieren(v_id, 1);
  perform einfrieren(v_id, 3);
  perform entnehmen(v_id, 2);
  assert pg_temp.mengen('Test gleicher Tag') = array[0, 2],
    format('erwartet {0,2}, ist %s', pg_temp.mengen('Test gleicher Tag'));
end $$;
\echo 'ok  FIFO bei gleichem Datum: zuerst eingefrorene Charge zuerst'


-- ─── Entnahme größer als Bestand → Fehlermeldung, nichts ändert sich ───
do $$
declare
  v_id       bigint := (select id from block_typ where name = 'Test FIFO');
  v_bew_vor  bigint := (select count(*) from bewegung);
  v_fehler   text;
begin
  v_fehler := pg_temp.fehler(format('select entnehmen(%s, 5)', v_id));
  assert v_fehler = 'Nur noch 4× Test FIFO da – 5× angefragt. Es wurde nichts entnommen.',
    format('Fehlermeldung war: %s', v_fehler);
  assert pg_temp.mengen('Test FIFO') = array[0, 4], 'Bestand unverändert';
  assert (select count(*) from bewegung) = v_bew_vor, 'keine neue Bewegung';

  perform entnehmen(v_id, 4);
  v_fehler := pg_temp.fehler(format('select entnehmen(%s, 1)', v_id));
  assert v_fehler = 'Von Test FIFO ist nichts mehr da. Es wurde nichts entnommen.',
    format('Fehlermeldung bei leerem Bestand war: %s', v_fehler);
  assert pg_temp.mengen('Test FIFO') = array[0, 0], 'nie unter 0';

  assert pg_temp.fehler(format('select entnehmen(%s, 0)', v_id)) = 'Anzahl muss mindestens 1 sein.',
    'Anzahl 0 wird abgelehnt';
end $$;
\echo 'ok  Überentnahme: verständliche Meldung, Bestand und Bewegungen unverändert'


-- ─── Nachkochen, sobald Bestand < Mindestbestand ───
do $$
declare v_id bigint;
begin
  insert into block_typ (name, farbe, mindestbestand) values ('Test Nachkochen', 'gelb', 4)
  returning id into v_id;
  assert (select nachkochen from bestand where id = v_id), 'leer (0 < 4) → nachkochen';

  perform einfrieren(v_id, 4);
  assert not (select nachkochen from bestand where id = v_id), '4 = Mindestbestand → ok';

  perform entnehmen(v_id, 1);
  assert (select anzahl from bestand where id = v_id) = 3, 'Bestand 3';
  assert (select nachkochen from bestand where id = v_id), '3 < 4 → nachkochen';

  -- Seed-Beispiel: Tomatensoße 6 bei Mindestbestand 6
  perform entnehmen((select id from block_typ where name = 'Tomatensoße'), 1);
  assert (select nachkochen from bestand where name = 'Tomatensoße'), 'Tomatensoße 5 < 6 → nachkochen';
end $$;
\echo 'ok  Nachkochen: erscheint, sobald Bestand < Mindestbestand'


-- ─── Bald ablaufen: älteste Charge älter als (haltbar_tage − 14) Tage ───
do $$
declare v_id bigint;
begin
  insert into block_typ (name, farbe, haltbar_tage) values ('Test Ablauf', 'blau', 30)
  returning id into v_id;
  assert not (select bald_ablaufen from bestand where id = v_id), 'ohne Bestand keine Warnung';

  perform einfrieren(v_id, 1);
  perform einfrieren(v_id, 1);
  assert not (select bald_ablaufen from bestand where id = v_id), 'frisch → keine Warnung';

  -- erste Charge 16 Tage alt: 16 > 30 − 14 ist falsch
  update charge set eingefroren_am = heute() - 16
  where id = (select min(id) from charge where block_typ_id = v_id);
  assert not (select bald_ablaufen from bestand where id = v_id), '16 Tage → noch keine Warnung';

  -- 17 Tage alt: 17 > 16 → Warnung
  update charge set eingefroren_am = heute() - 17
  where id = (select min(id) from charge where block_typ_id = v_id);
  assert (select bald_ablaufen from bestand where id = v_id), '17 Tage → bald ablaufen';
  assert (select aelteste from bestand where id = v_id) = heute() - 17, 'aelteste = alte Charge';

  -- alte Charge aufgebraucht → nur noch die frische zählt
  perform entnehmen(v_id, 1);
  assert not (select bald_ablaufen from bestand where id = v_id), 'leere Charge zählt nicht mehr';
  assert (select aelteste from bestand where id = v_id) = heute(), 'aelteste = frische Charge';
end $$;
\echo 'ok  Bald ablaufen: ab (haltbar_tage − 14) Tagen, leere Chargen zählen nicht'


-- ─── Rückgängig ───
do $$
declare
  v_id     bigint;
  v_ein    bigint[];
  v_raus   bigint[];
begin
  insert into block_typ (name, farbe) values ('Test Rückgängig', 'weiss') returning id into v_id;
  perform einfrieren(v_id, 2);
  update charge set eingefroren_am = heute() - 5 where block_typ_id = v_id;
  v_ein := einfrieren(v_id, 3);

  -- Entnahme über zwei Chargen zurücknehmen
  v_raus := entnehmen(v_id, 3);
  assert pg_temp.mengen('Test Rückgängig') = array[0, 2], 'nach Entnahme [0, 2]';
  perform rueckgaengig(v_raus);
  assert pg_temp.mengen('Test Rückgängig') = array[2, 3], 'nach Rückgängig wieder [2, 3]';
  assert (select count(*) from bewegung where storno_von = any(v_raus) and art = 'korrektur') = 2,
    'zwei Korrektur-Bewegungen';
  assert pg_temp.fehler(format('select rueckgaengig(%L)', v_raus)) = 'Das wurde schon rückgängig gemacht.',
    'nur einmal rückgängig';
  assert pg_temp.fehler(format('select rueckgaengig(array[(select id from bewegung where storno_von = %s)])', v_raus[1]))
    = 'Eine Korrektur kann nicht rückgängig gemacht werden.', 'Korrektur nicht rückgängig';

  -- Einfrieren zurücknehmen
  perform rueckgaengig(v_ein);
  assert pg_temp.mengen('Test Rückgängig') = array[2, 0], 'Einfrieren zurückgenommen';

  -- Einfrieren nicht mehr rückgängig, wenn schon daraus entnommen wurde
  v_ein := einfrieren(v_id, 2);
  perform entnehmen(v_id, 3);   -- 2 aus alter, 1 aus neuer Charge
  assert pg_temp.fehler(format('select rueckgaengig(%L)', v_ein))
    = 'Aus dieser Charge wurde inzwischen schon entnommen – Rückgängig ist nicht mehr möglich.',
    'Einfrieren nach Entnahme nicht mehr rückgängig';

  assert pg_temp.fehler('select rueckgaengig(array[-1]::bigint[])')
    = 'Buchung nicht gefunden – nichts wurde geändert.', 'unbekannte Bewegung';
end $$;
\echo 'ok  Rückgängig: Entnahme und Einfrieren per Korrektur-Bewegung, nur einmal'


-- ─── Nachvollziehbarkeit: jede Bestandsänderung steht in bewegung ───
do $$
begin
  assert not exists (
    select from charge c
    where c.menge_aktuell <> (select coalesce(sum(b.menge), 0) from bewegung b where b.charge_id = c.id)
  ), 'Bestand jeder Charge = Summe ihrer Bewegungen';
  assert not exists (
    select from charge c
    where c.menge_start <> (select b.menge from bewegung b
                            where b.charge_id = c.id and b.art = 'kochtag')
  ), 'jede Charge hat genau eine kochtag-Bewegung über menge_start';

  -- Änderung ohne Bewegung wird vom Wächter abgelehnt (auch als Admin)
  assert pg_temp.fehler($sql$
    update charge set menge_aktuell = menge_aktuell + 1
    where id = (select min(id) from charge);
    set constraints all immediate
  $sql$) like 'Charge %: Bestand % passt nicht zur Summe der Bewegungen%',
    'Änderung ohne Bewegung muss scheitern';
end $$;
set constraints all deferred;
\echo 'ok  Nachvollziehbarkeit: Bestand = Summe der Bewegungen, Änderung ohne Bewegung scheitert'


-- ─── Zugriffsrechte der App ───
-- v0.1 läuft ohne Login (Rolle anon). Die Rolle authenticated behält dieselben Rechte,
-- damit ein Login später ohne Umbau wieder eingeschaltet werden kann.
create function pg_temp.pruefe_app_rechte(p_sorte text) returns void
language plpgsql as $$
declare v_id bigint;
begin
  assert (select count(*) from bestand) > 17, 'Bestand sichtbar';
  assert (select count(*) from bewegung) > 0, 'Bewegungen sichtbar';

  insert into block_typ (name, farbe) values (p_sorte, 'schwarz') returning id into v_id;
  update block_typ set mindestbestand = 2, kosten_cent = 15 where id = v_id;
  perform einfrieren(v_id, 3);
  perform entnehmen(v_id, 1);
  assert (select anzahl from bestand where id = v_id) = 2, 'buchen geht';

  assert pg_temp.fehler(format('update charge set menge_aktuell = 99 where block_typ_id = %s', v_id))
    like 'permission denied%', 'charge nicht direkt änderbar';
  assert pg_temp.fehler(format(
    'insert into bewegung (charge_id, menge, art, datum) select id, 1, %L, heute() from charge limit 1',
    'korrektur')) like 'permission denied%', 'bewegung nicht direkt beschreibbar';
  assert pg_temp.fehler(format('delete from block_typ where id = %s', v_id))
    like 'permission denied%', 'Sorten nicht löschbar';
end $$;

set local role anon;
do $$ begin perform pg_temp.pruefe_app_rechte('Test Rechte ohne Login'); end $$;
reset role;
\echo 'ok  Rechte ohne Login: lesen, Sorten pflegen, buchen – aber nichts direkt an Chargen/Bewegungen'

set local role authenticated;
do $$ begin perform pg_temp.pruefe_app_rechte('Test Rechte mit Login'); end $$;
reset role;
\echo 'ok  Rechte mit Login (für später): dieselben Rechte'


-- ─── „Was essen wir?“: Lagerort ───
do $$
declare v_id bigint;
begin
  assert (select count(*) from block_typ where lagerort = 'gefrierfach') >= 17,
    'bestehende Sorten liegen im Gefrierfach';
  insert into block_typ (name, farbe, lagerort, kosten_cent) values ('Test Pasta', 'gelb', 'vorrat', 12)
  returning id into v_id;
  perform einfrieren(v_id, 4);
  assert (select lagerort from bestand where id = v_id) = 'vorrat', 'View bestand liefert lagerort';
  assert (select anzahl from bestand where id = v_id) = 4, 'Vorrat wird wie Gefrierblöcke gezählt';
  assert pg_temp.fehler($sql$insert into block_typ (name, farbe, lagerort) values ('x', 'rot', 'keller')$sql$)
    like '%violates check constraint%', 'unbekannter Lagerort wird abgelehnt';
end $$;
\echo 'ok  Lagerort: Standard Gefrierfach, Vorrat wird normal gebucht, View liefert lagerort'


-- ─── „Was essen wir?“: Sessions, Vorschläge, Feedback, Rezepte (ohne Login) ───
set local role anon;
do $$
declare
  v_session   uuid := gen_random_uuid();
  v_vorschlag uuid := gen_random_uuid();
  v_bestand   bigint := (select sum(anzahl) from bestand);
  v_bew       bigint := (select count(*) from bewegung);
begin
  insert into koch_session (id, personen, max_minuten, kuehlschrank)
  values (v_session, 2, 15, 'halbe Paprika, Frischkäse');
  insert into vorschlag (id, session_id, art, name, daten, anbieter)
  values (v_vorschlag, v_session, 'gericht', 'Linsen-Paprika-Pasta', '{"zutaten": []}', 'regelbasiert');
  insert into vorschlag_feedback (vorschlag_id, aktion) values (v_vorschlag, 'like');
  insert into rezept (name, daten, vorschlag_id) values ('Linsen-Paprika-Pasta', '{"zutaten": []}', v_vorschlag);

  assert (select count(*) from vorschlag_feedback where vorschlag_id = v_vorschlag) = 1, 'Feedback lesbar';
  assert (select count(*) from rezept where vorschlag_id = v_vorschlag) = 1, 'Rezept lesbar';

  assert pg_temp.fehler(format('insert into vorschlag_feedback (vorschlag_id, aktion) values (%L, %L)', v_vorschlag, 'liebe'))
    like '%violates check constraint%', 'unbekannte Aktion wird abgelehnt';
  assert pg_temp.fehler(format('update vorschlag set name = %L where id = %L', 'x', v_vorschlag))
    like 'permission denied%', 'Vorschläge sind nicht änderbar';
  assert pg_temp.fehler(format('delete from vorschlag_feedback where vorschlag_id = %L', v_vorschlag))
    like 'permission denied%', 'Feedback ist nicht löschbar';
  assert pg_temp.fehler('delete from rezept') like 'permission denied%', 'Rezepte nicht löschbar (v1)';

  assert (select sum(anzahl) from bestand) = v_bestand, 'Vorschläge und Feedback ändern den Bestand nicht';
  assert (select count(*) from bewegung) = v_bew, 'keine Bewegungen durch Vorschläge';
end $$;
reset role;
\echo 'ok  Was essen wir?: Session, Vorschlag, Feedback, Rezept anlegen und lesen – nichts änderbar, Bestand unberührt'


rollback;
\echo ''
\echo 'Alle Tests bestanden.'
