#!/usr/bin/env bash
# Starts a throwaway local Postgres 16 (as the postgres OS user), runs the DB tests, stops it.
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=$(mktemp -d /tmp/dgpg.XXXXXX); chmod 755 "$DIR"; id postgres >/dev/null 2>&1 && [ "$(id -u)" = 0 ] && chown postgres "$DIR"; PORT=${PGPORT:-54329}
RUN="su postgres -c"; [ "$(id -u)" != 0 ] && RUN="bash -c"
cleanup() { $RUN "$PGBIN/pg_ctl -D $DIR/data stop -m fast" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
$RUN "$PGBIN/initdb -D $DIR/data -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
$RUN "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c listen_addresses=127.0.0.1' -w start" >/dev/null
export TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
npx vitest run --config vitest.db.config.ts "$@"
