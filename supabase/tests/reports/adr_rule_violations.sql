-- SCRUM-66: report existing transactions that break the ADR entry rules.
-- READ ONLY: runs inside a read-only transaction and rolls back. It fixes nothing.
-- Rules: docs/adr-entry-rules.md (src/lib/adr-entry.ts).
-- Run on SANDBOX first; on live only with approval:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/reports/adr_rule_violations.sql

begin transaction read only;

with live as (
  select * from public.transactions where is_deleted = false
),
checks as (
  select 'potential_id blank or > 50 chars' as rule, id from live
    where length(btrim(coalesce(potential_id, ''))) = 0 or length(btrim(potential_id)) > 50
  union all select 'lab_name blank or > 200 chars', id from live
    where length(btrim(coalesce(lab_name, ''))) = 0 or length(btrim(lab_name)) > 200
  union all select 'public cloud without AWS/Azure/GCP', id from live
    where lab_type = 'public_cloud' and coalesce(cloud_provider, '') not in ('AWS', 'Azure', 'GCP')
  union all select 'private cloud provider is not MakeMyLabs Private Cloud', id from live
    where lab_type = 'private_cloud' and coalesce(cloud_provider, '') <> 'MakeMyLabs Private Cloud'
  union all select 'private cloud without a listed system_config', id from live
    where lab_type = 'private_cloud'
      and coalesce(system_config, '') not in ('8GB 2vCPUs', '8GB 4vCPUs', '12GB 4vCPUs', '16GB 4vCPUs', '24GB 6vCPUs', '32GB 8vCPUs')
  union all select 'input_cost negative or NULL', id from live where input_cost is null or input_cost < 0
  union all select 'amount above 1,000,000,000', id from live where input_cost > 1000000000 or selling_cost > 1000000000
  union all select 'input_cost > selling_cost (negative margin)', id from live where input_cost > selling_cost
  union all select 'end_date before start_date', id from live where end_date < start_date
  union all select 'total_users not > 0', id from live where total_users is null or total_users <= 0
)
select rule,
       count(*) as violations,
       (array_agg(id order by id))[1:20] as example_ids
from checks
group by rule
order by violations desc, rule;

rollback;
