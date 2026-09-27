# Audit logging for AI and MCP actions (SCRUM-77), 28 Sep 2026

Every action taken through the MCP server or the AI Command Center can be traced to a user,
a time and its input. This page says where each is recorded, who can read it, what's redacted,
and what is still open.

## Where actions are recorded

| Source | Table | Written by | One row per | Columns |
|---|---|---|---|---|
| MCP tool call (`/mcp`, `/.mcp/invoke-tool/*`) | `mcp_tool_audit_log` | server, service role (from this PR; `src/lib/mcp/audit.ts`) | call, incl. refused calls (revoked client, failed revocation check) | user id + email, AI client id, tool, **redacted** arguments, success, error code/message, duration, time |
| AI Command Center run / proposal / confirm / reject | `ai_cc_audit` | server, service role (`src/lib/ai-command-center.functions.ts`) | action | actor id + email, agent, action, run/inbox ids, detail (item type, title, note, write result), time |

## Acceptance criteria

| Criterion | Status |
|---|---|
| User, tool, parameters (redacted), result, timestamp | **Yes.** See the columns above. Arguments go through `redactArguments` (`src/lib/mcp/redact.ts`) |
| Append-only | **Yes.** Updates and deletes are blocked by restrictive policies, and the SCRUM-57 migration removes the unused grants. **New:** users can no longer insert rows either (migration `20260928030000`, not applied); only the server writes. The AI Command Center audit was already server-only |
| Admin-viewable | **Yes.** MCP audit page (admin only, #6) shows all rows; each user sees their own. The AI Command Center audit page is readable by roled users |
| Sensitive values redacted | **Yes, for inputs.** Keys that look like credentials or money (password, token, key, secret, authorization, cost, price, revenue, amount, margin, profit, …) are replaced with `[redacted]`. JWT/bearer/long key-like values are replaced under any key. Strings are capped at 500 chars, and nesting and key count are limited. Tool **outputs** (which can contain finance data) are never logged |
| Retention period defined | **Needs a decision (Vivek).** Proposal: keep 12 months, then delete older rows with a scheduled job. Deleting audit rows is destructive, so it needs approval and its own migration (`approved-destructive`) |

`error_message` in the MCP audit keeps the raw error text on purpose. It's admin-readable only (and
the user's own rows), and the AI client only ever gets the friendly message with a ref (#29).

## Release order

Publish the code first (audit rows move to the service role), then apply
`20260928030000_scrum77_mcp_audit_server_writes.sql` (register #9 in `docs/migrations.md`). If the
migration goes first, tool calls still work, but their audit rows fail to save (logged with a ref)
until the publish.
