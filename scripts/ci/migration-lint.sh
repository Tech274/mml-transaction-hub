#!/usr/bin/env bash
# Migration discipline (SCRUM-64). Checks the migration files a PR adds or changes.
# Full process: docs/migrations.md. Rules for NEW files in supabase/migrations/:
#   1. A header comment (first 15 lines) names the Jira ticket:  -- SCRUM-123: ...
#   2. A rollback section exists:                              -- Rollback: ...
#      (or "-- Rollback: none needed, <why>" for purely additive changes)
#   3. Destructive DDL (DROP TABLE/COLUMN/SCHEMA/TYPE/FUNCTION/INDEX/VIEW, TRUNCATE,
#      DELETE FROM, ALTER COLUMN ... TYPE, EXECUTE 'drop ...') needs an approval marker:
#        -- approved-destructive: <ticket> <who approved>
#   4. The file name is <14-digit timestamp>_<name>.sql and the timestamp is later than every
#      migration already on the base branch (Supabase skips out-of-order files on push), unless:
#        -- out-of-order-approved: <ticket> <who approved>
# Rule for EXISTING files: a migration already on the base branch is never edited, renamed or
# deleted (it may already be applied somewhere). Write a new migration instead.
set -euo pipefail
BASE_REF="${GITHUB_BASE_REF:-main}"
if git rev-parse --verify -q "origin/${BASE_REF}" >/dev/null; then
  BASE="$(git merge-base "origin/${BASE_REF}" HEAD)"
else
  BASE="$(git rev-parse HEAD~1 2>/dev/null || git hash-object -t tree /dev/null)"
fi
if [ "$(git rev-parse HEAD)" = "$BASE" ]; then
  BASE="$(git rev-parse HEAD~1 2>/dev/null || git hash-object -t tree /dev/null)"
fi
FAIL=0
err() { echo "::error file=$1::$2"; FAIL=1; }

# Latest migration version already on the base branch.
LATEST="$( (git ls-tree --name-only "$BASE" supabase/migrations/ 2>/dev/null || true) \
  | sed -nE 's#^supabase/migrations/([0-9]{14})_.*\.sql$#\1#p' | sort | tail -n 1)"

while IFS=$'\t' read -r status f rest; do
  [ -z "${status:-}" ] && continue
  case "$status" in
    A) ;;
    *)
      target="$f"; [ -n "${rest:-}" ] && target="$rest"
      err "$target" "Committed migration $f was changed (git status $status). Migrations already on ${BASE_REF} may be applied somewhere; never edit, rename or delete them. Add a new migration instead (docs/migrations.md)."
      continue ;;
  esac
  if ! head -n 15 "$f" | grep -qiE -- '-- *(SCRUM-[0-9]+|ticket:)'; then
    err "$f" "New migration must name its Jira ticket in a header comment (e.g. -- SCRUM-89: ...)."
  fi
  if ! grep -qiE -- '^\s*-- *rollback' "$f"; then
    err "$f" "New migration must include a rollback section: '-- Rollback: <SQL or steps>' (or '-- Rollback: none needed, <why>')."
  fi
  if grep -qiE '^\s*(execute\s+.drop\s|DROP\s+(TABLE|COLUMN|SCHEMA|TYPE|FUNCTION|INDEX|VIEW)|TRUNCATE\s|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+(DROP|ALTER\s+COLUMN\s+\S+\s+TYPE))' "$f" \
     && ! grep -qiE -- '-- *approved-destructive:' "$f"; then
    err "$f" "Destructive statement without an '-- approved-destructive:' marker."
  fi
  name="$(basename "$f")"
  if ! [[ "$name" =~ ^([0-9]{14})_[A-Za-z0-9_-]+\.sql$ ]]; then
    err "$f" "Migration file name must be <YYYYMMDDHHMMSS>_<name>.sql."
  else
    version="${BASH_REMATCH[1]}"
    if [ -n "$LATEST" ] && [[ ! "$version" > "$LATEST" ]] && ! grep -qiE -- '-- *out-of-order-approved:' "$f"; then
      err "$f" "Timestamp $version is not later than the latest migration on ${BASE_REF} ($LATEST). Rename it with a newer timestamp, or add '-- out-of-order-approved: <ticket> <who>'."
    fi
  fi
done < <(git diff --name-status "$BASE" HEAD -- 'supabase/migrations/*.sql')
[ "$FAIL" = 0 ] && echo "Migration lint: OK"
exit $FAIL
