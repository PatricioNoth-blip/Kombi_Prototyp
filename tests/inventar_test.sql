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


-- ─── Baukasten: bestehende Sorten werden eingeordnet ───
do $$
begin
  assert (select count(*) from block_typ where farbe = 'blau' and name not like 'Test%') = 5
     and (select count(*) from block_typ where farbe = 'blau' and name not like 'Test%' and art <> 'komplettgericht') = 0,
    'blaue Seed-Sorten sind Komplettgerichte';
  assert (select art from block_typ where name = 'Pizza') = 'komplettgericht', 'Pizza = Komplettgericht';
  assert (select art from block_typ where name = 'Tomatensoße') = 'komponente', 'Tomatensoße = Komponente';
  assert (select art from block_typ where name = 'TK-Spinat') = 'zutat', 'TK-Spinat = Zutat';
  assert (select bool_and(herkunft is null and zusammensetzung is null and einheit = 'portion'
                          and portion_menge = 1 and kosten_menge = 1) from block_typ where name not like 'Test%'),
    'Herkunft und Zusammensetzung bleiben unbekannt, Einheit Portion, Preis pro Portion';
end $$;
\echo 'ok  Baukasten: Blau → Komplettgericht, TK → Zutat, sonst Komponente; Unbekanntes bleibt null'


-- ─── Baukasten: Standardwerte und Prüfungen ───
do $$
declare v_id bigint;
begin
  insert into block_typ (name, farbe) values ('Test Standard', 'rot') returning id into v_id;
  assert (select array[art, einheit, portion_menge::text, kosten_menge::text]
          from block_typ where id = v_id) = array['komponente', 'portion', '1', '1'],
    'Standard: Komponente, Portion, 1 Einheit pro Portion, Preis pro Einheit';

  assert pg_temp.fehler($sql$insert into block_typ (name, farbe, art) values ('x', 'rot', 'snack')$sql$)
    like '%violates check constraint%', 'unbekannte Art wird abgelehnt';
  assert pg_temp.fehler($sql$insert into block_typ (name, farbe, einheit) values ('x', 'rot', 'kg')$sql$)
    like '%violates check constraint%', 'unbekannte Einheit wird abgelehnt';
  assert pg_temp.fehler($sql$insert into block_typ (name, farbe, portion_menge) values ('x', 'rot', 2)$sql$)
    like '%violates check constraint%', 'bei Einheit Portion ist eine Portion genau 1';
  assert pg_temp.fehler($sql$insert into block_typ (name, farbe, zusammensetzung) values ('x', 'rot', '{}')$sql$)
    like '%violates check constraint%', 'leere Zusammensetzung wird abgelehnt (unbekannt = null)';
  assert pg_temp.fehler($sql$insert into block_typ (name, farbe, kosten_menge) values ('x', 'rot', 0)$sql$)
    like '%violates check constraint%', 'Preisbezug 0 wird abgelehnt';
  assert pg_temp.fehler($sql$insert into block_typ (name, farbe, herkunft) values ('x', 'rot', 'geschenkt')$sql$)
    like '%violates check constraint%', 'unbekannte Herkunft wird abgelehnt';

  insert into block_typ (name, farbe, art, herkunft, zusammensetzung, kosten_cent, kosten_menge, notiz)
  values ('Test Lasagne', 'blau', 'komplettgericht', 'selbstgemacht',
          array['Nudelplatten', 'Linsen-Bolognese', 'Béchamel'], 200, 4, 'vom Sonntag')
  returning id into v_id;
  perform einfrieren(v_id, 4);
  assert (select array[art, herkunft, kosten_cent::text, kosten_menge::text, notiz]
          from bestand where id = v_id)
    = array['komplettgericht', 'selbstgemacht', '200', '4', 'vom Sonntag'], 'View liefert die neuen Felder';
  assert (select zusammensetzung from bestand where id = v_id) = array['Nudelplatten', 'Linsen-Bolognese', 'Béchamel'],
    'View liefert die Zusammensetzung';
end $$;
\echo 'ok  Baukasten: Standardwerte, Prüfungen, View liefert Art, Herkunft, Preisbezug, Zusammensetzung'


-- ─── Gramm/ml: ganzzahlige Mengen, verständliche Meldung ───
do $$
declare
  v_id     bigint;
  v_fehler text;
begin
  insert into block_typ (name, farbe, art, lagerort, einheit, portion_menge, kosten_cent, kosten_menge)
  values ('Test Spaghetti', 'gelb', 'zutat', 'vorrat', 'g', 125, 129, 500)
  returning id into v_id;
  perform einfrieren(v_id, 500);
  v_fehler := pg_temp.fehler(format('select entnehmen(%s, 600)', v_id));
  assert v_fehler = 'Nur noch 500 g Test Spaghetti da – 600 g angefragt. Es wurde nichts entnommen.',
    format('Meldung war: %s', v_fehler);
  perform entnehmen(v_id, 125);
  assert (select anzahl from bestand where id = v_id) = 375, '500 g − 125 g = 375 g';
