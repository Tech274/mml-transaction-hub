-- SCRUM-70: independent KPI reconciliation (read-only).
-- Recomputes every finance KPI straight from public.transactions in SQL, so the
-- numbers on Dashboard / Reports / MCP / snapshots can be checked against it.
-- Definitions: docs/kpi-definitions.md
--
-- Run on SANDBOX first. On live, only with approval, as a read-only session:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/reconciliation/kpi_reconciliation.sql
-- Nothing here writes: the whole script runs inside a READ ONLY transaction
-- that is rolled back.

begin transaction read only;

-- 1. Headline totals (Dashboard KPI cards; Reports totals with no filter).
select
  count(*)                                              as transactions,
  coalesce(sum(total_users), 0)                         as users,
  round(coalesce(sum(selling_cost), 0), 2)              as revenue,
  round(coalesce(sum(input_cost), 0), 2)                as cost,
  round(coalesce(sum(selling_cost), 0) - coalesce(sum(input_cost), 0), 2) as profit,
  case when coalesce(sum(selling_cost), 0) > 0
       then round((sum(selling_cost) - coalesce(sum(input_cost), 0)) / sum(selling_cost) * 100, 2)
       else 0 end                                       as margin_pct,
  count(*) filter (where repository_type = 'public_cloud')  as public_cloud,
  count(*) filter (where repository_type = 'private_cloud') as private_cloud
from public.transactions
where is_deleted = false;

-- 2. By period as Dashboard/Reports/snapshots define it (year/month fields).
select year, month,
       count(*) as transactions,
       round(coalesce(sum(selling_cost), 0), 2) as revenue,
       round(coalesce(sum(input_cost), 0), 2)   as cost
from public.transactions
where is_deleted = false
group by year, month
order by year, month;

-- 3. Size of the known period difference (open finance question 1):
--    MCP reports_summary uses the start_date year, the app uses the year field.
select year as year_field,
       extract(year from start_date)::int as start_date_year,
       count(*) as transactions,
       round(coalesce(sum(selling_cost), 0), 2) as revenue
from public.transactions
where is_deleted = false
  and start_date is not null
  and extract(year from start_date)::int <> year
group by 1, 2
order by 1, 2;

-- 4. Latest successful snapshot run vs live data now.
--    Differences are expected only for changes made after the run started.
with last_run as (
  select id, started_at
  from public.sync_runs
  where kind = 'snapshot' and status = 'success'
  order by started_at desc
  limit 1
),
snap as (
  select sum(transactions_count) as transactions, round(sum(revenue), 2) as revenue, round(sum(cost), 2) as cost
  from public.report_snapshots
  where run_id = (select id from last_run)
),
live as (
  select count(*) as transactions, round(coalesce(sum(selling_cost), 0), 2) as revenue, round(coalesce(sum(input_cost), 0), 2) as cost
  from public.transactions
  where is_deleted = false
)
select (select started_at from last_run) as snapshot_started_at,
       snap.transactions as snapshot_transactions, live.transactions as live_transactions,
       snap.revenue as snapshot_revenue, live.revenue as live_revenue,
       snap.cost as snapshot_cost, live.cost as live_cost
from snap, live;

-- 5. Data-quality counts that change KPI meaning.
select
  count(*) filter (where selling_cost is null) as revenue_null,
  count(*) filter (where input_cost is null)   as cost_null,
  count(*) filter (where selling_cost < 0)     as revenue_negative,
  count(*) filter (where input_cost < 0)       as cost_negative,
  count(*) filter (where total_users is null)  as users_null,
  count(*) filter (where year is null or month is null or month not between 1 and 12) as bad_period
from public.transactions
where is_deleted = false;

rollback;
