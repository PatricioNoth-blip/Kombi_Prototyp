-- Beispieldaten: 17 Sorten, je eine Charge vom Kochtag 27.09.2026.
-- Legt Sorten, Chargen und die passenden „kochtag“-Bewegungen in einem Schritt an.
-- Läuft nur einmal: ein zweiter Durchlauf scheitert an den eindeutigen Namen
-- und ändert nichts.

with daten (name, farbe, groesse_g, mindestbestand, haltbar_tage, kosten_cent, start_anzahl) as (
  values
    ('Tomatensoße',       'rot',   100, 6,  90,  17,  6),
    ('Curry-Basis Kokos', 'rot',   100, 4,  90,  33,  6),
    ('Linsen gekocht',    'braun', 100, 4,  90,   8,  6),
    ('Kichererbsen',      'braun', 100, 4,  90,   8,  6),
    ('Bohnen-Patty',      'braun',  80, 2,  90,  30,  4),
    ('TK-Gemüsemix',      'gruen', 100, 4, 180,  20, 10),
    ('TK-Spinat',         'gruen', 100, 2, 180,  22,  4),
    ('Brötchen',          'gelb',   80, 6,  90,  10, 12),
    ('Wrap',              'gelb',   60, 2,  90,   6,  4),
    ('Booster Italien',   'weiss',  30, 3,  90,  20,  6),
    ('Booster Indien',    'weiss',  30, 3,  90,  25,  6),
    ('Booster Mexiko',    'weiss',  30, 3,  90,  23,  6),
    ('Pizza',             'blau',  400, 2,  90, 150,  4),
    ('Linsensuppe',       'blau',  250, 3,  90,  50,  8),
    ('Lasagne-Portion',   'blau',  350, 2,  90,  85,  6),
    ('Burrito',           'blau',  250, 2,  90,  80,  8),
    ('Chili-Reis-Box',    'blau',  400, 2,  90, 100,  4)
),
typen as (
  insert into block_typ (name, farbe, groesse_g, mindestbestand, haltbar_tage, kosten_cent)
  select name, farbe, groesse_g, mindestbestand, haltbar_tage, kosten_cent from daten
  returning id, name
),
chargen as (
  insert into charge (block_typ_id, menge_start, menge_aktuell, eingefroren_am)
  select typen.id, daten.start_anzahl, daten.start_anzahl, date '2026-09-27'
  from daten join typen using (name)
  returning id, menge_start, eingefroren_am
)
insert into bewegung (charge_id, menge, art, datum)
select id, menge_start, 'kochtag', eingefroren_am from chargen;