end $$;
\echo 'ok  Gramm: 500 g − 125 g = 375 g, Meldung in Gramm'


-- ─── Einfrieren mit Ablaufdatum, alte Aufrufe gehen weiter ───
do $$
declare v_id bigint;
begin
  insert into block_typ (name, farbe) values ('Test MHD', 'gruen') returning id into v_id;
  perform einfrieren(v_id, 1);                           -- alter Aufruf ohne Datum
  perform einfrieren(v_id, 2, heute() + 10);
  assert (select array_agg(ablauf_am order by id) from charge where block_typ_id = v_id)
    = array[null, heute() + 10], 'Ablaufdatum optional';
  assert (select naechster_ablauf from bestand where id = v_id) = heute() + 10, 'nächster Ablauf';
  assert not (select bald_ablaufen from bestand where id = v_id), '10 Tage → noch nicht bald';

  perform einfrieren(v_id, 1, heute() + 3);
  assert (select bald_ablaufen from bestand where id = v_id), 'Ablauf in 3 Tagen → bald ablaufen';
  assert (select abgelaufen from bestand where id = v_id) = 0, 'nichts abgelaufen';

  perform einfrieren(v_id, 2, heute() - 1);
  assert (select abgelaufen from bestand where id = v_id) = 2, '2 abgelaufen';
end $$;
\echo 'ok  Ablaufdatum: optional, bald ablaufen ab ≤ 3 Tagen, abgelaufene Menge wird gezählt'


-- ─── Entnahme-Reihenfolge: geöffnet → frühester Ablauf → FIFO ───
do $$
declare
  v_id  bigint;
  v_alt bigint;
  v_mhd bigint;
  v_ids bigint[];
begin
  insert into block_typ (name, farbe, haltbar_tage) values ('Test Reihenfolge', 'braun', 90)
  returning id into v_id;
  perform einfrieren(v_id, 3);
  v_alt := (select max(id) from charge where block_typ_id = v_id);
  update charge set eingefroren_am = heute() - 10 where id = v_alt;     -- läuft ca. in 80 Tagen ab
  perform einfrieren(v_id, 3, heute() + 5);                              -- neuer, aber MHD in 5 Tagen
  v_mhd := (select max(id) from charge where block_typ_id = v_id);

  v_ids := entnehmen(v_id, 1);
  assert (select charge_id from bewegung where id = v_ids[1]) = v_mhd, 'frühester Ablauf zuerst';

  perform setze_geoeffnet(v_alt);
  assert (select geoeffnet_am from charge where id = v_alt) = heute(), 'geöffnet seit heute';
  assert (select geoeffnet from bestand where id = v_id) = 3, 'Menge in geöffneten Chargen';
  v_ids := entnehmen(v_id, 1);
  assert (select charge_id from bewegung where id = v_ids[1]) = v_alt, 'geöffnete Charge zuerst';

  perform setze_geoeffnet(v_alt, false);
  assert (select geoeffnet_am from charge where id = v_alt) is null, 'wieder verschlossen';
  assert (select geoeffnet from bestand where id = v_id) = 0, 'nichts mehr geöffnet';

  -- Ablauf ändern: alte Charge läuft jetzt früher ab
  perform setze_ablauf(v_alt, heute() + 1);
  v_ids := entnehmen(v_id, 1);
  assert (select charge_id from bewegung where id = v_ids[1]) = v_alt, 'geändertes Ablaufdatum zählt';

  -- aufgebrauchte Charge kann nicht geöffnet werden
  perform entnehmen(v_id, 1);
  assert (select menge_aktuell from charge where id = v_alt) = 0, 'alte Charge leer';
  assert pg_temp.fehler(format('select setze_geoeffnet(%s)', v_alt)) = 'Diese Charge ist schon aufgebraucht.',
    'leere Charge nicht öffnen';
  assert pg_temp.fehler('select setze_geoeffnet(-1)') = 'Diese Charge gibt es nicht.', 'unbekannte Charge';
  assert pg_temp.fehler('select setze_ablauf(-1, null)') = 'Diese Charge gibt es nicht.', 'unbekannte Charge (Ablauf)';

  assert not exists (
    select from charge c
    where c.menge_aktuell <> (select coalesce(sum(b.menge), 0) from bewegung b where b.charge_id = c.id)
  ), 'Öffnen und Ablauf ändern keine Mengen';
end $$;
\echo 'ok  Reihenfolge: geöffnete Charge → frühester Ablauf → FIFO; Öffnen/Ablauf ändern keine Mengen'


