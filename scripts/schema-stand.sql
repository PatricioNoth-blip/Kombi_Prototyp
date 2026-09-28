select
  e.migration,
  case when bool_and(e.vorhanden) then 'komplett'
       when bool_or(e.vorhanden) then 'teilweise'
       else 'fehlt' end as status,
  count(*) filter (where e.vorhanden) || ' / ' || count(*) as objekte,
  coalesce(string_agg(e.art || ' ' || e.objekt, ', ' order by e.art, e.objekt) filter (where not e.vorhanden), '-') as fehlt
from (
  select v.migration, v.art, v.objekt,
    case v.art
      when 'tabelle' then exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = v.objekt and c.relkind in ('r', 'p'))
      when 'view' then exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = v.objekt and c.relkind in ('v', 'm'))
      when 'spalte' then exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = split_part(v.objekt, '.', 1) and column_name = split_part(v.objekt, '.', 2))
      when 'funktion' then exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname || '(' || oidvectortypes(p.proargtypes) || ')' = v.objekt)
      when 'funktion_name' then exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v.objekt)
      when 'funktion_inhalt' then exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = split_part(v.objekt, '~', 1)
          and strpos(p.prosrc, split_part(v.objekt, '~', 2)) > 0)
      when 'trigger' then exists (
        select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = split_part(v.objekt, '.', 1) and t.tgname = split_part(v.objekt, '.', 2))
      when 'fk' then exists (
        select 1 from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
        join pg_class z on z.oid = k.confrelid
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
        where k.contype = 'f' and n.nspname = 'public' and c.relname || '.' || a.attname || '>' || z.relname = v.objekt)
      when 'rls' then exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = v.objekt and c.relrowsecurity)
      when 'policy' then exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = split_part(v.objekt, ':', 1)
          and p.policyname = substr(v.objekt, strpos(v.objekt, ':') + 1))
      when 'policy_anon' then exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = split_part(v.objekt, ':', 1)
          and p.policyname = substr(v.objekt, strpos(v.objekt, ':') + 1) and 'anon' = any (p.roles))
      when 'recht' then coalesce(has_table_privilege('anon',
        to_regclass('public.' || split_part(v.objekt, ':', 2)), split_part(v.objekt, ':', 1)), false)
      when 'ausfuehren' then coalesce(has_function_privilege('anon',
        to_regprocedure('public.' || v.objekt), 'execute'), false)
      when 'bucket' then case when to_regclass('storage.buckets') is null then false
        else length(query_to_xml('select 1 from storage.buckets where id = ' || quote_literal(v.objekt), false, true, '')::text) > 0 end
    end as vorhanden
  from (values
  ('20260927120000_inventar', 'tabelle', 'block_typ'), ('20260927120000_inventar', 'tabelle', 'charge'), ('20260927120000_inventar', 'tabelle', 'bewegung'), ('20260927120000_inventar', 'view', 'bestand'), ('20260927120000_inventar', 'funktion', 'heute()'), ('20260927120000_inventar', 'funktion', 'pruefe_charge_bewegungen()'), ('20260927120000_inventar', 'funktion_name', 'einfrieren'), ('20260927120000_inventar', 'funktion', 'entnehmen(bigint, integer)'),
  ('20260927120000_inventar', 'funktion', 'rueckgaengig(bigint[])'), ('20260927120000_inventar', 'trigger', 'charge.charge_bewegungen_pruefen'), ('20260927120000_inventar', 'trigger', 'bewegung.bewegung_pruefen'), ('20260927120000_inventar', 'fk', 'charge.block_typ_id>block_typ'), ('20260927120000_inventar', 'fk', 'bewegung.charge_id>charge'), ('20260927120000_inventar', 'fk', 'bewegung.storno_von>bewegung'), ('20260927120000_inventar', 'rls', 'block_typ'), ('20260927120000_inventar', 'rls', 'charge'),
  ('20260927120000_inventar', 'rls', 'bewegung'), ('20260927120000_inventar', 'policy', 'block_typ:WG liest Sorten'), ('20260927120000_inventar', 'policy', 'block_typ:WG legt Sorten an'), ('20260927120000_inventar', 'policy', 'block_typ:WG bearbeitet Sorten'), ('20260927120000_inventar', 'policy', 'charge:WG liest Chargen'), ('20260927120000_inventar', 'policy', 'bewegung:WG liest Bewegungen'),
  ('20260927180000_ohne_login', 'recht', 'select:block_typ'), ('20260927180000_ohne_login', 'recht', 'insert:block_typ'), ('20260927180000_ohne_login', 'recht', 'update:block_typ'), ('20260927180000_ohne_login', 'recht', 'select:charge'), ('20260927180000_ohne_login', 'recht', 'select:bewegung'), ('20260927180000_ohne_login', 'recht', 'select:bestand'), ('20260927180000_ohne_login', 'ausfuehren', 'heute()'), ('20260927180000_ohne_login', 'ausfuehren', 'entnehmen(bigint,integer)'),
  ('20260927180000_ohne_login', 'ausfuehren', 'rueckgaengig(bigint[])'), ('20260927180000_ohne_login', 'policy_anon', 'block_typ:WG liest Sorten'), ('20260927180000_ohne_login', 'policy_anon', 'block_typ:WG legt Sorten an'), ('20260927180000_ohne_login', 'policy_anon', 'block_typ:WG bearbeitet Sorten'), ('20260927180000_ohne_login', 'policy_anon', 'charge:WG liest Chargen'), ('20260927180000_ohne_login', 'policy_anon', 'bewegung:WG liest Bewegungen'),
  ('20260928090000_was_essen', 'spalte', 'block_typ.lagerort'), ('20260928090000_was_essen', 'spalte', 'bestand.lagerort'), ('20260928090000_was_essen', 'tabelle', 'koch_session'), ('20260928090000_was_essen', 'tabelle', 'vorschlag'), ('20260928090000_was_essen', 'tabelle', 'vorschlag_feedback'), ('20260928090000_was_essen', 'tabelle', 'rezept'), ('20260928090000_was_essen', 'fk', 'vorschlag.session_id>koch_session'), ('20260928090000_was_essen', 'fk', 'vorschlag_feedback.vorschlag_id>vorschlag'),
  ('20260928090000_was_essen', 'fk', 'rezept.vorschlag_id>vorschlag'), ('20260928090000_was_essen', 'rls', 'koch_session'), ('20260928090000_was_essen', 'rls', 'vorschlag'), ('20260928090000_was_essen', 'rls', 'vorschlag_feedback'), ('20260928090000_was_essen', 'rls', 'rezept'), ('20260928090000_was_essen', 'policy', 'koch_session:App liest Sessions'), ('20260928090000_was_essen', 'policy', 'koch_session:App legt Sessions an'), ('20260928090000_was_essen', 'policy', U&'vorschlag:App liest Vorschl\00e4ge'),
  ('20260928090000_was_essen', 'policy', U&'vorschlag:App legt Vorschl\00e4ge an'), ('20260928090000_was_essen', 'policy', 'vorschlag_feedback:App liest Feedback'), ('20260928090000_was_essen', 'policy', 'vorschlag_feedback:App legt Feedback an'), ('20260928090000_was_essen', 'policy', 'rezept:App liest Rezepte'), ('20260928090000_was_essen', 'policy', 'rezept:App speichert Rezepte'), ('20260928090000_was_essen', 'recht', 'select:vorschlag'), ('20260928090000_was_essen', 'recht', 'insert:vorschlag'), ('20260928090000_was_essen', 'recht', 'insert:rezept'),
  ('20260929090000_baukasten', 'spalte', 'block_typ.art'), ('20260929090000_baukasten', 'spalte', 'block_typ.herkunft'), ('20260929090000_baukasten', 'spalte', 'block_typ.einheit'), ('20260929090000_baukasten', 'spalte', 'block_typ.portion_menge'), ('20260929090000_baukasten', 'spalte', 'block_typ.kosten_menge'), ('20260929090000_baukasten', 'spalte', 'block_typ.zusammensetzung'), ('20260929090000_baukasten', 'spalte', 'block_typ.notiz'), ('20260929090000_baukasten', 'spalte', 'charge.ablauf_am'),
  ('20260929090000_baukasten', 'spalte', 'charge.geoeffnet_am'), ('20260929090000_baukasten', 'spalte', 'rezept.gerichtstyp'), ('20260929090000_baukasten', 'spalte', 'rezept.zutaten'), ('20260929090000_baukasten', 'spalte', 'rezept.schritte'), ('20260929090000_baukasten', 'spalte', 'rezept.kosten_status'), ('20260929090000_baukasten', 'spalte', 'bestand.naechster_ablauf'), ('20260929090000_baukasten', 'spalte', 'bestand.geoeffnet'), ('20260929090000_baukasten', 'spalte', 'bestand.abgelaufen'),
  ('20260929090000_baukasten', 'funktion', 'menge_text(integer, text)'), ('20260929090000_baukasten', 'funktion', 'einfrieren(bigint, integer, date)'), ('20260929090000_baukasten', 'funktion_inhalt', 'entnehmen~menge_text'), ('20260929090000_baukasten', 'funktion', 'setze_geoeffnet(bigint, boolean)'), ('20260929090000_baukasten', 'funktion', 'setze_ablauf(bigint, date)'), ('20260929090000_baukasten', 'ausfuehren', 'einfrieren(bigint,integer,date)'), ('20260929090000_baukasten', 'ausfuehren', 'setze_geoeffnet(bigint,boolean)'), ('20260929090000_baukasten', 'ausfuehren', 'setze_ablauf(bigint,date)'),
  ('20260930090000_planung_einkauf', 'spalte', 'block_typ.gerichtstypen'), ('20260930090000_planung_einkauf', 'spalte', 'block_typ.richtung'), ('20260930090000_planung_einkauf', 'tabelle', 'plan'), ('20260930090000_planung_einkauf', 'tabelle', 'einkauf_eintrag'), ('20260930090000_planung_einkauf', 'tabelle', 'einkauf_status'), ('20260930090000_planung_einkauf', 'tabelle', 'einkauf_buchung'), ('20260930090000_planung_einkauf', 'tabelle', 'auftauen'), ('20260930090000_planung_einkauf', 'view', 'nutzung'),
  ('20260930090000_planung_einkauf', 'spalte', 'bestand.start_menge'), ('20260930090000_planung_einkauf', 'spalte', 'bestand.aufgetaut'), ('20260930090000_planung_einkauf', 'spalte', 'bestand.auftauen_geplant'), ('20260930090000_planung_einkauf', 'funktion', 'entnehme_posten(jsonb, uuid)'), ('20260930090000_planung_einkauf', 'funktion', 'kochen(jsonb, uuid)'), ('20260930090000_planung_einkauf', 'funktion', 'herstellen(jsonb, bigint, integer, date, uuid)'), ('20260930090000_planung_einkauf', 'funktion', 'kochen_rueckgaengig(bigint[], uuid)'), ('20260930090000_planung_einkauf', 'funktion', 'einkauf_buchen(text, text, bigint, integer, date, integer)'),
  ('20260930090000_planung_einkauf', 'funktion', 'einkauf_rueckgaengig(bigint)'), ('20260930090000_planung_einkauf', 'fk', 'einkauf_eintrag.block_typ_id>block_typ'), ('20260930090000_planung_einkauf', 'fk', 'einkauf_eintrag.plan_id>plan'), ('20260930090000_planung_einkauf', 'fk', 'einkauf_buchung.block_typ_id>block_typ'), ('20260930090000_planung_einkauf', 'fk', 'auftauen.block_typ_id>block_typ'), ('20260930090000_planung_einkauf', 'fk', 'auftauen.plan_id>plan'), ('20260930090000_planung_einkauf', 'rls', 'plan'), ('20260930090000_planung_einkauf', 'rls', 'einkauf_eintrag'),
  ('20260930090000_planung_einkauf', 'rls', 'einkauf_status'), ('20260930090000_planung_einkauf', 'rls', 'einkauf_buchung'), ('20260930090000_planung_einkauf', 'rls', 'auftauen'), ('20260930090000_planung_einkauf', 'policy', U&'plan:App liest Pl\00e4ne'), ('20260930090000_planung_einkauf', 'policy', U&'plan:App legt Pl\00e4ne an'), ('20260930090000_planung_einkauf', 'policy', U&'plan:App \00e4ndert Pl\00e4ne'), ('20260930090000_planung_einkauf', 'policy', U&'plan:App entfernt Pl\00e4ne'), ('20260930090000_planung_einkauf', 'policy', 'einkauf_eintrag:App liest Einkauf'),
  ('20260930090000_planung_einkauf', 'policy', 'einkauf_eintrag:App legt Einkauf an'), ('20260930090000_planung_einkauf', 'policy', U&'einkauf_eintrag:App \00e4ndert Einkauf'), ('20260930090000_planung_einkauf', 'policy', 'einkauf_status:App liest Einkaufsstatus'), ('20260930090000_planung_einkauf', 'policy', 'einkauf_status:App setzt Einkaufsstatus'), ('20260930090000_planung_einkauf', 'policy', U&'einkauf_status:App \00e4ndert Einkaufsstatus'), ('20260930090000_planung_einkauf', 'policy', U&'einkauf_status:App l\00f6scht Einkaufsstatus'), ('20260930090000_planung_einkauf', 'policy', 'einkauf_buchung:App liest Einkaufsverlauf'), ('20260930090000_planung_einkauf', 'policy', 'auftauen:App liest Auftauen'),
  ('20260930090000_planung_einkauf', 'policy', 'auftauen:App plant Auftauen'), ('20260930090000_planung_einkauf', 'policy', U&'auftauen:App \00e4ndert Auftauen'), ('20260930090000_planung_einkauf', 'recht', 'select:plan'), ('20260930090000_planung_einkauf', 'recht', 'select:nutzung'), ('20260930090000_planung_einkauf', 'ausfuehren', 'kochen(jsonb,uuid)'), ('20260930090000_planung_einkauf', 'ausfuehren', 'herstellen(jsonb,bigint,integer,date,uuid)'),
  ('20261001090000_kosten_naehrwerte', 'spalte', 'block_typ.kcal'), ('20261001090000_kosten_naehrwerte', 'spalte', 'block_typ.protein_g'), ('20261001090000_kosten_naehrwerte', 'spalte', 'block_typ.kohlenhydrate_g'), ('20261001090000_kosten_naehrwerte', 'spalte', 'block_typ.fett_g'), ('20261001090000_kosten_naehrwerte', 'spalte', 'block_typ.naehrwert_menge'), ('20261001090000_kosten_naehrwerte', 'spalte', 'charge.kosten_cent'), ('20261001090000_kosten_naehrwerte', 'spalte', 'einkauf_buchung.direkt'), ('20261001090000_kosten_naehrwerte', 'spalte', 'bestand.kcal'),
  ('20261001090000_kosten_naehrwerte', 'tabelle', 'mahlzeit'), ('20261001090000_kosten_naehrwerte', 'tabelle', 'herstellung'), ('20261001090000_kosten_naehrwerte', 'funktion', 'wert_der_entnahme(bigint[])'), ('20261001090000_kosten_naehrwerte', 'funktion', 'essen(jsonb, uuid, text, integer)'), ('20261001090000_kosten_naehrwerte', 'funktion', 'essen_rueckgaengig(bigint)'), ('20261001090000_kosten_naehrwerte', 'funktion', 'produzieren(jsonb, bigint, integer, date, uuid, integer)'), ('20261001090000_kosten_naehrwerte', 'funktion', 'produzieren_rueckgaengig(bigint)'), ('20261001090000_kosten_naehrwerte', 'funktion', 'einkaufen(bigint, integer, date, integer)'),
  ('20261001090000_kosten_naehrwerte', 'funktion_inhalt', 'einkauf_buchen~update charge set kosten_cent'), ('20261001090000_kosten_naehrwerte', 'fk', 'mahlzeit.plan_id>plan'), ('20261001090000_kosten_naehrwerte', 'fk', 'herstellung.block_typ_id>block_typ'), ('20261001090000_kosten_naehrwerte', 'fk', 'herstellung.plan_id>plan'), ('20261001090000_kosten_naehrwerte', 'fk', 'herstellung.charge_id>charge'), ('20261001090000_kosten_naehrwerte', 'rls', 'mahlzeit'), ('20261001090000_kosten_naehrwerte', 'rls', 'herstellung'), ('20261001090000_kosten_naehrwerte', 'policy', 'mahlzeit:App liest Mahlzeiten'),
  ('20261001090000_kosten_naehrwerte', 'policy', 'herstellung:App liest Herstellungen'), ('20261001090000_kosten_naehrwerte', 'recht', 'select:mahlzeit'), ('20261001090000_kosten_naehrwerte', 'ausfuehren', 'essen(jsonb,uuid,text,integer)'), ('20261001090000_kosten_naehrwerte', 'ausfuehren', 'produzieren(jsonb,bigint,integer,date,uuid,integer)'),
  ('20261002090000_ausgaben', 'tabelle', 'ausgabe'), ('20261002090000_ausgaben', 'rls', 'ausgabe'), ('20261002090000_ausgaben', 'policy', 'ausgabe:App liest Ausgaben'), ('20261002090000_ausgaben', 'policy', U&'ausgabe:App tr\00e4gt Ausgaben ein'), ('20261002090000_ausgaben', 'policy', 'ausgabe:App entfernt Ausgaben'), ('20261002090000_ausgaben', 'recht', 'select:ausgabe'),
  ('20261003090000_bilder_zutaten', 'spalte', 'block_typ.image_url'), ('20261003090000_bilder_zutaten', 'spalte', 'block_typ.image_source'), ('20261003090000_bilder_zutaten', 'spalte', 'block_typ.image_status'), ('20261003090000_bilder_zutaten', 'spalte', 'block_typ.zutat'), ('20261003090000_bilder_zutaten', 'spalte', 'bestand.image_url'), ('20261003090000_bilder_zutaten', 'spalte', 'bestand.zutat'), ('20261003090000_bilder_zutaten', 'tabelle', 'bild'), ('20261003090000_bilder_zutaten', 'funktion', 'bild_zeitstempel()'),
  ('20261003090000_bilder_zutaten', 'trigger', 'bild.bild_zeitstempel'), ('20261003090000_bilder_zutaten', 'rls', 'bild'), ('20261003090000_bilder_zutaten', 'policy', 'bild:App liest Bilder'), ('20261003090000_bilder_zutaten', 'policy', 'bild:App merkt sich Bilder'), ('20261003090000_bilder_zutaten', 'policy', 'bild:App markiert Bilder'), ('20261003090000_bilder_zutaten', 'recht', 'select:bild'), ('20261003090000_bilder_zutaten', 'bucket', 'bilder'),
  ('zz_bon_produktion (anderer Branch)', 'tabelle', 'bon_import'), ('zz_bon_produktion (anderer Branch)', 'tabelle', 'bon_position'), ('zz_bon_produktion (anderer Branch)', 'tabelle', 'produktion'), ('zz_bon_produktion (anderer Branch)', 'tabelle', 'produktion_eingang'), ('zz_bon_produktion (anderer Branch)', 'view', 'bewegung_kosten'), ('zz_bon_produktion (anderer Branch)', 'view', 'bon_gewohnheit'), ('zz_bon_produktion (anderer Branch)', 'funktion_name', 'bon_buchen')
  ) as v(migration, art, objekt)
) as e
group by e.migration
order by e.migration;
