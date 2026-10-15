delete from rezept r
where exists (
  select 1
  from rezept n
  where btrim(regexp_replace(lower(n.name), '[^[:alnum:]]+', ' ', 'g'))
      = btrim(regexp_replace(lower(r.name), '[^[:alnum:]]+', ' ', 'g'))
    and (n.erstellt_am, n.id::text) > (r.erstellt_am, r.id::text)
)
returning r.name as entfernt, r.erstellt_am;
