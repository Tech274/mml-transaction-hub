
## MCP pipeline tasks
- [x] Snapshot tables + sync job (daily 02:00 UTC via schedule; manual run for admins)
- [x] Sync status page at /sync-status (live counts, last success, next run, run history + detail)
- [x] Verified real MCP tool call (list_customers) appears in /mcp-audit with filters + detail

## Potential ID rule
- [x] Multiple transactions may share one Potential ID — repeats are ignored, never an error (bulk import, manual entry, DB uniqueness removed)

## Support tickets sync
- [x] Cloud Labs group only; only tickets created on/after 2026-04-01; hourly schedule

## Agent ticket KPIs
- [x] Dashboard cards: tickets closed, avg resolution time, tickets this month, queue size — linked to /tickets?view=mine
- [x] Tickets page accepts view/quick in the URL so KPI links land on the right queue
- [x] Live MCP OAuth flow + 4 real tool calls confirmed in mcp_tool_audit_log; snapshot pipeline run OK (24 customers / 58 transactions / 56 report rows)

## Pack 3 (preview only)
- [x] 3A Super Admin user management: delete user, reset/temp password, edit email+name+roles+status, create with status
- [x] 3A RBAC: Admin permission group (user manage/delete/reset, roles, permissions) + read-only Super Admin matrix column
- [x] 3B Apply loop matches on natural key (potential_id+month+year+lab_name); update targets one ADR by id
- [x] 3B Audit events import_started / import_completed / import_failed / run_cancelled + filters
- [x] 3B Stale pending run cancelled + honest updated_rows backfill (53a62ca5 -> 58)
- [x] 3B Invalid-row download fallback to stored artifact; `<file>-invalid-rows.csv`
