# AI agents (Phase 1)

Configurable agents for the AI Command Center. Phase 1 is manual only: a person
starts a run, the model may call read-only tools, and the result lands in the
Inbox as a draft. Nothing is emailed, nothing is written to Freshdesk, and
nothing changes business data.

The Lovable AI gateway is not used. The owner supplies provider keys as server
environment variables. See `docs/configuration.md`.

OpenAI and Anthropic are the primary providers. New agents start on OpenAI
GPT-6 Luna. Ticket triage is seeded on Anthropic Claude Haiku 4.5, and dashboard
Q&A is seeded on GPT-6 Luna. Google Gemini and an OpenAI-compatible base URL
stay in the adapter as secondary choices.

## What an admin can do

- Create and edit a model agent, including instructions, provider, model, tools and audience.
- Each save stores a new immutable version. History can activate a chosen version.
- Test-run with sample input. A test run is audited and is not added to the Inbox.
- Activate, pause or archive. Model agents `ticket_triage` and `dashboard_qa` must pass the built-in check before they can be activated.
- Usage page: spend against the monthly cap (default $10), per-agent rows, blocked runs, and the kill switch.
- Cost settings: per-run cap (default $0.10), per-agent monthly cap (default $5), overall monthly cap (default $10).

## Seeded agents

| Key | Engine | Status |
|---|---|---|
| `generalist` | rules (existing brain) | paused |
| `support` | rules (existing brain) | active |
| `cost_adr` | rules (existing brain) | paused |
| `ticket_triage` | model, Anthropic Claude Haiku 4.5 | draft until an admin activates it |
| `dashboard_qa` | model, OpenAI GPT-6 Luna | draft until an admin activates it |

Ticket triage may call ticket and customer tools. Those tools require an ops role
(`admin`, `ops_lead`, `ops_user`). The conversation is fetched at run time through
the existing server-side Freshdesk integration when the caller has an ops role.
Dashboard Q&A may call reports, transactions and sync health.

## Safety

- Tool reads use the invoking user's Supabase client, so row level security applies. They never use the service role.
- The tool list is fixed in `src/lib/ai/tool-catalog.ts`. There is no free SQL and no tool that reads the four audit-log tables.
- Ticket and CSV text is untrusted: instructions are stripped, secrets and email addresses are redacted, and the remainder is wrapped in `BEGIN UNTRUSTED` / `END UNTRUSTED`.
- After untrusted ticket text names a company, later ticket searches stay on that company.
- The server fills the ticket id and the draft recipient. The model cannot choose them.
- Invalid JSON ends the run as an error. Nothing is written to the Inbox.
- Until SCRUM-58 is decided, money figures are visible only to admin, leadership and finance. Other roles see `[hidden for your role]`.
- The kill switch (`ai_settings.agents_enabled`) is checked before a run and before each model call.
- A provider HTTP 402, or five provider errors in ten minutes, turns the kill switch off.
- More than three runs already in progress are refused. They are not queued.

## Local demo

`scripts/demo-local.sh` sets `AI_AGENTS_DEMO=1`. With no provider key, runs use
the mock adapter and do not call a vendor. Do not set `AI_AGENTS_DEMO` in production.

`scripts/ai-provider-smoke.sh` is opt-in. It exits 0 without calling anyone when
no key is set. It never prints a key.

## Not in this phase

Schedules, events, autonomous writes, sending email, a 12-month retention job,
phase 2 and 3 tools, and the activity-log policy fix. The built-in eval checks
structure and safety against the mock. It is not a live quality score from a vendor model.
