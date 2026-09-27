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
for test in tests/*_test.sql; do
  echo "→ Tests $(basename "$test")"
  sql -f "$test"
done
