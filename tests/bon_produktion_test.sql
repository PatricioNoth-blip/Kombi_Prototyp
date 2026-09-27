-- Tests: Chargenkosten, Bon-Import und Produktion (Aufruf: npm test bzw. scripts/test.sh).
-- Erwartet eine Datenbank mit allen Migrationen + Seed. Alles läuft in einer Transaktion,
-- die am Ende zurückgerollt wird. Die Blöcke bauen aufeinander auf (Einkauf → Produktion → Essen).

\set ON_ERROR_STOP on
\set QUIET on
begin;

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

create function pg_temp.id(p_name text) returns bigint
language sql as $$ select id from block_typ where name = p_name $$;

create function pg_temp.da(p_name text) returns integer
language sql as $$ select anzahl from bestand where name = p_name $$;

-- ungefähr gleich (Kosten sind exakt gespeichert, Erwartungen hier auf 4 Nachkommastellen)
create function pg_temp.gleich(a numeric, b numeric) returns boolean
language sql as $$ select a is not null and b is not null and abs(a - b) < 0.001 $$;

create function pg_temp.bon(p_fp text, p_kaufdatum date, p_positionen jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('quelle', 'kassenbon', 'erkennung', 'test', 'fingerabdruck', p_fp,
                            'haendler', 'REWE', 'kaufdatum', p_kaufdatum, 'summe_cent', 0,
                            'positionen', p_positionen)
$$;

create function pg_temp.pos(p_nr integer, p_text text, p_sorte text, p_anzahl numeric, p_mpe numeric,
                            p_menge integer, p_preis integer, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object('nr', p_nr, 'bon_text', p_text, 'schluessel', lower(p_text), 'typ', 'lebensmittel',
                            'anzahl', p_anzahl, 'menge_pro_einheit', p_mpe, 'bestand_menge', p_menge,
                            'gesamtpreis_cent', p_preis, 'block_typ_id', pg_temp.id(p_sorte), 'sicherheit', 0.95)
         || p_extra
$$;

-- Testsorten
insert into block_typ (name, farbe, art, einheit, portion_menge, lagerort) values
  ('T Tomaten',      'gruen', 'zutat', 'g', 100, 'vorrat'),
  ('T Zwiebeln',     'gruen', 'zutat', 'g', 50,  'vorrat'),
  ('T Knoblauch',    'weiss', 'zutat', 'g', 5,   'vorrat'),
  ('T Naturjoghurt', 'weiss', 'zutat', 'g', 150, 'kuehlschrank'),
  ('T Käse',         'gelb',  'zutat', 'g', 50,  'kuehlschrank'),
  ('T Linsen',       'braun', 'zutat', 'g', 80,  'vorrat'),
  ('T Schokolade',   'schwarz', 'zutat', 'g', 25, 'vorrat');
insert into block_typ (name, farbe, art, einheit, lagerort, kosten_cent, kosten_menge) values
  ('T Kidneybohnen', 'braun', 'zutat', 'stueck', 'vorrat', 79, 1),
  ('T Vollkornbrot', 'gelb',  'zutat', 'stueck', 'vorrat', null, 1),
  ('T Mehl',         'gelb',  'zutat', 'g',      'vorrat', 79, 1000);
insert into block_typ (name, farbe, art, lagerort) values
  ('T Tomaten-Basis', 'rot',  'komponente',      'gefrierfach'),
  ('T TK-Pizza',      'blau', 'komplettgericht', 'gefrierfach'),
  ('T Linsensuppe',   'blau', 'komplettgericht', 'gefrierfach');


-- ─── Kosten an der Charge ───
do $$
declare
  v_ids bigint[];
begin
  assert (select bool_and(kosten_quelle = 'sortenpreis' and kosten_status = 'berechnet') from charge c
          join block_typ t on t.id = c.block_typ_id where t.name = 'Tomatensoße'),
    'Seed-Chargen tragen den Sortenpreis';
  assert (select c.kosten_cent from charge c join block_typ t on t.id = c.block_typ_id where t.name = 'Tomatensoße') = 17,
    'Tomatensoße: 17 ct pro Portion';

  -- Sortenpreis „0,79 € für 1000 g“ wird beim Einbuchen an die Charge geschrieben
  v_ids := einfrieren(pg_temp.id('T Mehl'), 1000);
  assert (select array[kosten_cent, kosten_menge] from charge where block_typ_id = pg_temp.id('T Mehl')) = array[79, 1000]::numeric[],
    'Mehl-Charge: 79 ct für 1000 g';
  -- spätere Preisänderung der Sorte ändert die alte Charge nicht
  update block_typ set kosten_cent = 99 where name = 'T Mehl';
  assert (select kosten_cent from charge where block_typ_id = pg_temp.id('T Mehl')) = 79, 'alte Charge behält ihren Preis';
  update block_typ set kosten_cent = 79 where name = 'T Mehl';

  -- ohne Preis bleibt es unbekannt
  perform einfrieren(pg_temp.id('T Käse'), 500);
  assert (select kosten_status from charge where block_typ_id = pg_temp.id('T Käse')) = 'unbekannt'
     and (select kosten_cent from charge where block_typ_id = pg_temp.id('T Käse')) is null, 'Käse: Preis unbekannt';

  -- Wert einer Entnahme aus der Charge: 250 g Mehl = 19,75 ct
  v_ids := entnehmen(pg_temp.id('T Mehl'), 250);
  assert pg_temp.gleich((select wert_cent from bewegung_kosten where bewegung_id = v_ids[1]), 19.75), '250 g Mehl = 19,75 ct';
  perform rueckgaengig(v_ids);

  assert pg_temp.fehler(format('update charge set kosten_cent = 5, kosten_menge = null where block_typ_id = %s', pg_temp.id('T Mehl')))
    like '%charge_kosten_vollstaendig%', 'Kosten ohne Bezugsmenge sind unmöglich';
end $$;
\echo 'ok  Chargenkosten: Sortenpreis beim Einbuchen, unbekannt bleibt unbekannt, Wert je Bewegung'


-- ─── Bon-Import: Einkauf ≠ Bestand, echte Preise, eigene Chargen ───
do $$
declare
  v_erg     jsonb;
  v_import  uuid;
  v_vorher  integer := (select count(*) from charge);
  v_bew     integer := (select count(*) from bewegung);
begin
  v_erg := bon_buchen(pg_temp.bon('fp-bon-1', heute() - 1, jsonb_build_array(
    pg_temp.pos(1, 'TOMATEN 1KG', 'T Tomaten', 1, 1000, 1000, 149, '{"packung_menge": 1000, "packung_einheit": "g"}'),
    -- 3 × 500 g gekauft, 2 übernommen
    pg_temp.pos(2, 'NATUR JOGHURT 500G', 'T Naturjoghurt', 3, 500, 1000, 237, '{"einzelpreis_cent": 79}'),
    -- Rabatt eindeutig zugeordnet: bezahlt 1,48 €
    pg_temp.pos(3, 'KIDNEYBOHNEN 400G', 'T Kidneybohnen', 2, 1, 2, 178, '{"rabatt_cent": 30}'),
    -- 0 übernommen, mit Begründung
    pg_temp.pos(4, 'SCHOKOLADE 100G', 'T Schokolade', 1, 100, 0, 129, '{"grund": "direkt_gegessen"}'),
    jsonb_build_object('nr', 5, 'bon_text', 'PFAND 0,25', 'schluessel', 'pfand', 'typ', 'pfand', 'gesamtpreis_cent', 25),
    jsonb_build_object('nr', 6, 'bon_text', 'WASCHMITTEL', 'schluessel', 'waschmittel', 'typ', 'nicht_lebensmittel',
                       'gesamtpreis_cent', 499),
    -- neues Produkt im selben Schritt
    jsonb_build_object('nr', 7, 'bon_text', 'HAFERDRINK BARISTA 1L', 'schluessel', 'haferdrink barista', 'typ', 'lebensmittel',
                       'anzahl', 1, 'menge_pro_einheit', 1000, 'bestand_menge', 1000, 'gesamtpreis_cent', 189,
                       'neu', jsonb_build_object('name', 'T Haferdrink Barista', 'art', 'zutat', 'farbe', 'weiss',
                                                 'lagerort', 'vorrat', 'einheit', 'ml')),
    -- Preis nicht lesbar → unbekannt, nicht geschätzt
    pg_temp.pos(8, 'VOLLKORN BROT', 'T Vollkornbrot', 1, 1, 1, null),
    -- Leergut und ein Rabatt auf den ganzen Einkauf: nur protokolliert
    jsonb_build_object('nr', 9, 'bon_text', 'LEERGUT', 'schluessel', 'leergut', 'typ', 'pfand', 'gesamtpreis_cent', -75),
    jsonb_build_object('nr', 10, 'bon_text', 'COUPON 10% EINKAUF', 'schluessel', 'coupon 10 einkauf', 'typ', 'rabatt',
                       'gesamtpreis_cent', -50, 'hinweis', 'Rabatt konnte nicht eindeutig zugeordnet werden')
  )));
  v_import := (v_erg ->> 'import_id')::uuid;

  assert (v_erg ->> 'hinzugefuegt')::integer = 5, format('5 Artikel hinzugefügt, ist %s', v_erg);
  assert (v_erg ->> 'nicht_uebernommen')::integer = 1, '1 Lebensmittel nicht übernommen';
  assert (v_erg ->> 'neue_sorten')::integer = 1, '1 neue Sorte';
  assert (select count(*) from charge) = v_vorher + 5, '5 neue Einkaufschargen';
  assert (select count(*) from bewegung) = v_bew + 5, '5 Bewegungen';

  assert pg_temp.da('T Tomaten') = 1000 and pg_temp.da('T Naturjoghurt') = 1000 and pg_temp.da('T Kidneybohnen') = 2
     and pg_temp.da('T Haferdrink Barista') = 1000 and pg_temp.da('T Vollkornbrot') = 1 and pg_temp.da('T Schokolade') = 0,
    'nur die bestätigten Mengen sind im Bestand';

  -- Tomaten: eigene Charge mit echtem Preis und Kaufdatum
  assert (select array[kosten_cent, kosten_menge] from charge where block_typ_id = pg_temp.id('T Tomaten')) = array[149, 1000]::numeric[],
    'Tomaten-Charge: 1,49 € für 1000 g';
  assert (select kosten_quelle = 'bon' and quelle = 'bon' and kosten_status = 'berechnet' and eingefroren_am = heute() - 1
          from charge where block_typ_id = pg_temp.id('T Tomaten')), 'Quelle Bon, Kaufdatum als Chargendatum';

  -- Joghurt: Einkauf 1500 g, Bestand 1000 g, Kosten anteilig 1,58 €
  assert (select entscheidung = 'teilweise' and bestand_kosten_cent = 158 from bon_position
          where import_id = v_import and nr = 2), 'Joghurt: teilweise, 1,58 €';
  assert (select array[kosten_cent, kosten_menge] from charge where block_typ_id = pg_temp.id('T Naturjoghurt')) = array[158, 1000]::numeric[],
    'Joghurt-Charge: 1,58 € für 1000 g';

  -- Rabatt: Endpreis 1,48 € für 2 Dosen, wird Referenzpreis der Sorte
  assert (select endpreis_cent from bon_position where import_id = v_import and nr = 3) = 148, 'Endpreis nach Rabatt';
  assert (select array[kosten_cent, kosten_menge] from charge where block_typ_id = pg_temp.id('T Kidneybohnen')) = array[148, 2]::numeric[],
    'Bohnen-Charge: 1,48 € für 2 Stück';
  assert (select array[kosten_cent, kosten_menge] from block_typ where name = 'T Kidneybohnen') = array[148, 2],
    'Sortenpreis = zuletzt bezahlt';

  assert (select kosten_status from charge where block_typ_id = pg_temp.id('T Vollkornbrot')) = 'unbekannt',
    'ohne Bon-Preis: unbekannt (nicht der Sortenpreis, nicht geschätzt)';
  assert (select herkunft = 'gekauft' and einheit = 'ml' from block_typ where name = 'T Haferdrink Barista'), 'neue Sorte angelegt';

  -- Pfand, Nicht-Lebensmittel, 0 übernommen: protokolliert, aber kein Bestand
  assert (select bool_and(bestand_menge = 0 and entscheidung = 'nicht' and charge_id is null and bewegung_ids = '{}')
          from bon_position where import_id = v_import and nr in (4, 5, 6)), 'Pfand/Waschmittel/Schokolade ohne Bestand';
  assert (select grund from bon_position where import_id = v_import and nr = 4) = 'direkt_gegessen', 'Begründung gespeichert';
  assert (select count(*) from bon_position where import_id = v_import) = 10, 'alle 10 Positionen protokolliert';
  assert (select endpreis_cent from bon_position where import_id = v_import and nr = 9) = -75, 'Leergut als negative Geldposition';
  assert (select status from bon_import where id = v_import) = 'gebucht', 'Import gebucht';

  -- Lernen: Schokolade wurde nicht übernommen, Tomaten schon
  assert (select nicht_uebernommen from bon_gewohnheit where schluessel = 'schokolade 100g') = 1, 'Gewohnheit: nicht übernommen';
  assert (select array[uebernommen::bigint, letzte_sorte] from bon_gewohnheit where schluessel = 'tomaten 1kg')
         = array[1, pg_temp.id('T Tomaten')], 'Gewohnheit: Tomaten → Sorte';
end $$;
\echo 'ok  Bon-Import: bestätigte Mengen, echte Preise, Rabatt, Teilmenge, 0, Pfand, Nicht-Lebensmittel, neues Produkt'


-- ─── Doppelimport und „alles oder nichts“ ───
do $$
declare
  v_chargen integer := (select count(*) from charge);
  v_importe integer := (select count(*) from bon_import);
  v_erg     jsonb;
  v_bon     jsonb := pg_temp.bon('fp-bon-1', heute() - 1, jsonb_build_array(
                       pg_temp.pos(1, 'TOMATEN 1KG', 'T Tomaten', 1, 1000, 1000, 149)));
begin
  assert pg_temp.fehler(format('select bon_buchen(%L::jsonb)', v_bon)) like 'Dieser Bon wurde am % schon importiert. Es wurde nichts gebucht.',
    'Doppelimport wird erkannt';
  assert (select count(*) from charge) = v_chargen and (select count(*) from bon_import) = v_importe, 'nichts gebucht';

  -- bewusst trotzdem (z. B. zweimal dasselbe gekauft) – und sofort wieder rückgängig
  v_erg := bon_buchen(v_bon, true);
  assert pg_temp.da('T Tomaten') = 2000, 'trotzdem gebucht';
  perform bon_rueckgaengig((v_erg ->> 'import_id')::uuid);
  assert pg_temp.da('T Tomaten') = 1000, 'wieder rückgängig';

  -- eine ungültige Position → der ganze Bon wird nicht gebucht
  assert pg_temp.fehler(format('select bon_buchen(%L::jsonb)', pg_temp.bon('fp-kaputt', heute(), jsonb_build_array(
    pg_temp.pos(1, 'ZWIEBELN 1KG', 'T Zwiebeln', 1, 1000, 1000, 99),
    jsonb_build_object('nr', 2, 'bon_text', 'WASCHMITTEL', 'schluessel', 'waschmittel', 'typ', 'nicht_lebensmittel',
                       'anzahl', 1, 'menge_pro_einheit', 1, 'bestand_menge', 1, 'block_typ_id', pg_temp.id('T Zwiebeln'))))))
    like 'Position 2 („WASCHMITTEL“) ist kein Lebensmittel%', 'Nicht-Lebensmittel kommt nie in den Bestand';
  assert pg_temp.fehler(format('select bon_buchen(%L::jsonb)', pg_temp.bon('fp-kaputt', heute(), jsonb_build_array(
    pg_temp.pos(1, 'ZWIEBELN 1KG', 'T Zwiebeln', 1, 1000, 1000, 99),
    jsonb_build_object('nr', 2, 'bon_text', 'GURKE', 'schluessel', 'gurke', 'typ', 'lebensmittel',
                       'anzahl', 1, 'menge_pro_einheit', 1, 'bestand_menge', 1)))))
    like 'Position 2 („GURKE“): Kein Produkt zugeordnet%', 'ohne Zuordnung nichts buchen';
  assert pg_temp.fehler(format('select bon_buchen(%L::jsonb)', pg_temp.bon('fp-kaputt', heute(), jsonb_build_array(
    pg_temp.pos(1, 'ZWIEBELN', 'T Zwiebeln', 1, null, 1000, 99)))))
    like 'Position 1 („ZWIEBELN“): Es fehlt, wie viel eine Einheit%', 'Menge pro Einheit muss bekannt sein';
  assert pg_temp.fehler(format('select bon_buchen(%L::jsonb)', pg_temp.bon('fp-kaputt', heute(), jsonb_build_array(
    pg_temp.pos(1, 'ZWIEBELN 1KG', 'T Zwiebeln', 1, 1000, 1000, 99, '{"rabatt_cent": 120}')))))
    like 'Position 1: Rabatt ist größer als der Preis%', 'Rabatt > Preis';
  assert pg_temp.da('T Zwiebeln') = 0 and (select count(*) from bon_import) = v_importe + 1, 'nichts wurde gebucht (nur der bewusste Doppel-Import von oben)';
end $$;
\echo 'ok  Doppelimport erkannt, bewusst trotzdem möglich; eine ungültige Position → nichts gebucht'


-- ─── FIFO mit Kosten: 500 g alt (0,60 €) + 1000 g neu (1,49 €) − 700 g ───
do $$
declare
  v_ids bigint[];
begin
  perform bon_buchen(pg_temp.bon('fp-bon-2', heute() - 10, jsonb_build_array(
    pg_temp.pos(1, 'TOMATEN 500G', 'T Tomaten', 1, 500, 500, 60),
    pg_temp.pos(2, 'ZWIEBELN 1KG', 'T Zwiebeln', 1, 1000, 1000, 99),
    pg_temp.pos(3, 'KNOBLAUCH 100G', 'T Knoblauch', 1, 100, 100, 59),
    pg_temp.pos(4, 'LINSEN ROT 500G', 'T Linsen', 1, 500, 500, 129))));
  assert pg_temp.da('T Tomaten') = 1500, 'Vorher 1000 g, +500 g, nachher 1500 g';
  assert (select count(*) from charge where block_typ_id = pg_temp.id('T Tomaten') and menge_aktuell > 0) = 2,
    'neue Tomaten bleiben eigene Charge';

  v_ids := entnehmen(pg_temp.id('T Tomaten'), 700);
  assert (select array_agg(-menge order by bewegung_id) from bewegung_kosten where bewegung_id = any(v_ids)) = array[500, 200],
    'FIFO: 500 g aus der alten, 200 g aus der neuen Charge';
  assert pg_temp.gleich((select sum(wert_cent) from bewegung_kosten where bewegung_id = any(v_ids)), 89.8),
    '0,60 € + 200 × 0,149 ct = 0,898 €';
  perform rueckgaengig(v_ids);
end $$;
\echo 'ok  FIFO mit Kosten: 700 g = 500 g × 0,12 ct + 200 g × 0,149 ct = 0,898 €'


-- ─── Produktion Komponente: Tomaten-Basis ───
do $$
declare
  v_erg  jsonb;
  v_prod uuid;
begin
  -- zu wenig Knoblauch → nichts wird entnommen und nichts eingebucht
  assert pg_temp.fehler(format($f$select produzieren(%s, '[{"block_typ_id": %s, "menge": 700}, {"block_typ_id": %s, "menge": 500}]', 6)$f$,
    pg_temp.id('T Tomaten-Basis'), pg_temp.id('T Tomaten'), pg_temp.id('T Knoblauch'))) like 'Nur noch 100 g%',
    'zu wenig → Fehler';
  assert pg_temp.da('T Tomaten') = 1500 and pg_temp.da('T Tomaten-Basis') = 0
     and not exists (select 1 from produktion where block_typ_id = pg_temp.id('T Tomaten-Basis')),
    'alles oder nichts';

  v_erg := produzieren(pg_temp.id('T Tomaten-Basis'), jsonb_build_array(
             jsonb_build_object('block_typ_id', pg_temp.id('T Tomaten'), 'menge', 700),
             jsonb_build_object('block_typ_id', pg_temp.id('T Zwiebeln'), 'menge', 150),
             jsonb_build_object('block_typ_id', pg_temp.id('T Knoblauch'), 'menge', 20)),
           6, 'gefrierfach', heute() + 90);
  v_prod := (v_erg ->> 'produktion_id')::uuid;

  -- 0,60 + 0,298 (Tomaten FIFO) + 0,1485 (Zwiebeln) + 0,118 (Knoblauch) = 1,1645 €
  assert pg_temp.gleich((v_erg ->> 'kosten_cent')::numeric, 116.45), format('Kosten 116,45 ct, ist %s', v_erg);
  assert v_erg ->> 'kosten_status' = 'berechnet', 'alle Preise bekannt';
  assert pg_temp.da('T Tomaten') = 800 and pg_temp.da('T Zwiebeln') = 850 and pg_temp.da('T Knoblauch') = 80,
    'Eingänge entnommen';
  assert pg_temp.da('T Tomaten-Basis') = 6, '6 Portionen Tomaten-Basis';
  assert (select count(*) from produktion_eingang where produktion_id = v_prod) = 4, 'Tomaten aus zwei Chargen → 4 Eingänge';
  assert pg_temp.gleich((select sum(wert_cent) from produktion_eingang where produktion_id = v_prod), 116.45), 'Kostenherkunft summiert sich';
  assert (select kosten_quelle = 'produktion' and quelle = 'produktion' and lagerort = 'gefrierfach' and kosten_menge = 6
             and pg_temp.gleich(kosten_cent, 116.45) and ablauf_am = heute() + 90
          from charge where id = (v_erg ->> 'charge_id')::bigint), 'Produktionscharge mit Kosten, Lagerort, Haltbarkeit';
  assert (select status = 'abgeschlossen' and art = 'komponente' and menge = 6 and not geplant
          from produktion where id = v_prod), 'Produktion abgeschlossen';
  assert (select array[kosten_cent, kosten_menge] from block_typ where name = 'T Tomaten-Basis') = array[116, 6],
    'Referenzpreis der Sorte: 1,16 € für 6 Portionen';
end $$;
\echo 'ok  Komponente produzieren: Eingänge FIFO entnommen, Kosten aus den verwendeten Chargen, neue Charge'


-- ─── Komplettgericht: TK-Pizza geplant → produziert, Komponente darin ohne Doppelzählung ───
do $$
declare
  v_prod    uuid;
  v_erg     jsonb;
  v_tomaten integer := pg_temp.da('T Tomaten');
  v_zutaten jsonb := jsonb_build_array(
                       jsonb_build_object('block_typ_id', pg_temp.id('T Tomaten-Basis'), 'menge', 2),
                       jsonb_build_object('block_typ_id', pg_temp.id('T Mehl'), 'menge', 300),
                       jsonb_build_object('block_typ_id', pg_temp.id('T Käse'), 'menge', 200));
begin
  insert into produktion (block_typ_id, geplant_fuer, geplante_menge, zutaten, lagerort)
  values (pg_temp.id('T TK-Pizza'), heute() + 1, 4, v_zutaten, 'gefrierfach')
  returning id into v_prod;
  assert (select art from produktion where id = v_prod) = 'komplettgericht', 'Art folgt der Sorte';
  assert pg_temp.da('T TK-Pizza') = 0 and pg_temp.da('T Tomaten-Basis') = 6 and pg_temp.da('T Käse') = 500,
    'Planen ändert keinen Bestand';

  v_erg := produzieren(pg_temp.id('T TK-Pizza'), v_zutaten, 4, 'gefrierfach', null, v_prod);
  assert (v_erg ->> 'produktion_id')::uuid = v_prod, 'geplante Produktion abgeschlossen';
  -- 2/6 von 116,45 = 38,8167 + 300 g Mehl 23,70 = 62,5167; Käse ohne Preis → teilweise
  assert v_erg ->> 'kosten_status' = 'teilweise', 'Käse unbekannt → teilweise';
  assert pg_temp.gleich((v_erg ->> 'kosten_cent')::numeric, 62.5167), format('bekannter Teil 62,52 ct, ist %s', v_erg);
  assert pg_temp.da('T TK-Pizza') = 4 and pg_temp.da('T Tomaten-Basis') = 4, '4 Pizzen, 2 Portionen Basis verbraucht';
  assert pg_temp.da('T Tomaten') = v_tomaten, 'Tomaten werden nicht noch einmal angefasst';
  assert not exists (select 1 from produktion_eingang where produktion_id = v_prod and block_typ_id = pg_temp.id('T Tomaten')),
    'keine Tomaten in der Pizza-Kostenherkunft – nur die Tomaten-Basis';
  assert pg_temp.gleich((select wert_cent from produktion_eingang where produktion_id = v_prod
                         and block_typ_id = pg_temp.id('T Tomaten-Basis')), 38.8167), 'Basis-Kosten aus ihrer Charge';
  assert (select kosten_cent from block_typ where name = 'T TK-Pizza') is null, 'teilweise Kosten werden kein Sortenpreis';
  assert (select geplante_menge = 4 and menge = 4 and geplant from produktion where id = v_prod), 'geplant und tatsächlich';
  assert pg_temp.fehler(format('select produzieren(%s, %L::jsonb, 4, null, null, %L)', pg_temp.id('T TK-Pizza'), v_zutaten, v_prod))
    like 'Diese Produktion ist schon abgeschlossen%', 'nicht doppelt abschließen';
end $$;
\echo 'ok  Komplettgericht produzieren: geplant → produziert, Komponente zählt nur mit ihrem Chargenwert'


-- ─── Suppe: geplant 8, tatsächlich 7 Portionen, im Kühlschrank ───
do $$
declare
  v_erg jsonb;
begin
  v_erg := produzieren(pg_temp.id('T Linsensuppe'), jsonb_build_array(
             jsonb_build_object('block_typ_id', pg_temp.id('T Linsen'), 'menge', 500),
             jsonb_build_object('block_typ_id', pg_temp.id('T Tomaten'), 'menge', 100)),
           7, 'kuehlschrank', heute() + 3, null, null, 8);
  -- 1,29 € + 100 × 0,149 ct = 1,439 € → 0,2056 € pro Portion bei 7 statt 8 Portionen
  assert pg_temp.gleich((v_erg ->> 'kosten_cent')::numeric, 143.9), 'Kosten 1,439 €';
  assert (select geplante_menge = 8 and menge = 7 from produktion where id = (v_erg ->> 'produktion_id')::uuid),
    'geplant 8, tatsächlich 7';
  assert (select menge_start = 7 and kosten_menge = 7 and lagerort = 'kuehlschrank' from charge
          where id = (v_erg ->> 'charge_id')::bigint), 'Charge mit 7 Portionen im Kühlschrank';
  assert pg_temp.gleich((select kosten_cent / kosten_menge from charge where id = (v_erg ->> 'charge_id')::bigint), 20.5571),
    'Kosten pro Portion aus der tatsächlichen Menge';
  assert (select lagerort from block_typ where name = 'T Linsensuppe') = 'gefrierfach', 'Lagerort der Sorte bleibt';
  assert pg_temp.da('T Linsensuppe') = 7, '7 Portionen im Bestand';
end $$;
\echo 'ok  Suppe: tatsächliche Menge 7 statt 8 bestimmt Charge und Kosten pro Portion, Lagerort je Charge'


-- ─── Essen: Portionen verbrauchen, FIFO über zwei Pizza-Chargen ───
do $$
declare
  v_erg jsonb;
  v_ids bigint[];
  v_a   bigint := (select id from charge where block_typ_id = pg_temp.id('T TK-Pizza'));
  v_basis integer;
begin
  update charge set eingefroren_am = heute() - 5 where id = v_a;  -- Charge A ist älter
  -- Charge B: 6 Pizzen ohne Käse, alle Preise bekannt
  v_erg := produzieren(pg_temp.id('T TK-Pizza'), jsonb_build_array(
             jsonb_build_object('block_typ_id', pg_temp.id('T Tomaten-Basis'), 'menge', 2),
             jsonb_build_object('block_typ_id', pg_temp.id('T Mehl'), 'menge', 300)), 6, 'gefrierfach');
  assert v_erg ->> 'kosten_status' = 'berechnet', 'Charge B vollständig berechnet';
  assert pg_temp.da('T TK-Pizza') = 10, 'Chargen A (4) + B (6)';
  v_basis := pg_temp.da('T Tomaten-Basis');

  v_ids := kochen(format('[{"block_typ_id": %s, "menge": 5}]', pg_temp.id('T TK-Pizza'))::jsonb);
  assert (select array_agg(-menge order by bewegung_id) from bewegung_kosten where bewegung_id = any(v_ids)) = array[4, 1],
    'FIFO: erst 4 aus Charge A, dann 1 aus Charge B';
  -- A: 4 × 62,5167/4 = 62,5167 (teilweise) · B: 1 × 62,5167/6 = 10,4194
  assert pg_temp.gleich((select sum(wert_cent) from bewegung_kosten where bewegung_id = any(v_ids)), 72.9361), 'Verbrauchswert FIFO';
  assert (select array_agg(kosten_status order by bewegung_id) from bewegung_kosten where bewegung_id = any(v_ids))
         = array['teilweise', 'berechnet'], 'Status je Charge bleibt sichtbar';
  assert pg_temp.da('T TK-Pizza') = 5, '5 Pizzen übrig';
  assert pg_temp.da('T Tomaten-Basis') = v_basis and pg_temp.da('T Mehl') = 400, 'Essen verbraucht keine Produktionszutaten';
end $$;
\echo 'ok  Komplettgericht essen: nur die Pizza-Charge sinkt, FIFO über Chargen mit eigenen Kosten'


-- ─── Kostenkette Zutat → Komponente → Komplettgericht → Verbrauch: nichts doppelt ───
do $$
declare
  v_tomaten_in_basis numeric;
  v_basis_charge     bigint := (select charge_id from produktion p where p.block_typ_id = pg_temp.id('T Tomaten-Basis')
                                 and status = 'abgeschlossen');
begin
  -- Wert der Basis-Charge = Summe ihrer Eingänge (Tomaten, Zwiebeln, Knoblauch)
  v_tomaten_in_basis := (select sum(e.wert_cent) from produktion_eingang e join produktion p on p.id = e.produktion_id
                         where p.block_typ_id = pg_temp.id('T Tomaten-Basis') and e.block_typ_id = pg_temp.id('T Tomaten'));
  assert pg_temp.gleich(v_tomaten_in_basis, 89.8), 'Tomaten stecken mit 0,898 € in der Basis';
  -- Beide Pizza-Produktionen nutzen je 2/6 Basis: zusammen 4/6 des Basis-Werts – nie mehr
  assert pg_temp.gleich((select sum(e.wert_cent) from produktion_eingang e join produktion p on p.id = e.produktion_id
                         where p.block_typ_id = pg_temp.id('T TK-Pizza') and e.block_typ_id = pg_temp.id('T Tomaten-Basis')),
                        116.45 * 4 / 6), 'Basis anteilig verbraucht';
  assert (select count(*) from produktion_eingang e join bewegung b on b.id = e.bewegung_id
          join charge c on c.id = b.charge_id where c.id = v_basis_charge) = 2, 'zwei Entnahmen aus der Basis-Charge';
end $$;
\echo 'ok  Kostenkette: Tomaten → Tomaten-Basis → TK-Pizza → Essen, jeder Anteil genau einmal'


-- ─── Rückgängig: Produktion und Bon-Import ───
do $$
declare
  v_suppe  uuid := (select id from produktion where block_typ_id = pg_temp.id('T Linsensuppe'));
  v_pizza  uuid := (select id from produktion where block_typ_id = pg_temp.id('T TK-Pizza') and geplant);
  v_plan   uuid;
  v_erg    jsonb;
  v_import uuid;
begin
  -- Suppe: nichts gegessen → komplett zurück
  perform produktion_rueckgaengig(v_suppe);
  assert pg_temp.da('T Linsensuppe') = 0 and pg_temp.da('T Linsen') = 500 and pg_temp.da('T Tomaten') = 800,
    'Suppe weg, Linsen und Tomaten zurück';
  assert (select status from produktion where id = v_suppe) = 'rueckgaengig', 'direkt produziert → rückgängig';
  assert not exists (select 1 from produktion_eingang where produktion_id = v_suppe), 'Kostenherkunft entfernt';
  assert pg_temp.fehler(format('select produktion_rueckgaengig(%L)', v_suppe)) like 'Diese Produktion ist nicht abgeschlossen%',
    'nur einmal';

  -- Pizza A wurde schon gegessen → Rückgängig nicht möglich, nichts ändert sich
  assert pg_temp.fehler(format('select produktion_rueckgaengig(%L)', v_pizza)) like 'Aus dieser Charge wurde inzwischen schon entnommen%',
    'nach dem Essen kein Rückgängig';
  assert (select status from produktion where id = v_pizza) = 'abgeschlossen', 'Pizza bleibt abgeschlossen';

  -- geplante Produktion abschließen und zurücknehmen → wieder geplant, Preis zurück
  insert into plan (art, titel, portionen, daten) values ('komponente', 'T Tomaten-Basis', 6, '{}') returning id into v_plan;
  insert into produktion (block_typ_id, geplante_menge, zutaten, plan_id)
  values (pg_temp.id('T Tomaten-Basis'), 3, format('[{"block_typ_id": %s, "menge": 300}]', pg_temp.id('T Tomaten'))::jsonb, v_plan);
  v_erg := produzieren(pg_temp.id('T Tomaten-Basis'), format('[{"block_typ_id": %s, "menge": 300}]', pg_temp.id('T Tomaten'))::jsonb,
                       3, null, null, (select id from produktion where plan_id = v_plan));
  assert (select status from plan where id = v_plan) = 'erledigt', 'Plan erledigt';
  assert (select array[kosten_cent, kosten_menge] from block_typ where name = 'T Tomaten-Basis') = array[45, 3],
    'neuer Referenzpreis 300 × 0,149 ct';
  perform produktion_rueckgaengig((v_erg ->> 'produktion_id')::uuid);
  assert (select status from produktion where id = (v_erg ->> 'produktion_id')::uuid) = 'geplant', 'wieder geplant';
  assert (select status from plan where id = v_plan) = 'geplant', 'Plan wieder offen';
  assert (select array[kosten_cent, kosten_menge] from block_typ where name = 'T Tomaten-Basis') = array[116, 6],
    'Referenzpreis zurück';
  assert pg_temp.da('T Tomaten') = 800, 'Tomaten zurück';

  -- Bon-Import 1: aus der Tomaten-Charge wurde produziert → kein Rückgängig, nichts ändert sich
  v_import := (select id from bon_import where fingerabdruck = 'fp-bon-1' and status = 'gebucht');
  assert pg_temp.fehler(format('select bon_rueckgaengig(%L)', v_import)) like 'Aus dieser Charge wurde inzwischen schon entnommen%',
    'nach Verbrauch kein Rückgängig';
  assert pg_temp.da('T Naturjoghurt') = 1000 and (select status from bon_import where id = v_import) = 'gebucht', 'unverändert';

  -- neuer Bon → ganzer Import mit einer Aktion rückgängig, Preis zurück
  v_erg := bon_buchen(pg_temp.bon('fp-bon-3', heute(), jsonb_build_array(
    pg_temp.pos(1, 'KIDNEYBOHNEN', 'T Kidneybohnen', 3, 1, 3, 267),
    pg_temp.pos(2, 'NATUR JOGHURT 500G', 'T Naturjoghurt', 1, 500, 500, 89))));
  assert pg_temp.da('T Kidneybohnen') = 5 and pg_temp.da('T Naturjoghurt') = 1500, 'gebucht';
  perform bon_rueckgaengig((v_erg ->> 'import_id')::uuid);
  assert pg_temp.da('T Kidneybohnen') = 2 and pg_temp.da('T Naturjoghurt') = 1000, 'ganzer Import zurück';
  assert (select array[kosten_cent, kosten_menge] from block_typ where name = 'T Kidneybohnen') = array[148, 2],
    'Sortenpreis zurück auf den vorherigen';
  assert (select status from bon_import where id = (v_erg ->> 'import_id')::uuid) = 'rueckgaengig', 'Status rückgängig';
  assert pg_temp.fehler(format('select bon_rueckgaengig(%L)', v_erg ->> 'import_id')) = 'Das wurde schon rückgängig gemacht.',
    'nur einmal';

  -- Wer den Preis inzwischen selbst geändert hat, behält seinen Preis
  v_erg := bon_buchen(pg_temp.bon('fp-bon-4', heute(), jsonb_build_array(pg_temp.pos(1, 'KIDNEYBOHNEN', 'T Kidneybohnen', 1, 1, 1, 99))));
  update block_typ set kosten_cent = 55, kosten_menge = 1 where name = 'T Kidneybohnen';
  perform bon_rueckgaengig((v_erg ->> 'import_id')::uuid);
  assert (select kosten_cent from block_typ where name = 'T Kidneybohnen') = 55, 'eigene Preisänderung bleibt';
end $$;
\echo 'ok  Rückgängig: Produktion (auch geplante) und ganzer Bon-Import – nie nach Verbrauch, Preise sauber zurück'


-- ─── Fehlerfälle Produktion ───
do $$
begin
  assert pg_temp.fehler(format($f$select produzieren(%s, '[]', 1)$f$, pg_temp.id('T Tomaten')))
    = 'Produziert werden Komponenten und Komplettgerichte – „T Tomaten“ ist eine Zutat.', 'Zutat wird nicht produziert';
  assert pg_temp.fehler(format($f$select produzieren(%s, '[{"block_typ_id": %s, "menge": 1}]', 2)$f$,
    pg_temp.id('T TK-Pizza'), pg_temp.id('T TK-Pizza'))) like 'Eine Sorte kann nicht aus sich selbst produziert werden%', 'kein Kreis';
  assert pg_temp.fehler(format($f$select produzieren(%s, '[]', 0)$f$, pg_temp.id('T TK-Pizza')))
    like 'Die tatsächliche Menge muss mindestens 1 sein%', 'Menge ≥ 1';
  assert pg_temp.fehler(format($f$select produzieren(%s, '[{"block_typ_id": %s, "menge": 0}]', 1)$f$,
    pg_temp.id('T TK-Pizza'), pg_temp.id('T Mehl'))) like 'Jeder Eingang braucht%', 'Eingang ≥ 1';
  assert pg_temp.fehler(format($f$select produzieren(%s, '[]', 1, 'keller')$f$, pg_temp.id('T TK-Pizza')))
    like 'Unbekannter Lagerort%', 'Lagerort geprüft';
end $$;
\echo 'ok  Produktion: Zutaten, Kreise, Menge 0 und unbekannte Lagerorte werden abgelehnt'


-- ─── Rechte ohne Login ───
set local role anon;
do $$
declare
  v_prod uuid;
  v_erg  jsonb;
begin
  perform count(*) from bon_import;
  perform count(*) from bon_position;
  perform count(*) from bon_gewohnheit;
  perform count(*) from bewegung_kosten;
  perform count(*) from produktion_eingang;

  assert pg_temp.fehler($q$insert into bon_import (quelle, fingerabdruck) values ('text', 'abcdefgh')$q$) like 'permission denied%',
    'Bon-Importe nur über bon_buchen()';
  assert pg_temp.fehler('update charge set kosten_cent = 1, kosten_menge = 1') like 'permission denied%',
    'Chargenkosten nicht direkt änderbar';
  assert pg_temp.fehler($q$select preise_zuruecksetzen('[]')$q$) like 'permission denied%', 'interne Funktion gesperrt';

  -- Planen darf die App – Ergebnisse nicht
  insert into produktion (block_typ_id, geplante_menge, zutaten)
  values ((select id from block_typ where name = 'T Linsensuppe'), 8, '[]') returning id into v_prod;
  update produktion set geplante_menge = 6, geplant_fuer = heute() + 2 where id = v_prod;
  assert pg_temp.fehler(format('update produktion set charge_id = 1 where id = %L', v_prod)) like 'permission denied%',
    'Ergebnisfelder gesperrt';
  assert pg_temp.fehler(format($q$update produktion set status = 'abgeschlossen' where id = %L$q$, v_prod))
    like 'new row violates row-level security policy%', 'Abschließen nur über produzieren()';
  assert pg_temp.fehler($q$insert into produktion (block_typ_id, status) values (1, 'abgeschlossen')$q$) like 'permission denied%',
    'kein abgeschlossener Datensatz von außen';
  assert pg_temp.fehler(format('delete from produktion where id = %L', v_prod)) like 'permission denied%', 'nicht löschbar';
  assert pg_temp.fehler(format($q$insert into produktion (block_typ_id) values (%s)$q$,
    (select id from block_typ where name = 'T Mehl'))) like 'Produziert werden Komponenten%', 'Zutat nicht planbar';
  update produktion set status = 'verworfen' where id = v_prod;
  assert pg_temp.fehler(format($q$update produktion set status = 'geplant' where id = %L$q$, v_prod)) is null
     and (select status from produktion where id = v_prod) = 'verworfen', 'verworfene Planung bleibt verworfen';

  -- Buchungsfunktionen darf die App aufrufen
  v_erg := bon_buchen(jsonb_build_object('quelle', 'text', 'fingerabdruck', 'fp-anon-1', 'positionen', jsonb_build_array(
    jsonb_build_object('nr', 1, 'bon_text', 'MEHL 1KG', 'schluessel', 'mehl 1kg', 'typ', 'lebensmittel', 'anzahl', 1,
                       'menge_pro_einheit', 1000, 'bestand_menge', 1000, 'gesamtpreis_cent', 79,
                       'block_typ_id', (select id from block_typ where name = 'T Mehl')))));
  perform bon_rueckgaengig((v_erg ->> 'import_id')::uuid);
  v_erg := produzieren((select id from block_typ where name = 'T Linsensuppe'),
                       jsonb_build_array(jsonb_build_object('block_typ_id', (select id from block_typ where name = 'T Linsen'), 'menge', 100)), 2);
  perform produktion_rueckgaengig((v_erg ->> 'produktion_id')::uuid);
end $$;
reset role;
\echo 'ok  Rechte ohne Login: lesen, planen, Funktionen aufrufen – Kosten, Importe und Ergebnisse nur über Funktionen'


rollback;
\echo ''
\echo 'Alle Tests (Bon-Import & Produktion) bestanden.'
