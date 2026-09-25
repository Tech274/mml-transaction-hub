# KPI definitions (SCRUM-69)

This page records **how the app computes each number today** so every surface
(Dashboard, Reports, monthly snapshots, MCP `reports_summary`) can be checked
against one definition. It describes current behaviour. Where the behaviour is a
finance decision that has not been confirmed, it is listed under *Open questions*
and **has not been changed**.

Source of truth for the formulas: `src/lib/reports-metrics.ts` (`computeTotals`,
`groupByKey`, `computeForecast`). The reconciliation test
`src/lib/__tests__/kpi-reconciliation.test.ts` checks that the surfaces agree on
synthetic data.

## Which rows count

| Rule | Value |
|---|---|
| Table | `transactions` |
| Deleted rows | excluded (`is_deleted = false`) on every surface |
| Visibility | whatever RLS lets the signed-in user read (the finance visibility matrix is SCRUM-58, pending) |
| Row limit | **all** matching rows. Since SCRUM-70 every surface reads in 1,000-row pages (`src/lib/read-all.ts`). Before, Dashboard, Reports, Customers and MCP `reports_summary` silently used only the first 1,000 rows. Above 100,000 rows the screen shows an error rather than a partial total. |

## Measures

| KPI | Definition | Notes |
|---|---|---|
| Revenue | Σ `selling_cost` | `NULL` counts as 0 |
| Cost | Σ `input_cost` | `NULL` counts as 0 (blank cost is an open importer question, SCRUM-103 D2) |
| Profit | Revenue − Cost | |
| Margin % | Profit ÷ Revenue × 100; **0 when Revenue is 0** | never divides by zero |
| Transactions | count of rows | |
| Users | Σ `total_users` | a lab running in several months is counted once per row, so this is "user-lines", not unique people |
| Avg per transaction (Dashboard) | Revenue ÷ Transactions | |
| Public / Private | count of rows with `repository_type` = `public_cloud` / `private_cloud` | |

## Periods

| Surface | Period rule |
|---|---|
| Dashboard "this month" | rows where `year`/`month` = the **browser's** current year and month |
| Reports month grouping | `year`/`month` fields on the row |
| Dashboard "New customers" card and trend | customers whose `created_at` is inside the selected range (browser clock); not a transaction measure |
| Monthly snapshots (pg_cron → `/api/public/hooks/mcp-sync` → `runSnapshotSync`) | grouped by `year`/`month` fields |
| MCP `reports_summary` | rows whose **`start_date`** falls in the requested year |
| Reports "Revenue forecast" | for each of the next 12 months, every row whose `start_date` ≤ month end and `end_date` ≥ month start adds its **full** `selling_cost` / `input_cost` to that month |

## Open questions for finance (not changed)

1. **Period field.** Dashboard, Reports and snapshots use the row's `year`/`month`;
   MCP `reports_summary` uses the `start_date` year. A Jan 2026 line for a lab that
   started 15 Dec 2025 is in 2026 on the Dashboard and in 2025 in MCP. The test
   `KNOWN DIFFERENCE` pins this so any change is deliberate. Which one is right?
2. **Forecast amount per month.** The forecast adds the full `selling_cost` of a row
   to every month the lab is active. That is right if `selling_cost` is a monthly
   amount and over-counts if it is the total for the whole lab period.
3. **Users.** Is "Users" meant to be user-lines (current) or unique learners?
4. **"This month" time zone.** It uses the viewer's browser clock, so someone outside
   IST sees a different "this month" around month end.
5. **Margin when revenue is 0.** Currently shown as 0%. Finance may prefer "—".

## Changing a definition

Change `src/lib/reports-metrics.ts` (and the MCP tool if it has its own copy),
update this page and the reconciliation test in the same PR, and get finance sign-off.
