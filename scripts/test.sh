#!/usr/bin/env bash
# Spielt Migration + Seed in eine Wegwerf-Datenbank ein und führt die Tests aus.
#
#   npm test
#     startet eine temporäre lokale Postgres (braucht die Postgres-Programme,
#     z. B. „brew install postgresql“ oder „apt install postgresql“).
#
#   DATABASE_URL=postgresql://… npm test
#     nutzt stattdessen eine vorhandene, LEERE Datenbank (z. B. in CI).
#     Achtung: Die Datenbank wird befüllt – nie die echte Supabase-DB angeben!
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=""
PG_BIN=""

# initdb/pg_ctl verweigern den Start als root – dann als Benutzer „postgres“.
als_pg() {
  if [[ $EUID -eq 0 ]]; then runuser -u postgres -- "$@"; else "$@"; fi
}

aufraeumen() {
  if [[ -n "$TMP" ]]; then
    als_pg "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$TMP"
  fi
}
trap aufraeumen EXIT

if [[ -n "${DATABASE_URL:-}" ]]; then
  URL="$DATABASE_URL"
else
  if command -v initdb >/dev/null 2>&1; then
    PG_BIN="$(dirname "$(command -v initdb)")"
  else
    PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
  fi
  if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
    echo "Postgres-Programme (initdb) nicht gefunden. Postgres installieren oder DATABASE_URL setzen." >&2
    exit 1
  fi

  PORT="${PGTEST_PORT:-54329}"
  TMP="$(mktemp -d /tmp/kombi-test.XXXXXX)"
  [[ $EUID -eq 0 ]] && chown postgres "$TMP"

  als_pg "$PG_BIN/initdb" -D "$TMP/data" -U postgres -A trust -E UTF8 --locale=C --no-sync >/dev/null
  als_pg "$PG_BIN/pg_ctl" -D "$TMP/data" -l "$TMP/server.log" -w \
    -o "-p $PORT -k $TMP -c listen_addresses=''" start >/dev/null
  URL="postgresql:///postgres?host=$TMP&port=$PORT&user=postgres"
fi

sql() { psql -X -q -v ON_ERROR_STOP=1 "$URL" "$@"; }

echo "→ Supabase-Rollen nachbilden"
sql -f tests/supabase_rollen.sql
# Reihenfolge wie beim Einrichten laut README: Der Seed kommt nach den ersten beiden
# Migrationen. So prüfen die Tests auch, dass spätere Migrationen vorhandene Daten
# richtig übernehmen.
for datei in supabase/migrations/*.sql; do
  echo "→ Migration $(basename "$datei")"
  sql -f "$datei"
  if [[ "$datei" == *_ohne_login.sql ]]; then
    echo "→ Seed"
    sql -f supabase/seed.sql
  fi
done
echo "→ Tests"
sql -f tests/inventar_test.sql

# Das Diagnose-Skript für die echte Datenbank muss nach allen Migrationen „komplett“ melden
# (einzige Ausnahme hier: Speicher-Bucket – die Test-Datenbank hat kein Supabase-Storage).
echo "→ scripts/schema-stand.sql"
abweichung="$(psql -X -q -t -A -F '|' -v ON_ERROR_STOP=1 "$URL" -f scripts/schema-stand.sql \
  | awk -F'|' '$1 !~ /^zz_/ && $2 != "komplett" && !($1 ~ /bilder_zutaten$/ && $4 == "bucket bilder")')"
if [[ -n "$abweichung" ]]; then
  echo "schema-stand.sql erkennt eingespielte Migrationen nicht als komplett:" >&2
  echo "$abweichung" >&2
  exit 1
fi
echo "ok  schema-stand.sql erkennt alle Migrationen als komplett"

# Wie bei Supabase: storage.buckets vorhanden – erst ohne, dann mit Bucket „bilder“
# (ohne Treffer darf die dynamische Abfrage nicht scheitern).
sql -c "create schema storage; create table storage.buckets (id text primary key, name text, public boolean);"
bilder="$(psql -X -q -t -A -F '|' -v ON_ERROR_STOP=1 "$URL" -f scripts/schema-stand.sql | awk -F'|' '$1 ~ /bilder_zutaten$/ {print $2 "|" $4}')"
[[ "$bilder" == "teilweise|bucket bilder" ]] || { echo "schema-stand.sql mit leerem storage.buckets: $bilder" >&2; exit 1; }
sql -c "insert into storage.buckets (id, name, public) values ('bilder', 'bilder', true);"
bilder="$(psql -X -q -t -A -F '|' -v ON_ERROR_STOP=1 "$URL" -f scripts/schema-stand.sql | awk -F'|' '$1 ~ /bilder_zutaten$/ {print $2}')"
[[ "$bilder" == "komplett" ]] || { echo "schema-stand.sql mit Bucket „bilder“: $bilder" >&2; exit 1; }
echo "ok  schema-stand.sql mit Supabase-Storage: Bucket fehlt → teilweise, vorhanden → komplett"

# Die Skripte für den SQL-Editor müssen auch funktionieren, wenn ein Editor den Text zu einer Zeile
# zusammenzieht und z. B. für eine Zeilenbegrenzung einwickelt (Zeilenkommentare würden dann alles verschlucken).
for skript in scripts/schema-stand.sql scripts/daten-export.sql; do
  zeile="$(tr '\n' ' ' < "$skript" | sed -E 's/;[[:space:]]*$//')"
  for variante in "$zeile" "select * from ($zeile) t limit 100"; do
    [[ -n "$(psql -X -q -t -A -v ON_ERROR_STOP=1 "$URL" -c "$variante")" ]] \
      || { echo "$skript liefert als eine Zeile kein Ergebnis" >&2; exit 1; }
  done
done
echo "ok  schema-stand.sql und daten-export.sql funktionieren auch als eine Zeile"
