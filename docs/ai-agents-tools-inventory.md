# AI agent tools (Phase 1)

Fixed allow-list. The model cannot name a table. Reads go through the invoking
user's client (`src/lib/ai/tools/user-access.ts`).

| Tool | Roles | Money | Untrusted text | Tables |
|---|---|---|---|---|
| `tickets.search` | admin, ops_lead, ops_user | no | subject | `freshdesk_tickets` |
| `tickets.get` | admin, ops_lead, ops_user | no | subject | `freshdesk_tickets` (no requester email) |
| `tickets.conversation` | admin, ops_lead, ops_user | no | subject, description, live thread | `freshdesk_tickets` plus Freshdesk conversation fetch |
| `customers.get` | admin, leadership, finance, ops_lead, ops_user | no | no | `customers` (no contact details) |
| `reports.summary` | same | yes, masked unless the role may see money | no | `transactions` aggregates |
| `transactions.query` | same | yes, masked | lab name | `transactions` (at most 200 rows) |
| `sync.health` | same | no | no | `sync_runs` |

Not available: free SQL, `profiles`, `user_roles`, `transaction_activity_log`,
`customer_audit_log`, `role_audit_log`, `permission_audit_log`.

`tickets.conversation` may read `requester_email` so the server can fill the Inbox
draft's `to` field. That address is redacted before the model sees the text.
