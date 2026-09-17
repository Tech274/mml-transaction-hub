
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
