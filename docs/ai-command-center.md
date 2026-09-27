# AI Command Center: write safety (SCRUM-76 / G-09)

The AI Command Center has three rule-based "agents" (no AI model is called today). They only
**propose**; a person decides in the Inbox. This page lists the rules the code enforces.

## Who can do what

| Action | Roles (checked in the database with `has_any_role`) |
|---|---|
| Run an agent, reject a proposal, approve an email draft / ADR field map / solution guide | admin, ops_lead, ops_user, leadership, finance |
| Approve a **ticket proposal** (writes to the real Freshdesk ticket) | **admin, ops_lead** only |

Rules live in `src/lib/ai-cc-policy.ts` and are tested in `src/lib/__tests__/ai-cc-policy.test.ts`.

## Writes to Freshdesk

- Only `confirmInboxItem` for a `ticket_proposal` writes outside the app.
- The user must accept a second dialog ("Update the real helpdesk ticket?"). The server refuses the
  write unless the request carries `confirm_external_write: true`, so a script calling the function
  directly can't skip it.
- The write is rebuilt from an allowlist: ticket number, a status from
  `Open / Pending / Waiting on Customer`, and a note up to 2,000 characters. Nothing else in the
  stored proposal is sent. An AI proposal can't resolve or close a ticket.
- Order: note first, then status. If a step fails, the proposal **stays pending**. The error is
  logged with a ref, the attempt is recorded on the proposal (`payload.last_write_attempt`: who,
  when, ref, steps already done) and the user sees which step failed. Before, a failed write was
  still marked "confirmed".
- Confirm and reject only change a proposal that is still pending, so two people clicking at
  once can't both "win".

## Service-role use

The `ai_cc_*` tables allow users to read only; writes (runs, inbox, audit) go through the
service-role client **after** the role check above. That is deliberate: users can't forge audit
rows. The Freshdesk API key is shared, so the role check is the control for who may write there.

## Demo data

The Cost / ADR agent used to insert a made-up CONFIRMED lab request (customer "Cognizant") into
the live database when none existed. That code is removed; the agent now stops with
"There are no CONFIRMED lab requests yet". Rows created earlier are **not** deleted.
`supabase/tests/reports/ai_cc_seeded_demo_requests.sql` lists them (read-only) so they can be
reviewed. Removing them needs Vivek's approval.

## Prompt injection

No model reads ticket text today. The support agent's proposal is fixed (status Pending, a fixed
note) whatever the ticket says, and a test plants instructions in a ticket to prove it. When a
real model is added, the allowlisted write plan above still applies: the model can only fill in
the three allowed fields, and a person still confirms.

## Open decision (Vivek)

Whether the AI Command Center stays visible on live, is labelled "Preview", or goes behind a
feature flag. This change does not alter visibility.
