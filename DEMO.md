# Local demo (DEMO / LOCAL ONLY)

This walkthrough uses the Supabase CLI and Docker on your machine. It does not
connect to the hosted project, and it does not publish to mml-labs.com.

Do not run `supabase link`, `supabase db push`, or this seed against any hosted
database. `supabase/seed-demo.sql` is not wired into `config.toml`.
The local stack config is `scripts/demo-local/supabase/config.toml` (the script passes
`--workdir scripts/demo-local`). `supabase/config.toml` stays the one-line `project_id` that
syncs to Lovable, so local auth settings never reach the hosted project.

## One command

From the repo root, with Docker running and the [Supabase CLI](https://supabase.com/docs/guides/cli) on your PATH:

```bash
bash scripts/demo-local.sh
```

The script starts local Supabase, applies the repo migrations with psql (one
transaction per file), loads `supabase/seed-demo.sql`, writes `.env.local`
(gitignored), and starts the app at http://127.0.0.1:8080.

It also sets `VITE_SCRUM44_UI_REVIEW_ENABLED=true` in `.env.local` so the
SCRUM-44 review UI (azure theme + public/private cloud screen refresh) is on
for local demo runs.

## Local migrations required for the demo scope

`scripts/demo-local.sh` applies every SQL file in `supabase/migrations` to the
local database. For this HOLD branch demo, the critical ones are:

- `20260928120200_mml_lab_batches_and_margin.sql` (batch totals, margin model)
- `20260928143000_scrum44_lab_transaction_locks_and_ai_assignment.sql`
  (cost lock, AI worker claim/release path, approval gate statuses)
- `20260925130000_scrum103_import_batches.sql` +
  `20260928031000_scrum103_lenient_import.sql` +
  `20260928040000_scrum103_customer_name_normalize.sql`
  (strict import path and legacy import hardening)
- `20260925150000_scrum92_freshdesk_stale_marker.sql`
  (stale-ticket marker column; sweep stays flag-off unless explicitly enabled)
- `20260928090500_scrum78_role_check_respects_active.sql`
  (disabled users blocked server-side)

If you start from an already running local Supabase stack, re-apply these by
re-running `bash scripts/demo-local.sh` from repo root.

## Dev-only capture smoke path (no hosted dependencies)

When local Supabase bootstrap is unavailable, run the UI smoke review against
the dev-only capture mode (compiled out of production):

```bash
VITE_SUPERADMIN_CAPTURE_MODE=true \
VITE_SCRUM44_UI_REVIEW_ENABLED=true \
npm run dev -- --host 127.0.0.1 --port 4173
```

Then open:

- `http://127.0.0.1:4173/auth` (login screen)
- `http://127.0.0.1:4173/dashboard?captureRole=<role>`
  where role is `admin|leadership|finance|ops_lead|ops_user|viewer`
- `http://127.0.0.1:4173/transactions?captureRole=admin`
- `http://127.0.0.1:4173/public-cloud?captureRole=admin`
- `http://127.0.0.1:4173/private-cloud?captureRole=admin`
- `http://127.0.0.1:4173/tickets?captureRole=admin`
- `http://127.0.0.1:4173/ai-command-center/inbox?captureRole=admin`
- `http://127.0.0.1:4173/admin?captureRole=admin`

Passwords (local only): `DemoLocal!2026`

| Email | Role |
|---|---|
| admin.demo@mml.local | admin (Super Admin) |
| opslead.demo@mml.local | ops_lead |
| ops.demo@mml.local | ops_user |
| viewer.demo@mml.local | viewer |

## Click path

1. Sign in as **admin.demo@mml.local**.
2. **MML Lab → Lab catalog** (`/mml-lab/lab-catalog`). Published, draft and archived rows are listed. Open one published offering.
3. **MML Lab → Cost catalog** (`/mml-lab/cost-catalog`). Leave the calculator at 4 vCPU, 16 GB RAM, 100 GB storage, 30 days, 20 VMs. The result is ₹210 per VM per day and ₹1,26,000 for the period.
4. **Edit prices**. Change **Input cost percent** from 20 to 25, type a short reason, save, then set it back to 20 and save again. The history lists both reasons.
5. **Master ADR Entry** (`/entry`). Choose Private Cloud, selling price per user **350**, total users **30**. The split shows revenue ₹10,500, input cost ₹2,100 (20%), margin ₹8,400. Type licence **Microsoft 365 E3** at **100** and API service **OpenAI GPT-4o API** at **50**. The auto-opening totals are ₹3,000 and ₹1,500.
6. **Public Cloud** (`/public-cloud`).
   - Lean transaction view (10 rows/page) with compact filters.
   - Open any row to verify the right-side detail panel treatment.
   - Check the KPI insights card below the table (credit allocated, actual consumption, unused credit, actual margin).
7. **Private Cloud** (`/private-cloud`).
   - Batch-led view with uncluttered KPI cards.
   - Open a batch and verify the reconciliation line and line-level costs.
8. **All transactions**. Open a `DEMO-GAP` or `DEMO-PRIV` row. The edit drawer shows the same fields and a cost-basis badge.
9. **MML Lab → Batches** (`/mml-lab/batches`).
   - `LB-DEMO-GAP`: revenue ₹55,000, invoice ₹25,000, profit ₹30,000, badge **Auto (avg) × 3**.
   - `LB-DEMO-USD`: closed with a USD 300 invoice at FX 83.50 (₹25,050).
   - `LB-DEMO-PRIV`: open private batch, 20% of the entered 350.
   - `LB-DEMO-LATE`: **overdue_invoice** (closed, no invoice, older than 30 days).
10. **Dashboard** and **Reports**. The cost note names actual, entered and auto-filled counts. As admin, the reports page shows the hybrid solution count (3 tagged programs).
11. **All transactions → Hybrid only**. The filter lists the tagged lines. `DEMO-HYB-SUGGEST` is untagged and is listed as a suggestion on the reports card.
12. Sign out. Sign in as **ops.demo@mml.local**. Lab catalog shows published rows only. Cost catalog has no Edit prices button. Batches have no invoice form. The hybrid checkbox and the hybrid filter are absent.

## Sample batches

| Code | What it shows |
|---|---|
| LB-DEMO-OPEN | Open public batch |
| LB-DEMO-USD | Closed, USD invoice + FX, reports in INR |
| LB-DEMO-GAP | 7 of 10 input costs present; 3 filled with the batch average 2,500; invoice 25,000; profit 30,000 |
| LB-DEMO-PRIV | 350/user × 30, licence + API components, 20% input cost |
| LB-DEMO-LATE | Closed with no invoice for more than 30 days |