-- ─── Baukasten-Rechte ohne Login ───
set local role anon;
do $$
declare
  v_id     bigint;
  v_charge bigint;
begin
  insert into block_typ (name, farbe, art, herkunft, einheit, portion_menge, kosten_cent, kosten_menge, zusammensetzung)
  values ('Test Rechte Baukasten', 'gelb', 'zutat', 'gekauft', 'g', 100, 99, 500, array['Hartweizengrieß'])
  returning id into v_id;
  update block_typ set herkunft = null, zusammensetzung = null where id = v_id;
  perform einfrieren(v_id, 500, heute() + 30);
  v_charge := (select id from charge where block_typ_id = v_id);
  perform setze_geoeffnet(v_charge);
  perform setze_ablauf(v_charge, heute() + 20);
  assert (select naechster_ablauf from bestand where id = v_id) = heute() + 20, 'Ablauf gesetzt';

  assert pg_temp.fehler(format('update charge set ablauf_am = null where id = %s', v_charge))
    like 'permission denied%', 'Charge nicht direkt änderbar';
  assert pg_temp.fehler($sql$select menge_text(1, 'g')$sql$) like 'permission denied%',
    'Hilfsfunktion nicht direkt aufrufbar';

  insert into rezept (name, daten, gerichtstyp, portionen, zutaten, schritte, bestandsarten, tags,
                      kosten_pro_portion_cent, kosten_status, feedback)
  values ('Test Rezept', '{}', 'pasta', 2,
          '[{"name": "Spaghetti", "menge": 250, "einheit": "g", "art": "zutat"}]',
          array['Nudeln kochen'], array['zutat', 'komponente'], array['schnell'], 62, 'berechnet', array['like']);
  assert (select kosten_status from rezept where name = 'Test Rezept') = 'berechnet', 'Rezept strukturiert';
  assert pg_temp.fehler($sql$insert into rezept (name, daten, kosten_status) values ('x', '{}', 'geschätzt')$sql$)
    like '%violates check constraint%', 'Kostenstatus nur berechnet/teilweise/unbekannt';
  insert into rezept (name, daten) values ('Test Rezept alt', '{}');   -- alte App-Version
end $$;
reset role;
\echo 'ok  Baukasten-Rechte: Sorte mit neuen Feldern, einbuchen mit Ablauf, öffnen, Rezept strukturiert – Chargen weiter geschützt'


-- ─── Komponenten-Funktion: Gerichtstypen, Richtung, Startmenge ───
do $$
declare v_id bigint;
begin
  insert into block_typ (name, farbe, art, gerichtstypen, richtung, zusammensetzung)
  values ('Test Tomaten-Basis', 'rot', 'komponente', array['pasta', 'pizza', 'suppe'], 'italienisch',
          array['Tomaten', 'Zwiebeln', 'Knoblauch'])
  returning id into v_id;
  perform einfrieren(v_id, 8);
  perform entnehmen(v_id, 2);
  assert (select array[richtung, start_menge::text, anzahl::text] from bestand where id = v_id)
    = array['italienisch', '8', '6'], 'View: Richtung, 6 von 8 Portionen';
  assert (select gerichtstypen from bestand where id = v_id) = array['pasta', 'pizza', 'suppe'], 'View: Gerichtstypen';
  assert pg_temp.fehler(format('update block_typ set richtung = %L where id = %s', 'marsianisch', v_id))
    like '%violates check constraint%', 'unbekannte Richtung wird abgelehnt';
end $$;
\echo 'ok  Komponenten-Funktion: Gerichtstypen, Richtung, 6 / 8 Portionen'


-- ─── kochen(): alles oder nichts, Plan abhaken, Rückgängig ───
do $$
declare
  v_a    bigint;
  v_b    bigint;
  v_plan uuid;
  v_ids  bigint[];
  v_bew  bigint := (select count(*) from bewegung);
