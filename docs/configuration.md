# Configuration reference (SCRUM-82)

Every setting the app reads, where it is read, and whether it is secret.
Values live in the hosting platform's secret/env settings (Lovable Cloud project
secrets today) and, for local development, in an uncommitted `.env.local`.
`.env.example` lists the names. **Never commit real values.** CI rejects added
`.env` files and secret-looking strings (`scripts/ci/secret-scan.sh`).

## Environment variables

| Name | Secret? | Where read | Default when unset | Purpose |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | no (public) | `src/integrations/supabase/client.ts` | none | Supabase URL for the browser client |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | no (public by design; RLS protects data) | `client.ts` | none | anon/publishable key for the browser |
| `VITE_SUPABASE_PROJECT_ID` | no | `src/lib/mcp/index.ts` | `project-ref-unset` | project ref used in MCP metadata |
| `SUPABASE_URL` | no | `client.server.ts`, `auth-middleware.ts`, `mcp/supabase-for-user.ts`, SSR fallback in `client.ts` | none | server-side Supabase URL |
| `SUPABASE_PUBLISHABLE_KEY` | no | `auth-middleware.ts`, `mcp/supabase-for-user.ts` | none | per-user (RLS) server clients |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | `src/integrations/supabase/client.server.ts` only | none (server admin calls fail) | bypasses RLS; server-only admin client |
| `FRESHDESK_DOMAIN` | no | `src/lib/freshdesk.server.ts` | none (sync fails with "Freshdesk is not configured yet") | e.g. `yourco.freshdesk.com` |
| `FRESHDESK_API_KEY` | **yes** | `src/lib/freshdesk.server.ts` only | none | Freshdesk API (Basic auth) |
| `FRESHDESK_GROUP_ID` | no | `src/lib/app-config.ts` (SCRUM-101) | current production group | which Freshdesk group is synced |
| `FRESHDESK_GROUP_NAME` | no | `app-config.ts` | current production group name | display / fallback match |
| `FRESHDESK_TICKETS_FROM` | no | `app-config.ts` | current cut-off date | oldest ticket date to sync |
| `FRESHDESK_FULL_SYNC_HOUR_UTC` | no | `src/lib/freshdesk-cursor.ts` (SCRUM-92) | `21` | hour (UTC) of the daily full pass; other runs are incremental |
| `FRESHDESK_STALE_SWEEP_ENABLED` | no | `src/lib/freshdesk-stale.ts` (SCRUM-92) | off | only the exact string `true` turns it on. After a complete full pass, tickets Freshdesk no longer returns get `stale_since` set (never deleted). **Turn on only after migration `20260925150000_scrum92_freshdesk_stale_marker.sql` is applied.** Refuses to mark more than half of all tickets in one run (over 50) |
| `HOOK_TIMEOUT_SECONDS` | no | `src/lib/background-hook.ts` (SCRUM-72) | `25` | time budget for each scheduled hook job (Freshdesk sync, snapshot, bulk-import cleanup). Whole seconds, 5 to 900; a bad value is logged and 25 is used. See "Scheduled hooks" below |
| `SNAPSHOT_CRON_UTC` | no | `app-config.ts`, shown on Sync Status | current schedule | label for the snapshot job time |
| `STRICT_IMPORT_ENABLED` | no | `src/lib/strict-import/flag.ts` | unused | The Bulk Import tab no longer reads this flag. It is on for admin, ops_lead and ops_user. |
| `OPENAI_API_KEY` | **yes** | `src/lib/ai/providers/env.server.ts` only | provider shows as not configured; runs refuse unless `AI_AGENTS_DEMO=1` | Owner's OpenAI key. Lovable Cloud secret. Never in the database or the browser |
| `ANTHROPIC_API_KEY` | **yes** | `src/lib/ai/providers/env.server.ts` only | same | Owner's Anthropic key |
| `GEMINI_API_KEY` | **yes** | `src/lib/ai/providers/env.server.ts` only | same | Owner's Gemini key. Sent as the `x-goog-api-key` header, not in the URL |
| `OPENAI_COMPAT_BASE_URL` | no | `src/lib/ai/providers/env.server.ts` | compat provider off | Optional OpenAI-compatible base URL |
| `OPENAI_COMPAT_API_KEY` | **yes** | `src/lib/ai/providers/env.server.ts` only | compat provider off | Key for that base URL |
| `AI_AGENTS_DEMO` | no | `src/lib/ai/providers/env.server.ts` | off | Exact string `1` uses the mock provider for the local demo when no vendor key is set. Do not set this in production |

Rules:
- Anything prefixed `VITE_` is copied into the JavaScript sent to every browser. **Never** give a secret a `VITE_` name. The unit test `src/lib/__tests__/no-secrets-in-client.test.ts` fails if one appears.
- Secret values are read only in `*.server.ts` modules.

## Scheduled hooks (SCRUM-72)

pg_cron calls `/api/public/hooks/freshdesk-sync`, `/mcp-sync` and `/bulk-import-cleanup` through pg_net,
which stops waiting after 5 seconds by default. The hooks therefore:

1. check the `x-cron-secret` header (401 if wrong, as before);
2. reply **202** `{"accepted":true,"job":…,"mode":"background","timeout_seconds":25}` straight away;
3. run the job in the background with the platform's `waitUntil` (Cloudflare Workers via nitro).

If the host has no `waitUntil`, the job runs inline and the reply is the old 200/500 result
(504 if it overruns). Results go to the server logs; the Freshdesk and snapshot jobs also record
every run in `sync_runs`, which Sync Status shows.

Time budget: `HOOK_TIMEOUT_SECONDS` (default 25). Cloudflare allows about 30 seconds of work
after the response, so raising it only helps on a host that allows longer. The Freshdesk sync
gets the deadline and stops paging about 4 seconds before it, so it can save what it read and
record the run:
- an incremental run that runs out of time fails, and the next run starts again from the last success (nothing is skipped);
- a full pass that runs out of time is a success with a note, and the SCRUM-92 stale sweep is skipped for that pass.

Freshdesk rate limits (429) are retried only if the wait fits the budget; otherwise the run fails
with a clear message and the next scheduled run picks up.

## Secrets that are not environment variables

| Secret | Where it lives | Used by |
|---|---|---|
| `cron_secret` | Supabase **Vault** (created by migration `…scrum89_cron_secret.sql`) | pg_cron jobs send it as `x-cron-secret`; the app checks it with `verify_cron_secret()` (SCRUM-89). See `docs/runbooks/scrum-89-cron-secret.md` |

See `docs/secrets-inventory.md` for the rotation plan.

## Sandbox vs live

| | Sandbox | Live |
|---|---|---|
| Supabase project | separate sandbox project | production project |
| Who changes it | engineers, for testing migrations and the app | only through the agreed release order (migrations first, then publish), with Atlas + Vivek approval |
| Data | synthetic only | real customer and finance data |
| Freshdesk | leave `FRESHDESK_*` unset, or use a test group, so sandbox never writes to real tickets | production group |
| Feature flags | may be turned on for testing | off until approved (for example `STRICT_IMPORT_ENABLED`) |

Local development must point at the **sandbox** project. Do not copy live keys to a laptop.
