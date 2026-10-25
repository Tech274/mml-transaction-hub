-- DEMO / LOCAL ONLY
-- Synthetic INR figures for the MML accommodations walkthrough.
-- Not referenced by config.toml, CI, or any hosted/production path.
-- Do not run this file against a hosted Supabase project.
-- Idempotent: demo rows (DEMO-% / LB-DEMO-%) are replaced on each run.

BEGIN;

-- Remove previous demo rows before touching demo users (created_by references auth.users).
DELETE FROM public.transactions WHERE potential_id LIKE 'DEMO-%';
DELETE FROM public.lab_batch_invoices
 WHERE lab_batch_id IN (SELECT id FROM public.lab_batches WHERE batch_code LIKE 'LB-DEMO-%');
DELETE FROM public.lab_batch_cost_runs
 WHERE lab_batch_id IN (SELECT id FROM public.lab_batches WHERE batch_code LIKE 'LB-DEMO-%');
DELETE FROM public.lab_batches WHERE batch_code LIKE 'LB-DEMO-%';
DELETE FROM public.lab_catalog WHERE title LIKE 'DEMO %';

UPDATE public.customers SET created_by = NULL
 WHERE created_by IN (
   '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-333333333333',
   '44444444-4444-4444-8444-444444444444'
 );

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
VALUES
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
   'admin.demo@mml.local', extensions.crypt('DemoLocal!2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Demo Admin"}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'opslead.demo@mml.local', extensions.crypt('DemoLocal!2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Demo Ops Lead"}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
   'ops.demo@mml.local', extensions.crypt('DemoLocal!2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Demo Ops"}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated',
   'viewer.demo@mml.local', extensions.crypt('DemoLocal!2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Demo Viewer"}'::jsonb, now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
SELECT u.id, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', u.id::text, now(), now(), now()
  FROM auth.users u
 WHERE u.email LIKE '%.demo@mml.local'
   AND NOT EXISTS (
     SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email'
   );

DELETE FROM public.user_roles WHERE user_id IN (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'ops_lead'),
  ('33333333-3333-4333-8333-333333333333', 'ops_user'),
  ('44444444-4444-4444-8444-444444444444', 'viewer');

INSERT INTO public.customers (id, customer_name, normalized_name, created_by) VALUES
  ('c1111111-1111-4111-8111-111111111111', 'Northwind Training', 'northwind training', '11111111-1111-4111-8111-111111111111'),
  ('c2222222-2222-4222-8222-222222222222', 'Contoso Skills', 'contoso skills', '11111111-1111-4111-8111-111111111111'),
  ('c3333333-3333-4333-8333-333333333333', 'Fabrikam Academy', 'fabrikam academy', '11111111-1111-4111-8111-111111111111'),
  ('c4444444-4444-4444-8444-444444444444', 'Adventure Works Labs', 'adventure works labs', '11111111-1111-4111-8111-111111111111')
ON CONFLICT (id) DO NOTHING;

UPDATE public.vm_tiers SET selling_price_per_day = p.sell, internal_cost_per_day = p.cost, price_per_day = p.sell
FROM (VALUES
  ('8GB 2vCPUs', 180::numeric, 90::numeric),
  ('8GB 4vCPUs', 240, 120),
  ('12GB 4vCPUs', 280, 140),
  ('16GB 4vCPUs', 320, 160),
  ('24GB 6vCPUs', 420, 210),
  ('32GB 8vCPUs', 560, 280)
) AS p(code, sell, cost)
WHERE vm_tiers.code = p.code;

INSERT INTO public.vm_tiers (code, vcpu, ram_gb, storage_gb, sort_order, selling_price_per_day, internal_cost_per_day, price_per_day)
VALUES
  ('48GB 12vCPUs', 12, 48, 400, 7, 820, 410, 820),
  ('64GB 16vCPUs', 16, 64, 500, 8, 1100, 550, 1100)
ON CONFLICT (code) DO UPDATE SET
  selling_price_per_day = EXCLUDED.selling_price_per_day,
  internal_cost_per_day = EXCLUDED.internal_cost_per_day,
  price_per_day = EXCLUDED.price_per_day,
  is_active = true;

UPDATE public.cost_rates SET value = 20 WHERE key = 'vcpu_per_day';
UPDATE public.cost_rates SET value = 5 WHERE key = 'ram_gb_per_day';
UPDATE public.cost_rates SET value = 0.50 WHERE key = 'storage_gb_per_day';
UPDATE public.cost_rates SET value = 20 WHERE key = 'private_input_cost_pct';

INSERT INTO public.lab_catalog (id, title, summary, description, lab_type, cloud_provider, default_duration_days, line_of_business, status, published_at, created_by)
VALUES
  ('a1111111-1111-4111-8111-111111111111', 'DEMO AWS Cloud Foundations', 'Starter public lab on AWS', 'Hands-on VPC, IAM and a small compute lab. Published demo offering.', 'public_cloud', 'AWS', 5, 'VILT', 'published', now(), '11111111-1111-4111-8111-111111111111'),
  ('a2222222-2222-4222-8222-222222222222', 'DEMO Azure Data Lab', 'Azure data engineering lab', 'Published Azure lab used by the gap-fill batch.', 'public_cloud', 'Azure', 10, 'Integrated', 'published', now(), '11111111-1111-4111-8111-111111111111'),
  ('a3333333-3333-4333-8333-333333333333', 'DEMO Private Kubernetes Studio', 'Private-cloud VM lab', 'Published private offering. Selling price is entered per user.', 'private_cloud', 'MakeMyLabs Private Cloud', 30, 'Standalone', 'published', now(), '11111111-1111-4111-8111-111111111111'),
  ('a4444444-4444-4444-8444-444444444444', 'DEMO GCP Security Drill', 'Draft, not on the public list', 'Editors can see this draft. Other roles cannot.', 'public_cloud', 'GCP', 3, 'VILT', 'draft', NULL, '11111111-1111-4111-8111-111111111111'),
  ('a5555555-5555-4555-8555-555555555555', 'DEMO Archived Windows Admin', 'Retired offering', 'Archived. Hidden from roles that only see published rows.', 'public_cloud', 'Azure', 2, 'VILT', 'archived', NULL, '11111111-1111-4111-8111-111111111111'),
  ('a6666666-6666-4666-8666-666666666666', 'DEMO Private AI Workstation', 'Draft private lab', 'Draft private-cloud offering awaiting publish.', 'private_cloud', 'MakeMyLabs Private Cloud', 15, 'Standalone', 'draft', NULL, '11111111-1111-4111-8111-111111111111');

INSERT INTO public.lab_batches (id, batch_code, name, potential_id, lab_type, status, created_by) VALUES
  ('b1111111-1111-4111-8111-111111111111', 'LB-DEMO-OPEN', 'Open public batch', 'DEMO-OPEN', 'public_cloud', 'open', '11111111-1111-4111-8111-111111111111'),
  ('b2222222-2222-4222-8222-222222222222', 'LB-DEMO-USD', 'Closed USD invoice', 'DEMO-USD', 'public_cloud', 'open', '11111111-1111-4111-8111-111111111111'),
  ('b3333333-3333-4333-8333-333333333333', 'LB-DEMO-GAP', '7 of 10 costs known', 'DEMO-GAP', 'public_cloud', 'open', '11111111-1111-4111-8111-111111111111'),
  ('b4444444-4444-4444-8444-444444444444', 'LB-DEMO-PRIV', 'Private 20 percent', 'DEMO-PRIV', 'private_cloud', 'open', '11111111-1111-4111-8111-111111111111'),
  ('b5555555-5555-4555-8555-555555555555', 'LB-DEMO-LATE', 'Closed, invoice overdue', 'DEMO-LATE', 'public_cloud', 'open', '11111111-1111-4111-8111-111111111111');

-- Vivek's example: 10 lines, revenue 55,000, 7 known input costs of 2,500, 3 blank.
INSERT INTO public.transactions (
  id, potential_id, month, year, customer_id, customer_name, lab_name, lab_type, cloud_provider,
  line_of_business, start_date, end_date, total_users, selling_cost, input_cost, created_by, lab_batch_id
)
SELECT
  ('00000000-0000-4000-8000-0000000000' || lpad(to_hex(i), 2, '0'))::uuid,
  'DEMO-GAP-' || lpad(i::text, 2, '0'),
  9, 2026,
  'c1111111-1111-4111-8111-111111111111', 'Northwind Training',
  'Azure Admin Batch Lab', 'public_cloud', 'Azure', 'VILT',
  DATE '2026-09-01', DATE '2026-09-30', 10, 5500,
  CASE WHEN i <= 7 THEN 2500 ELSE NULL END,
  '11111111-1111-4111-8111-111111111111',
  'b3333333-3333-4333-8333-333333333333'
FROM generate_series(1, 10) AS i;

INSERT INTO public.transactions (
  id, potential_id, month, year, customer_id, customer_name, lab_name, lab_type, cloud_provider,
  line_of_business, start_date, end_date, total_users, selling_cost, input_cost, created_by, lab_batch_id
) VALUES
  ('d2222222-2222-4222-8222-222222222221', 'DEMO-USD-01', 9, 2026, 'c2222222-2222-4222-8222-222222222222', 'Contoso Skills', 'AWS Billing Lab', 'public_cloud', 'AWS', 'Integrated', '2026-09-01', '2026-09-15', 8, 8000, 4000, '11111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222'),
  ('d2222222-2222-4222-8222-222222222222', 'DEMO-USD-02', 9, 2026, 'c2222222-2222-4222-8222-222222222222', 'Contoso Skills', 'AWS Billing Lab', 'public_cloud', 'AWS', 'Integrated', '2026-09-01', '2026-09-15', 8, 8000, 4000, '11111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222'),
  ('d2222222-2222-4222-8222-222222222223', 'DEMO-USD-03', 9, 2026, 'c2222222-2222-4222-8222-222222222222', 'Contoso Skills', 'AWS Billing Lab', 'public_cloud', 'AWS', 'Integrated', '2026-09-01', '2026-09-15', 8, 8000, 4000, '11111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222'),
  ('d2222222-2222-4222-8222-222222222224', 'DEMO-USD-04', 9, 2026, 'c2222222-2222-4222-8222-222222222222', 'Contoso Skills', 'AWS Billing Lab', 'public_cloud', 'AWS', 'Integrated', '2026-09-01', '2026-09-15', 8, 8000, 4000, '11111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222'),
  ('d1111111-1111-4111-8111-111111111111', 'DEMO-OPEN-01', 9, 2026, 'c3333333-3333-4333-8333-333333333333', 'Fabrikam Academy', 'GCP Dataflow Lab', 'public_cloud', 'GCP', 'Standalone', '2026-09-05', '2026-09-20', 12, 9000, 4200, '33333333-3333-4333-8333-333333333333', 'b1111111-1111-4111-8111-111111111111'),
  ('d1111111-1111-4111-8111-111111111112', 'DEMO-OPEN-02', 9, 2026, 'c3333333-3333-4333-8333-333333333333', 'Fabrikam Academy', 'GCP Dataflow Lab', 'public_cloud', 'GCP', 'Standalone', '2026-09-05', '2026-09-20', 12, 9000, NULL, '33333333-3333-4333-8333-333333333333', 'b1111111-1111-4111-8111-111111111111'),
  ('d1111111-1111-4111-8111-111111111113', 'DEMO-OPEN-03', 9, 2026, 'c4444444-4444-4444-8444-444444444444', 'Adventure Works Labs', 'AWS Networking Lab', 'public_cloud', 'AWS', 'VILT', '2026-09-08', '2026-09-12', 6, 4500, 1800, '33333333-3333-4333-8333-333333333333', 'b1111111-1111-4111-8111-111111111111'),
  ('d5555555-5555-4555-8555-555555555551', 'DEMO-LATE-01', 8, 2026, 'c4444444-4444-4444-8444-444444444444', 'Adventure Works Labs', 'Azure Identity Lab', 'public_cloud', 'Azure', 'VILT', '2026-08-01', '2026-08-10', 5, 3000, 1500, '22222222-2222-4222-8222-222222222222', 'b5555555-5555-4555-8555-555555555555'),
  ('d5555555-5555-4555-8555-555555555552', 'DEMO-LATE-02', 8, 2026, 'c4444444-4444-4444-8444-444444444444', 'Adventure Works Labs', 'Azure Identity Lab', 'public_cloud', 'Azure', 'VILT', '2026-08-01', '2026-08-10', 5, 3000, NULL, '22222222-2222-4222-8222-222222222222', 'b5555555-5555-4555-8555-555555555555');

-- Private line: entered 350/user × 30. Input cost is 20% = 2,100. Licence and API are components.
INSERT INTO public.transactions (
  id, potential_id, month, year, customer_id, customer_name, lab_name, lab_type, cloud_provider,
  system_config, line_of_business, start_date, end_date, total_users, selling_cost, input_cost,
  selling_price_per_user, vm_price_per_user, license_name, license_price_per_user,
  api_key_service, api_key_price_per_user, input_cost_per_user, input_cost_pct,
  vm_hours_consumed, license_seats_used, api_units_consumed, api_unit_label,
  created_by, lab_batch_id
) VALUES (
  'd4444444-4444-4444-8444-444444444441', 'DEMO-PRIV-01', 9, 2026,
  'c1111111-1111-4111-8111-111111111111', 'Northwind Training', 'Private Kubernetes Studio',
  'private_cloud', 'MakeMyLabs Private Cloud', '32GB 8vCPUs', 'Standalone',
  '2026-09-01', '2026-09-30', 30, 10500, 2100,
  350, 200, 'Microsoft 365 E3', 100, 'OpenAI GPT-4o API', 50, 70, 20,
  720, 30, 150000, 'tokens',
  '11111111-1111-4111-8111-111111111111', 'b4444444-4444-4444-8444-444444444444'
);

-- Hybrid programs. One solution = one distinct potential id. The untagged pair is a suggestion.
INSERT INTO public.transactions (
  id, potential_id, month, year, customer_id, customer_name, lab_name, lab_type, cloud_provider,
  system_config, line_of_business, start_date, end_date, total_users, selling_cost, input_cost, created_by
) VALUES
  ('e1111111-1111-4111-8111-111111111111', 'DEMO-HYB-001', 9, 2026, 'c3333333-3333-4333-8333-333333333333', 'Fabrikam Academy', 'Hybrid Security Public', 'public_cloud', 'AWS', NULL, 'Integrated', '2026-09-10', '2026-09-20', 20, 12000, 6000, '11111111-1111-4111-8111-111111111111'),
  ('e1111111-1111-4111-8111-111111111112', 'DEMO-HYB-001', 9, 2026, 'c3333333-3333-4333-8333-333333333333', 'Fabrikam Academy', 'Hybrid Security Private', 'private_cloud', 'MakeMyLabs Private Cloud', '16GB 4vCPUs', 'Integrated', '2026-09-10', '2026-09-20', 20, 8000, 1600, '11111111-1111-4111-8111-111111111111'),
  ('e2222222-2222-4222-8222-222222222221', 'DEMO-HYB-002', 9, 2026, 'c2222222-2222-4222-8222-222222222222', 'Contoso Skills', 'Hybrid Data Public', 'public_cloud', 'GCP', NULL, 'VILT', '2026-09-02', '2026-09-09', 15, 7000, 2800, '22222222-2222-4222-8222-222222222222'),
  ('e3333333-3333-4333-8333-333333333331', 'DEMO-HYB-003', 9, 2026, 'c4444444-4444-4444-8444-444444444444', 'Adventure Works Labs', 'Hybrid Ops Private', 'private_cloud', 'MakeMyLabs Private Cloud', '24GB 6vCPUs', 'Standalone', '2026-09-03', '2026-09-18', 10, 5000, 1000, '22222222-2222-4222-8222-222222222222'),
  ('e4444444-4444-4444-8444-444444444441', 'DEMO-HYB-SUGGEST', 9, 2026, 'c1111111-1111-4111-8111-111111111111', 'Northwind Training', 'Suggested Hybrid Public', 'public_cloud', 'Azure', NULL, 'Integrated', '2026-09-12', '2026-09-19', 9, 4500, 2000, '33333333-3333-4333-8333-333333333333'),
  ('e4444444-4444-4444-8444-444444444442', 'DEMO-HYB-SUGGEST', 9, 2026, 'c1111111-1111-4111-8111-111111111111', 'Northwind Training', 'Suggested Hybrid Private', 'private_cloud', 'MakeMyLabs Private Cloud', '8GB 4vCPUs', 'Integrated', '2026-09-12', '2026-09-19', 9, 3600, 720, '33333333-3333-4333-8333-333333333333');

INSERT INTO public.transaction_tags (transaction_id, tag, created_by)
SELECT id, 'hybrid', '11111111-1111-4111-8111-111111111111'
  FROM public.transactions
 WHERE potential_id IN ('DEMO-HYB-001', 'DEMO-HYB-002', 'DEMO-HYB-003');

-- Close after the lines exist. The guard rejects inserts into a closed batch.
UPDATE public.lab_batches
   SET status = 'closed_estimated', closed_at = now(), closed_by = '11111111-1111-4111-8111-111111111111'
 WHERE batch_code IN ('LB-DEMO-USD', 'LB-DEMO-GAP');

UPDATE public.lab_batches
   SET status = 'closed_estimated',
       closed_at = now() - interval '45 days',
       closed_by = '22222222-2222-4222-8222-222222222222'
 WHERE batch_code = 'LB-DEMO-LATE';

INSERT INTO public.lab_batch_invoices (
  id, lab_batch_id, vendor, invoice_ref, invoice_date, currency, amount, fx_rate_to_inr, amount_inr, is_final, source, created_by
) VALUES
  ('f2222222-2222-4222-8222-222222222222', 'b2222222-2222-4222-8222-222222222222', 'Contoso Cloud USD', 'INV-DEMO-USD-300', '2026-09-18', 'USD', 300, 83.50, 25050, true, 'vendor_invoice', '11111111-1111-4111-8111-111111111111'),
  ('f3333333-3333-4333-8333-333333333333', 'b3333333-3333-4333-8333-333333333333', 'Northwind Vendor', 'INV-DEMO-GAP-25000', '2026-09-22', 'INR', 25000, NULL, 25000, true, 'vendor_invoice', '22222222-2222-4222-8222-222222222222');

SELECT public.recompute_lab_batch_costs(id, 'invoice')
  FROM public.lab_batches
 WHERE batch_code IN ('LB-DEMO-USD', 'LB-DEMO-GAP', 'LB-DEMO-PRIV', 'LB-DEMO-LATE', 'LB-DEMO-OPEN');

-- Ticket the local triage walkthrough opens. Synthetic only.
INSERT INTO public.freshdesk_tickets (id, subject, status, company_name, description_text, requester_email, priority)
VALUES (
  9001001,
  'DEMO cannot access the lab portal',
  'Open',
  'Northwind Training',
  'The portal says access denied.',
  'learner@example.test',
  'High'
)
ON CONFLICT (id) DO UPDATE SET
  subject = EXCLUDED.subject,
  status = EXCLUDED.status,
  company_name = EXCLUDED.company_name,
  description_text = EXCLUDED.description_text,
  requester_email = EXCLUDED.requester_email,
  priority = EXCLUDED.priority;

COMMIT;
