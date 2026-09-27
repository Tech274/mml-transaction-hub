# MCP server: OAuth and scope review (SCRUM-59), 28 Sep 2026

Scope: the MCP endpoint `/mcp` (`src/lib/mcp/`), its OAuth metadata
(`/.well-known/oauth-protected-resource`), the consent page (`/.lovable/oauth/consent`) and the
per-user "disconnect client" feature (Agent integrations page, `mcp_revoked_clients`).
This is a code review. Supabase dashboard settings can't be seen from the repo and are listed
as live checks at the end.

## How a token gets in

1. An AI client finds the authorization server through `/.well-known/oauth-protected-resource`.
   The issuer is `https://<project-ref>.supabase.co/auth/v1` (Supabase Auth's OAuth 2.1 server).
2. The user signs in to this app and approves the client on the consent page. The page shows the
   client name, redirect URI and requested scopes.
3. The client calls `/mcp` with a Supabase access token. `@lovable.dev/mcp-js` checks the issuer
   and `aud = authenticated`. If the project ref is missing at build time, the issuer becomes
   `project-ref-unset` and every token is rejected (fails closed).
4. Each tool builds a Supabase client with the **publishable key + the caller's token**
   (`supabaseForUser`). The service role is never used, so **every query runs under the caller's
   RLS**, the same as in the web app.

## Clients and scopes

| Item | Finding | Verdict |
|---|---|---|
| Scopes requested | Supabase OAuth standard scopes only (profile/email identity). The app defines no custom scopes and the MCP handler checks none | OK: all four tools are read-only, and access is limited by the user's role + RLS, not by scope |
| Tools | `whoami`, `list_customers`, `list_transactions`, `reports_summary`. All declare `readOnlyHint: true`; none writes | OK. A test pins `readOnlyHint` on every tool |
| User-bound tokens | Token = the user's Supabase JWT; queries use it; audit rows are inserted as the user (`user_id = auth.uid()` policy) | OK |
| Roles / RLS respected | Yes, no service role in `src/lib/mcp/` | OK |
| Finance data | `list_transactions` returns `selling_cost` / `input_cost`, and `reports_summary` returns revenue/profit, to **any role that can read transactions** (viewer included) | **Flag: follows the finance visibility matrix, SCRUM-58 (Vivek)** |
| Client registration | Which clients may register (dynamic registration on/off) is a Supabase Auth setting | Live check 1 |
| Consent | Shows client name, redirect URI and scopes; the user must approve | OK |

## Expiry and revocation

| Path | What it does | Verdict |
|---|---|---|
| Token expiry | Supabase access-token lifetime (default 1 hour; `supabase/config.toml` doesn't override it). The client renews with its refresh token | Live check 2: confirm the lifetime |
| Disconnect in the app | Agent integrations → disconnect inserts `(user_id, client_id)` into `mcp_revoked_clients`. Every tool call checks it first and refuses with `revoked` | OK, **fixed here:** a failed lookup used to let the call through (fail open). It now refuses with a ref (fail closed) |
| Reconnect | The user can remove their own revocation (undo) | Acceptable; only affects their own access |
| Revoking the OAuth grant itself | The in-app disconnect blocks tools but doesn't end the Supabase OAuth grant; the client can still refresh tokens (they're refused by every tool) | Live check 3: confirm how to revoke a grant in Supabase Auth (for leavers). Disabling the user (Admin) ends it for all clients |
| Leaver / disabled user | Admin "disable" bans the auth user, so new tokens can't be issued. Existing access tokens live until expiry, and RLS still applies to them | OK, bounded by token lifetime |

## Other changes in this PR

- Tool errors no longer send raw database text (table, column and constraint names) to the AI
  client. They return a friendly message with a ref (`toolDbError`); the full error is in the
  server log. The raw text is still written to the admin-only audit row.
- The Agent integrations list (`listMyMcpClients`) used to show every client as "connected" when
  the revocation lookup failed. It now shows an error.
- 10 tests (`src/lib/__tests__/mcp-audit.test.ts`).

## Live checks (read-only, need dashboard access; no change without approval)

1. Supabase → Auth → OAuth server: is dynamic client registration on? List the registered
   clients and remove any nobody recognises (removal needs Vivek's approval).
2. Supabase → Auth → JWT expiry: record the value here (expected 3600 s).
3. How to revoke a single user's OAuth grant (needed for leavers). Record the steps in the runbook.
4. Hosting: `trustForwardedHost: true` builds the metadata URL from `X-Forwarded-Host`. Confirm
   the host (Lovable/Cloudflare) overwrites that header and a client can't set it.
