#!/usr/bin/env bash
# Fails if lines ADDED in this change look like secrets.
# Compares against the merge base with main (PRs) or the previous commit (push).
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
PATTERN='(-----BEGIN [A-Z ]*PRIVATE KEY-----|service_role["'"'"' :=]+eyJ|SUPABASE_SERVICE_ROLE_KEY *= *[A-Za-z0-9]|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{32,}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})'
# Existing migrations contain the public anon JWT; only new lines are checked.
HITS="$(git diff --unified=0 "$BASE" HEAD -- . ':(exclude)bun.lock' | grep -E '^\+[^+]' | grep -E -- "$PATTERN" || true)"
if [ -n "$HITS" ]; then
  echo "Possible secret material in added lines:" >&2
  echo "$HITS" | sed -E 's/(.{12}).*/\1…(redacted)/' >&2
  exit 1
fi
NEW_ENV_FILES="$(git diff --name-only --diff-filter=A "$BASE" HEAD | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)"
if [ -n "$NEW_ENV_FILES" ]; then
  BAD_ENV_FILES=()
  while IFS= read -r FILE; do
    [ -z "$FILE" ] && continue
    if [ "$FILE" = ".env.production" ]; then
      CONTENT="$(git show "HEAD:${FILE}" | tr -d '\r')"
      if [ "$CONTENT" != "VITE_SCRUM44_UI_REVIEW_ENABLED=true" ]; then
        echo ".env.production may only contain VITE_SCRUM44_UI_REVIEW_ENABLED=true." >&2
        exit 1
      fi
      continue
    fi
    BAD_ENV_FILES+=("$FILE")
  done <<< "$NEW_ENV_FILES"

  if [ "${#BAD_ENV_FILES[@]}" -gt 0 ]; then
    printf '%s\n' "${BAD_ENV_FILES[@]}"
    echo ".env files must not be committed (use .env.example with names only)." >&2
    exit 1
  fi
fi
echo "Secret scan: no findings in added lines."
