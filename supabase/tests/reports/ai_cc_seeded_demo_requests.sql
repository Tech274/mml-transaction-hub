-- SCRUM-76 (G-09): find lab requests created by the old demo seeding in the Cost / ADR agent.
-- READ-ONLY. Lists rows for review; deletes nothing. Any clean-up needs Vivek's approval.
-- Run in sandbox first. On live only with approval (see docs/ai-command-center.md).
begin read only;

select
  r.id,
  r.request_code,
  r.customer_name,
  r.lab_name,
  r.status,
  r.confirmed_at,
  r.created_at,
  (select count(*) from public.ai_cc_inbox i where i.payload->>'lab_request_id' = r.id::text) as inbox_items,
  (select count(*) from public.ai_cc_runs u where u.output_json->>'seeded_lab_request' = r.request_code) as runs_that_seeded_it
from public.ai_cc_lab_requests r
where r.requisition->>'notes' = 'Seeded demo requisition.'
   or exists (select 1 from public.ai_cc_runs u where u.output_json->>'seeded_lab_request' = r.request_code)
order by r.created_at;

rollback;