begin
  insert into block_typ (name, farbe) values ('Test Kochen A', 'braun') returning id into v_a;
  insert into block_typ (name, farbe) values ('Test Kochen B', 'gelb') returning id into v_b;
  perform einfrieren(v_a, 3);
  perform einfrieren(v_b, 2);
  v_bew := (select count(*) from bewegung);

  -- B reicht nicht → auch A wird NICHT entnommen
  assert pg_temp.fehler(format($f$select kochen('[{"block_typ_id": %s, "menge": 1}, {"block_typ_id": %s, "menge": 5}]')$f$, v_a, v_b))
    = 'Nur noch 2× Test Kochen B da – 5× angefragt. Es wurde nichts entnommen.', 'Meldung bei zu wenig';
  assert (select anzahl from bestand where id = v_a) = 3, 'A unverändert (alles oder nichts)';
  assert (select count(*) from bewegung) = v_bew, 'keine Bewegung';
  assert pg_temp.fehler($q$select kochen('[]')$q$) = 'Nichts zu entnehmen.', 'leerer Plan';

  insert into plan (art, titel, portionen, daten) values ('mahlzeit', 'Test Gericht', 2, '{}') returning id into v_plan;
  -- doppelte Posten derselben Sorte werden zusammengefasst
  v_ids := kochen(format('[{"block_typ_id": %s, "menge": 1}, {"block_typ_id": %s, "menge": 2}, {"block_typ_id": %s, "menge": 1}]', v_a, v_b, v_a)::jsonb, v_plan);
  assert (select array[anzahl] from bestand where id = v_a) = array[1], 'A: 3 − 2';
  assert (select anzahl from bestand where id = v_b) = 0, 'B: 2 − 2';
  assert (select status from plan where id = v_plan) = 'erledigt', 'Plan abgehakt';
  assert pg_temp.fehler(format($f$select kochen('[{"block_typ_id": %s, "menge": 1}]', %L)$f$, v_a, v_plan))
    = 'Diese Mahlzeit ist schon gekocht oder nicht mehr geplant. Es wurde nichts entnommen.', 'nicht doppelt kochen';
  assert (select anzahl from bestand where id = v_a) = 1, 'zweites Kochen hat nichts entnommen';

  perform kochen_rueckgaengig(v_ids, v_plan);
  assert (select anzahl from bestand where id = v_a) = 3 and (select anzahl from bestand where id = v_b) = 2, 'Rückgängig: Bestand zurück';
  assert (select status from plan where id = v_plan) = 'geplant', 'Rückgängig: Plan wieder offen';
end $$;
\echo 'ok  kochen(): alles oder nichts, Plan abhaken, nicht doppelt, Rückgängig'


-- ─── herstellen(): Zutaten raus, Komponente rein – ein Schritt ───
do $$
declare
  v_zutat bigint;
  v_komp  bigint;
  v_plan  uuid;
  v_ids   bigint[];
begin
  insert into block_typ (name, farbe, art, einheit, portion_menge) values ('Test Linsen roh', 'braun', 'zutat', 'g', 80)
  returning id into v_zutat;
  insert into block_typ (name, farbe, art) values ('Test Linsen-Komponente', 'braun', 'komponente') returning id into v_komp;
  perform einfrieren(v_zutat, 500);
  insert into plan (art, titel, portionen, daten) values ('komponente', 'Test Linsen-Komponente', 6, '{}') returning id into v_plan;

  -- zu wenig Zutat → auch die Komponente wird nicht eingebucht
  assert pg_temp.fehler(format($f$select herstellen('[{"block_typ_id": %s, "menge": 900}]', %s, 6)$f$, v_zutat, v_komp))
    like 'Nur noch 500 g%', 'zu wenig → nichts';
  assert (select anzahl from bestand where id = v_komp) = 0, 'Komponente nicht eingebucht';

  v_ids := herstellen(format('[{"block_typ_id": %s, "menge": 250}]', v_zutat)::jsonb, v_komp, 6, heute() + 90, v_plan);
  assert (select anzahl from bestand where id = v_zutat) = 250, '250 g Linsen entnommen';
  assert (select anzahl from bestand where id = v_komp) = 6, '6 Portionen Komponente eingebucht';
  assert (select naechster_ablauf from bestand where id = v_komp) = heute() + 90, 'mit Ablaufdatum';
  assert (select status from plan where id = v_plan) = 'erledigt', 'vorgemerkte Komponente erledigt';

  perform kochen_rueckgaengig(v_ids, v_plan);
  assert (select anzahl from bestand where id = v_zutat) = 500 and (select anzahl from bestand where id = v_komp) = 0,
    'Rückgängig: beides zurück';

  -- ohne Zutaten aus dem Vorrat (alles frisch gekauft)
  v_ids := herstellen('[]', v_komp, 4);
  assert (select anzahl from bestand where id = v_komp) = 4, 'nur einbuchen';
end $$;
\echo 'ok  herstellen(): Zutaten entnehmen + Komponente einbuchen in einem Schritt, Rückgängig'


-- ─── Auftauen: nur Status, verbraucht beim Kochen ───
do $$
declare
  v_id  bigint;
  v_auf bigint;
  v_ids bigint[];
