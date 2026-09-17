
## MCP pipeline tasks
- [x] Snapshot tables + sync job (daily 02:00 UTC via schedule; manual run for admins)
- [x] Sync status page at /sync-status (live counts, last success, next run, run history + detail)
- [x] Verified real MCP tool call (list_customers) appears in /mcp-audit with filters + detail

## Potential ID rule
- [x] Multiple transactions may share one Potential ID — repeats are ignored, never an error (bulk import, manual entry, DB uniqueness removed)
