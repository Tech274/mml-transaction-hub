# Secrets inventory (SCRUM-60)

Status as of 25 Sep 2026, based on a review of the GitHub repository `main`
branch. Values are **not** recorded here, only names and locations.

## Inventory

| Secret | Stored in | Read by (code) | Reaches the browser? | Rotation owner |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | hosting env secrets (Lovable Cloud) | `src/integrations/supabase/client.server.ts` | no, server module only | Supabase project owner |
| `FRESHDESK_API_KEY` | hosting env secrets | `src/lib/freshdesk.server.ts` | no | Freshdesk admin + Supabase project owner |
| `OPENAI_API_KEY` | hosting env secrets (Lovable Cloud) | `src/lib/ai/providers/env.server.ts` | no | Project owner |
| `ANTHROPIC_API_KEY` | hosting env secrets (Lovable Cloud) | `src/lib/ai/providers/env.server.ts` | no | Project owner |
| `GEMINI_API_KEY` | hosting env secrets (Lovable Cloud) | `src/lib/ai/providers/env.server.ts` | no | Project owner |
| `OPENAI_COMPAT_API_KEY` | hosting env secrets (Lovable Cloud), optional | `src/lib/ai/providers/env.server.ts` | no | Project owner |
| `cron_secret` | Supabase Vault | pg_cron job headers; checked by `verify_cron_secret()` | no | Atlas (runbook SCRUM-89) |
| Supabase publishable/anon key | env (`VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`) | browser client, per-user server clients | **yes, by design**; not a secret, data is protected by RLS | n/a |
| User sessions (Supabase JWTs) | browser storage | auth attacher / middleware | yes (the user's own) | n/a |

Provider keys are read only in `src/lib/ai/providers/env.server.ts`. They are not stored in the database, not sent to the browser, and not written to logs. `OPENAI_COMPAT_BASE_URL` is a URL, not a secret. `AI_AGENTS_DEMO=1` turns on the local mock provider and must stay unset in production.

## Checks in place

- **CI secret scan** (`scripts/ci/secret-scan.sh`, SCRUM-83): fails a PR that adds
  private keys, GitHub/AWS/Slack tokens, `sk-` keys, JWT-shaped strings or `.env` files.
- **Unit test** `src/lib/__tests__/no-secrets-in-client.test.ts`: secret env
  names may only be read in their `*.server.ts` modules; no `VITE_*` name may look
  like a secret; no JWT, `sb_secret_` or private-key text in `src/` source.
- **Not yet confirmed:** GitHub secret scanning and push protection for the repository.
  The repository owner needs to enable these (Settings → Code security); agents do not
  change repository settings.

## Known exposure (not a secret leak, still to fix)

- Some existing migrations contain the **public anon key** as the pg_cron
  "password". This value is public by design, but using it as a job password was
  finding G-03. SCRUM-89 replaces it with the Vault `cron_secret`. Once that
  migration is applied and the jobs are re-created, the anon key is no longer a
  job credential. It does not need rotating for secrecy reasons.

## Rotation plan (use if a secret is ever exposed)

Rotate one secret at a time, during a quiet window, with the owner present:

1. **Freshdesk API key.** Create a new key in Freshdesk (the key belongs to the
   agent profile that owns it), update `FRESHDESK_API_KEY` in the hosting secrets,
   trigger one manual sync and confirm a successful `sync_runs` row (kind `freshdesk`),
   then revoke the old key. The live sync keeps working until the old key is revoked.
2. **Service-role key.** Rotate in Supabase (API settings; with the new key system,
   create a new secret key before revoking the old one), update
   `SUPABASE_SERVICE_ROLE_KEY`, check Sync Status and one admin action, then revoke the old key.
3. **`cron_secret`.** Follow `docs/runbooks/scrum-89-cron-secret.md` (update the Vault
   secret; jobs read it at run time, so they need no change).
4. Record what was rotated and when in the ticket. Never paste values into Jira,
   chat or commits.