begin
  insert into block_typ (name, farbe, art) values ('Test Lasagne auftauen', 'blau', 'komplettgericht') returning id into v_id;
  perform einfrieren(v_id, 4);
  insert into auftauen (block_typ_id, menge, auftauen_am) values (v_id, 2, heute()) returning id into v_auf;
  assert (select array[anzahl, auftauen_geplant, aufgetaut] from bestand where id = v_id) = array[4, 2, 0],
    'vorgemerkt – Bestand unverändert';
  update auftauen set status = 'aufgetaut' where id = v_auf;
  assert (select array[anzahl, auftauen_geplant, aufgetaut] from bestand where id = v_id) = array[4, 0, 2],
    'aufgetaut – Bestand weiter unverändert';

  v_ids := kochen(format('[{"block_typ_id": %s, "menge": 2}]', v_id)::jsonb);
  assert (select status from auftauen where id = v_auf) = 'verbraucht', 'beim Kochen verbraucht';
  assert (select aufgetaut from bestand where id = v_id) = 0, 'nichts mehr aufgetaut';
  perform kochen_rueckgaengig(v_ids);
  assert (select status from auftauen where id = v_auf) = 'aufgetaut', 'Rückgängig: wieder aufgetaut';
  assert pg_temp.fehler(format('update auftauen set status = %L where id = %s', 'geschmolzen', v_auf))
    like '%violates check constraint%', 'unbekannter Status';
end $$;
\echo 'ok  Auftauen: geplant → aufgetaut → verbraucht, ändert keinen Bestand, Rückgängig'


-- ─── Einkauf → Vorrat: tatsächliche Menge, nur einmal, Rückgängig ───
do $$
declare
  v_id     bigint;
  v_buch   bigint;
  v_menge  integer;
  v_bew    bigint;
begin
  insert into block_typ (name, farbe, art, einheit, portion_menge, kosten_cent, kosten_menge)
  values ('Test Zwiebeln', 'gruen', 'zutat', 'g', 100, 99, 1000) returning id into v_id;
  insert into einkauf_eintrag (name, schluessel, menge, einheit, quelle) values ('Zwiebeln', 'zwiebel', 500, 'g', 'manuell');

  -- nicht abgehakt → nichts wird gebucht
  v_bew := (select count(*) from bewegung);
  assert pg_temp.fehler(format('select einkauf_buchen(%L, %L, %s, 300)', 'zwiebel', 'g', v_id))
    = 'Das ist schon im Vorrat oder nicht als gekauft markiert. Es wurde nichts gebucht.', 'ohne Haken keine Buchung';
  assert (select count(*) from bewegung) = v_bew, 'keine Bewegung';

  insert into einkauf_status (schluessel, einheit, status) values ('zwiebel', 'g', 'gekauft');
  -- geplant 500 g, gekauft 300 g → 300 g werden gebucht
  v_buch := einkauf_buchen('zwiebel', 'g', v_id, 300, heute() + 30, 149);
  assert (select anzahl from bestand where id = v_id) = 300, 'tatsächliche Menge gebucht';
  assert (select status from einkauf_eintrag where schluessel = 'zwiebel') = 'erledigt', 'Eintrag erledigt';
  assert not exists (select from einkauf_status where schluessel = 'zwiebel'), 'Haken verbraucht';
  assert (select array[kosten_cent, kosten_menge] from block_typ where id = v_id) = array[149, 300], 'bezahlter Preis übernommen';

  -- zweiter Aufruf (Doppeltipp, zweites Handy) bucht NICHTS
  assert pg_temp.fehler(format('select einkauf_buchen(%L, %L, %s, 300)', 'zwiebel', 'g', v_id))
    like 'Das ist schon im Vorrat%', 'keine Doppelbuchung';
  assert (select anzahl from bestand where id = v_id) = 300, 'weiter 300 g';

  perform einkauf_rueckgaengig(v_buch);
  assert (select anzahl from bestand where id = v_id) = 0, 'Rückgängig: Bestand zurück';
  assert (select status from einkauf_eintrag where schluessel = 'zwiebel') = 'offen', 'Eintrag wieder offen';
  assert (select status from einkauf_status where schluessel = 'zwiebel') = 'gekauft', 'wieder abgehakt';
  assert (select array[kosten_cent, kosten_menge] from block_typ where id = v_id) = array[99, 1000], 'alter Preis zurück';
  assert pg_temp.fehler(format('select einkauf_rueckgaengig(%s)', v_buch)) = 'Das wurde schon rückgängig gemacht.', 'nur einmal';
end $$;
\echo 'ok  Einkauf → Vorrat: tatsächliche Menge, keine Doppelbuchung, Preis lernen, Rückgängig'


-- ─── Nutzung: nur echte (nicht rückgängig gemachte) Buchungen ───
do $$
declare
  v_id  bigint;
  v_ids bigint[];
