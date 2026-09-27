-- Kombi v0.1: vorerst ohne Login.
--
-- Die App ohne Anmeldung (Rolle anon) bekommt dieselben Rechte wie vorher der WG-Login:
-- alles lesen, Sorten anlegen/bearbeiten, Bestände nur über einfrieren(), entnehmen()
-- und rueckgaengig() ändern. Chargen und Bewegungen bleiben für die App schreibgeschützt,
-- Sorten lassen sich nicht löschen.
--
-- Achtung: Jeder, der App-Adresse und öffentlichen Schlüssel kennt, kann den Bestand ändern.
--
-- Login später wieder einschalten:
--   revoke all on block_typ, charge, bewegung, bestand from anon;
--   revoke execute on function heute(), einfrieren(bigint, integer),
--     entnehmen(bigint, integer), rueckgaengig(bigint[]) from anon;
--   und die fünf Policies unten wieder mit „to authenticated“ anlegen.

grant select, insert, update on block_typ to anon;
grant select on charge, bewegung, bestand to anon;

grant execute on function heute(), einfrieren(bigint, integer),
  entnehmen(bigint, integer), rueckgaengig(bigint[])
  to anon;

alter policy "WG liest Sorten"      on block_typ to anon, authenticated;
alter policy "WG legt Sorten an"    on block_typ to anon, authenticated;
alter policy "WG bearbeitet Sorten" on block_typ to anon, authenticated;
alter policy "WG liest Chargen"     on charge    to anon, authenticated;
alter policy "WG liest Bewegungen"  on bewegung  to anon, authenticated;

notify pgrst, 'reload schema';
