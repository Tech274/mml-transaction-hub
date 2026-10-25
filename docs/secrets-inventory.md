# Secrets inventory (SCRUM-60)

Status as of 25 Sep 2026, based on a review of the GitHub repository `main`
branch. Values are **not** recorded here, only names and locations.

## Inventory

| Secret | Stored in | Read by (code) | Reaches the browser? | Rotation owner |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | hosting env secrets (Lovable Cloud) | `src/integrations/supabase/client.server.ts` | no, server module only | Supabase project owner |
| `FRESHDESK_API_KEY` | hosting env secrets | `src/lib/freshdesk.server.ts` | no | Freshdesk admin + Supabase project owner |
| `cron_secret` | Supabase Vault | pg_cron job headers; checked by `verify_cron_secret()` | no | Atlas (runbook SCRUM-89) |
| Supabase publishable/anon key | env (`VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`) | browser client, per-user server clients | **yes, by design**; not a secret, data is protected by RLS | n/a |
| User sessions (Supabase JWTs) | browser storage | auth attacher / middleware | yes (the user's own) | n/a |

No other API keys (AI providers, email, payment) are read by the code.

## Checks in place

- **CI secret scan** (`scripts/ci/secret-scan.sh`, SCRUM-83): fails a PR that adds
  private keys, GitHub/AWS/Slack tokens, `sk-` keys, JWT-shaped strings or `.env` files.
- **Unit test** `src/lib/__tests__/no-secrets-in-client.test.ts`: the two secret env
  names may only be read in their `*.server.ts` modules; no `VITE_*` name may look
  like a secret; no JWT, `sb_secret_` or private-key text in `src/` source.
- **GitHub secret scanning and push protection:** enabled on this repository on
  24 Oct 2026 (19:53 IST), under the MML blanket approval (MML-65). Open secret-scanning
  alerts on 25 Oct 2026: 0.

## Verification, 25 Oct 2026 (MML-65)

Run on `main` at `da003d4` from a fresh clone. Values were never printed or recorded.

| Check | Result |
|---|---|
| Full git history scan (gitleaks 8.21.2, all 130 commits) | 3 hits, **none a real secret**: the public Supabase anon key (JWT `role: anon`) in the two cron migrations listed below, and a fake AWS-style test fixture (not a real key) in an old revision of a test file |
| Current source scan (`src/`, gitleaks) | no leaks |
| Production client bundle (`bun run build` with placeholder env, `.output/public`, gitleaks + grep for `SUPABASE_SERVICE_ROLE_KEY`, `FRESHDESK_API_KEY`, `service_role`, private-key headers) | no leaks; the only match is the library's `sb_secret_` prefix check, which is not a key |
| `src/lib/__tests__/no-secrets-in-client.test.ts` | 5/5 pass |
| GitHub secret-scanning alerts | 0 |

Result: no private keys in the repository or the browser bundle; private values live only in
the hosting secret store and Supabase Vault, as listed above.

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