begin
  insert into block_typ (name, farbe, art) values ('Test Nutzung', 'rot', 'komponente') returning id into v_id;
  perform einfrieren(v_id, 3);
  perform einfrieren(v_id, 3);
  perform entnehmen(v_id, 2);
  v_ids := entnehmen(v_id, 1);
  perform rueckgaengig(v_ids);                 -- zählt nicht
  assert (select array[verbrauch_28, herstellungen_56, mittlere_menge] from nutzung where block_typ_id = v_id)
    = array[2, 2, 3], format('Nutzung: %s', (select row(verbrauch_28, herstellungen_56, mittlere_menge) from nutzung where block_typ_id = v_id));
end $$;
\echo 'ok  Nutzung: Verbrauch und Herstellungen ohne Rückgängig-Buchungen'


-- ─── Planung & Einkauf ohne Login: Rechte ───
set local role anon;
do $$
declare
  v_plan uuid;
  v_eintrag bigint;
  v_summe bigint := (select sum(anzahl) from bestand);
begin
  insert into plan (art, titel, datum, portionen, daten) values ('mahlzeit', 'Test Plan anon', heute() + 1, 2, '{"zutaten": []}')
  returning id into v_plan;
  update plan set datum = heute() + 2 where id = v_plan;
  insert into einkauf_eintrag (name, schluessel, menge, einheit, quelle, plan_id) values ('Tofu', 'tofu', 400, 'g', 'manuell', v_plan)
  returning id into v_eintrag;
  update einkauf_eintrag set menge = 200 where id = v_eintrag;
  insert into einkauf_status (schluessel, einheit, status) values ('tofu', 'g', 'zurueckgestellt');
  delete from einkauf_status where schluessel = 'tofu';
  delete from plan where id = v_plan;
  assert (select plan_id from einkauf_eintrag where id = v_eintrag) is null, 'Eintrag bleibt, Plan-Bezug weg';
  assert (select sum(anzahl) from bestand) = v_summe, 'Planen und Einkaufsliste ändern keinen Bestand';

  assert pg_temp.fehler(format('delete from einkauf_eintrag where id = %s', v_eintrag)) like 'permission denied%',
    'Einträge nicht löschbar (Status „geloescht“)';
  assert pg_temp.fehler($q$insert into einkauf_buchung (schluessel, einheit, block_typ_id, menge, bewegung_ids) values ('x', 'g', 1, 1, '{}')$q$)
    like 'permission denied%', 'Verlauf nur über einkauf_buchen()';
  assert pg_temp.fehler($q$select entnehme_posten('[]', null)$q$) like 'permission denied%', 'interne Funktion gesperrt';
  assert (select count(*) from nutzung) > 0, 'Nutzung lesbar';
end $$;
reset role;
\echo 'ok  Planung & Einkauf ohne Login: anlegen, ändern, entfernen – Buchungen nur über Funktionen'


-- ─── Kosten je Charge: Einkauf → Produktion → Essen, nichts doppelt ───
do $$
declare
  v_tom   bigint;
  v_basis bigint;
  v_reis  bigint;
  v_salz  bigint;
  v_buch  bigint;
  v_r     jsonb;
  v_m     bigint;
  v_h     bigint;
  v_summe bigint;
