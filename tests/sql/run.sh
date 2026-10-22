#!/usr/bin/env bash
# Runs every Supabase SQL file in order against a fresh Postgres database, twice (they must be
# re-runnable), then checks.sql. Needs psql pointed at a scratch server via PGHOST/PGPORT/PGUSER.
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
cd "$(dirname "$0")"
DB="soloprint_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB"
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
run() { psql -q -X -v ON_ERROR_STOP=1 -d "$DB" "$@" >/dev/null; }
psql -q -d postgres -c "do \$\$ begin create role anon nologin; exception when duplicate_object then null; end \$\$" -c "do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$" >/dev/null
sed -e '/^create role /d' supabase-stubs.sql > /tmp/stubs.$$.sql
run -f /tmp/stubs.$$.sql
email_sql=$(sed -e '/create extension if not exists pg_net/d' \
  -e "s#'PASTE-WEB-APP-URL-HERE'#'https://script.google.com/macros/s/test/exec'#" \
  -e "s#'PASTE-YOUR-SECRET-HERE'#'0123456789abcdef0123456789abcdef'#" ../../supabase/email-trigger.sql)
for pass in 1 2; do
  run -f ../../supabase/security.sql
  run -f ../../supabase/gallery.sql
  run -c "$email_sql"
  run -f ../../supabase/library-and-backups.sql
  run -f ../../supabase/site-settings.sql
  run -f ../../supabase/owner-tools.sql
  run -f ../../supabase/drafts.sql
done
psql -q -X -v ON_ERROR_STOP=1 -o /dev/null -d "$DB" -f checks.sql
rm -f /tmp/stubs.$$.sql
