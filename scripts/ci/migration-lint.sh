#!/usr/bin/env bash
# Migration discipline (SCRUM-64): new migration files may not contain
# destructive DDL unless the file carries an explicit approval marker:
#   -- approved-destructive: <ticket> <who approved>
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
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if ! head -n 15 "$f" | grep -qiE -- '-- *(SCRUM-[0-9]+|ticket:)'; then
    echo "::error file=$f::New migration must name its Jira ticket in a header comment (e.g. -- SCRUM-89: ...)."
    FAIL=1
  fi
  if grep -qiE '^\s*(DROP\s+(TABLE|COLUMN|SCHEMA|TYPE|FUNCTION)|TRUNCATE\s|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+(DROP|ALTER\s+COLUMN\s+\S+\s+TYPE))' "$f" \
     && ! grep -qiE -- '-- *approved-destructive:' "$f"; then
    echo "::error file=$f::Destructive statement without an '-- approved-destructive:' marker."
    FAIL=1
  fi
done < <(git diff --name-only --diff-filter=A "$BASE" HEAD -- 'supabase/migrations/*.sql')
[ "$FAIL" = 0 ] && echo "Migration lint: OK"
exit $FAIL