begin
  insert into block_typ (name, farbe, art, einheit, portion_menge, kcal) values ('Test K Tomaten', 'gruen', 'zutat', 'g', 100, 18)
  returning id into v_tom;
  insert into block_typ (name, farbe, art, einheit) values ('Test K Tomaten-Basis', 'rot', 'komponente', 'portion') returning id into v_basis;
  insert into block_typ (name, farbe, art, einheit, portion_menge, kosten_cent, kosten_menge, kcal)
  values ('Test K Reis', 'gelb', 'zutat', 'g', 75, 100, 1000, 350) returning id into v_reis;
  insert into block_typ (name, farbe, art, einheit) values ('Test K Gewürz', 'weiss', 'zutat', 'g') returning id into v_salz;

  -- Einkauf mit bezahltem Preis: 1 kg Tomaten für 3,00 €
  v_buch := einkaufen(v_tom, 1000, null, 300);
  assert (select array[preis_cent, menge] from einkauf_buchung where id = v_buch) = array[300, 1000], 'Einkauf gespeichert';
  assert (select direkt from einkauf_buchung where id = v_buch), 'direkt eingebucht';
  assert (select c.kosten_cent from charge c join bewegung b on b.charge_id = c.id
          where b.id = (select bewegung_ids[1] from einkauf_buchung where id = v_buch)) = 300, 'Charge kennt ihren Preis';
  assert (select array[kosten_cent, kosten_menge] from block_typ where id = v_tom) = array[300, 1000], 'Preis gelernt';
  assert not exists (select 1 from einkauf_status where schluessel = 'test k tomaten'), 'kein Eintrag auf der Einkaufsliste';

  -- Produktion: 480 g Tomaten → 6 Portionen Tomaten-Basis = 1,44 € (0,24 € je Portion)
  v_r := produzieren(jsonb_build_array(jsonb_build_object('block_typ_id', v_tom, 'menge', 480)), v_basis, 6, null, null, 0);
  v_h := (v_r->>'herstellung_id')::bigint;
  assert (v_r->>'kosten_cent')::int = 144, format('Produktionskosten %s', v_r);
  assert (select array[menge, kosten_cent, charge_kosten_cent, kosten_unbekannt] from herstellung where id = v_h) = array[6, 144, 144, 0],
    'Herstellung protokolliert';
  assert (select c.kosten_cent from charge c where c.id = (select charge_id from herstellung where id = v_h)) = 144, 'neue Charge mit Kosten';
  assert (select array[kosten_cent, kosten_menge] from block_typ where id = v_basis) = array[144, 6], 'Preis der Komponente = echte Kosten';
  assert (select anzahl from bestand where id = v_basis) = 6 and (select anzahl from bestand where id = v_tom) = 520, 'Bestand stimmt';

  -- Essen: 2 Portionen Tomaten-Basis = 0,48 € – die Tomaten werden NICHT noch einmal gezählt
  v_r := essen(jsonb_build_array(jsonb_build_object('block_typ_id', v_basis, 'menge', 2)), null, 'Test Sonnenpasta', 2);
  v_m := (v_r->>'mahlzeit_id')::bigint;
  assert (select array[kosten_cent, kosten_unbekannt] from mahlzeit where id = v_m) = array[48, 0], format('Verbrauchskosten %s', v_r);
  assert (select kcal is null and kcal_unbekannt = 1 from mahlzeit where id = v_m), 'kcal der Basis unbekannt – nicht 0';
  assert (select anzahl from bestand where id = v_tom) = 520, 'Tomaten bleiben unberührt';

  -- Sortenpreis ändert sich später → gegessen wird trotzdem zum Preis der Charge
  update block_typ set kosten_cent = 600, kosten_menge = 6 where id = v_basis;
  v_r := essen(jsonb_build_array(jsonb_build_object('block_typ_id', v_basis, 'menge', 1)), null, 'Test Rest', 1);
  assert (v_r->>'kosten_cent')::int = 24, format('Wert aus der Charge %s', v_r);

  -- Ohne Chargenpreis gilt der Sortenpreis; unbekannte Preise und kcal werden gezählt, nicht geschätzt
  perform einfrieren(v_reis, 500);
  perform einfrieren(v_salz, 50);
  v_r := essen(jsonb_build_array(
    jsonb_build_object('block_typ_id', v_reis, 'menge', 150),
    jsonb_build_object('block_typ_id', v_salz, 'menge', 5),
    jsonb_build_object('block_typ_id', v_tom, 'menge', 200)), null, 'Test Reispfanne', 2);
  -- Reis 150 g × 1,00 €/kg = 15 ct; Tomaten 200 g × 3,00 €/kg = 60 ct; Gewürz unbekannt
  assert (v_r->>'kosten_cent')::int = 75 and (v_r->>'kosten_unbekannt')::int = 1, format('teilweise bekannt %s', v_r);
  -- kcal: Reis 150 g × 350/100 = 525; Tomaten 200 g × 18/100 = 36; Gewürz unbekannt
  assert (v_r->>'kcal')::int = 561 and (v_r->>'kcal_unbekannt')::int = 1, format('kcal %s', v_r);

  -- Rückgängig: Bestand zurück, Protokoll markiert, nur einmal
  v_summe := (select sum(anzahl) from bestand);
  perform essen_rueckgaengig((v_r->>'mahlzeit_id')::bigint);
  assert (select sum(anzahl) from bestand) = v_summe + 355, 'Bestand wieder da';
  assert (select rueckgaengig from mahlzeit where id = (v_r->>'mahlzeit_id')::bigint), 'als rückgängig markiert';
  assert pg_temp.fehler(format('select essen_rueckgaengig(%s)', v_r->>'mahlzeit_id')) = 'Das wurde schon rückgängig gemacht.', 'nur einmal';
  assert pg_temp.fehler($q$select essen('[{"block_typ_id": 1, "menge": 1}]', null, '  ', 1)$q$) like 'Name des Gerichts fehlt%', 'Titel nötig';

  -- Produktion mit tatsächlicher (kleinerer) Menge und Zutaten, die nicht im Vorrat geführt werden
  v_r := produzieren(jsonb_build_array(jsonb_build_object('block_typ_id', v_tom, 'menge', 100)), v_basis, 7, null, null, 2);
  assert (v_r->>'kosten_cent') is null and (v_r->>'kosten_unbekannt')::int = 2, format('unvollständig bekannt %s', v_r);
  assert (select array[kosten_cent, kosten_menge] from block_typ where id = v_basis) = array[600, 6], 'Preis nicht aus unvollständigen Kosten gelernt';
  assert (select c.kosten_cent is null and c.menge_start = 7 from charge c
          where c.id = (select charge_id from herstellung where id = (v_r->>'herstellung_id')::bigint)), 'Charge: 7 Portionen, Kosten unbekannt';

  -- Aus der ersten Produktion wurde schon gegessen → nicht mehr rückgängig zu machen
  assert pg_temp.fehler(format('select produzieren_rueckgaengig(%s)', v_h)) like 'Aus dieser Charge wurde inzwischen%',
    'Produktion mit verbrauchter Charge bleibt';
  -- Unberührte Produktion: Rückgängig gibt Zutaten zurück und stellt den alten Preis wieder her
  v_summe := (select anzahl from bestand where id = v_tom);
  v_r := produzieren(jsonb_build_array(jsonb_build_object('block_typ_id', v_tom, 'menge', 100)), v_basis, 2, null, null, 0);
  assert (select array[kosten_cent, kosten_menge] from block_typ where id = v_basis) = array[30, 2], '100 g Tomaten = 0,30 € für 2 Portionen';
  perform produzieren_rueckgaengig((v_r->>'herstellung_id')::bigint);
  assert (select array[kosten_cent, kosten_menge] from block_typ where id = v_basis) = array[600, 6], 'alter Preis zurück';
  assert (select anzahl from bestand where id = v_tom) = v_summe, 'Tomaten zurück';
  assert pg_temp.fehler(format('select produzieren_rueckgaengig(%s)', v_r->>'herstellung_id')) = 'Das wurde schon rückgängig gemacht.', 'nur einmal';

  -- Einkauf direkt rückgängig: kommt nicht auf die Einkaufsliste
  v_buch := einkaufen(v_reis, 1000, null, 199);
  perform einkauf_rueckgaengig(v_buch);
  assert not exists (select 1 from einkauf_status where schluessel = 'test k reis'), 'kein „gekauft“-Eintrag';
  assert (select array[kosten_cent, kosten_menge] from block_typ where id = v_reis) = array[100, 1000], 'alter Preis zurück';
  assert pg_temp.fehler(format('select einkaufen(%s, 100, null, null)', v_reis)) like 'Bitte einen gültigen Preis%', 'Preis Pflicht';

  -- Einkaufsliste → Vorrat: Charge bekommt den bezahlten Preis
  insert into einkauf_status (schluessel, einheit, status) values ('test k reis', 'g', 'gekauft');
  v_buch := einkauf_buchen('test k reis', 'g', v_reis, 500, null, 120);
  assert (select c.kosten_cent from charge c join bewegung b on b.charge_id = c.id
          where b.id = (select bewegung_ids[1] from einkauf_buchung where id = v_buch)) = 120, 'Chargenpreis aus der Liste';

  -- View: Nährwerte, NULL bleibt NULL
  assert (select kcal from bestand where id = v_reis) = 350 and (select kcal from bestand where id = v_basis) is null, 'Nährwerte in der View';
end $$;
\echo 'ok  Kosten je Charge: Einkauf 3,00 € → Produktion 1,44 € → 2 Portionen 0,48 €, nichts doppelt; kcal nur aus Daten'


-- ─── Protokolle ohne Login: lesen ja, schreiben nur über Funktionen ───
set local role anon;
do $$
declare
  v_id bigint := (select id from block_typ where name = 'Test K Reis');
  v_r  jsonb;
begin
  assert (select count(*) from mahlzeit) >= 3 and (select count(*) from herstellung) >= 2, 'Protokolle lesbar';
  v_r := essen(jsonb_build_array(jsonb_build_object('block_typ_id', v_id, 'menge', 75)), null, 'Test anon', 1);
  perform essen_rueckgaengig((v_r->>'mahlzeit_id')::bigint);
  assert pg_temp.fehler($q$insert into mahlzeit (titel, portionen, bewegung_ids) values ('x', 1, '{}')$q$) like 'permission denied%',
    'Protokoll nicht direkt beschreibbar';
  assert pg_temp.fehler($q$update herstellung set kosten_cent = 0$q$) like 'permission denied%', 'Herstellung nicht änderbar';
  assert pg_temp.fehler($q$select wert_der_entnahme('{}')$q$) like 'permission denied%', 'interne Wertfunktion gesperrt';
  assert pg_temp.fehler($q$update charge set kosten_cent = 0$q$) like 'permission denied%', 'Chargenkosten nicht änderbar';
end $$;
reset role;
\echo 'ok  Protokolle ohne Login: lesen, essen() und Rückgängig – nichts direkt änderbar'


rollback;
\echo ''
\echo 'Alle Tests bestanden.'
