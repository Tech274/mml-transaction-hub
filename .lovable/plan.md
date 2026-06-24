# MakeMyLabs Internal Transaction Platform — Phased Build

This is a large enterprise platform. I'll build it in the phases you outlined, starting with a solid Phase 1 foundation in this first pass, then iterate. Confirming scope before I start writing code.

## Phase 1 — Foundation (this iteration)

**Backend (Lovable Cloud / Postgres + RLS)**
- Enable Lovable Cloud (Postgres, Auth, Storage).
- Migration creating:
  - `app_role` enum: `admin`, `leadership`, `finance`, `ops_lead`, `ops_user`, `viewer`
  - `user_roles` table + `has_role()` SECURITY DEFINER function (no role on profiles — prevents privilege escalation).
  - `profiles` (id ↔ auth.users, full_name, email) + auto-create trigger on signup.
  - `customers` (id, customer_name, normalized_name UNIQUE, is_active, timestamps).
  - `config_master` (category, key, label, sort_order, is_active) for lab_type, cloud_provider, line_of_business, statuses — seeded.
  - `transactions` (all fields per spec, `repository_type` + `cloud_provider` auto-set by BEFORE INSERT/UPDATE trigger from `lab_type`; `potential_id` UNIQUE; `is_deleted` for soft delete; created/updated by + at).
  - `transaction_activity_log` (id, transaction_id, action, field_name, old/new value, changed_by, changed_at) populated by AFTER INSERT/UPDATE/DELETE trigger that diffs columns.
- RLS on every table:
  - `customers`, `config_master`, `transactions` readable by any authenticated user with a role.
  - INSERT/UPDATE on `transactions` restricted to `ops_user`, `ops_lead`, `admin` (ops_user only on rows they created); soft-delete restricted to `ops_lead`/`admin`.
  - `user_roles` readable by self + admin; writable by admin only.
- GRANTs to `authenticated` + `service_role` on every public table.
- Classification + audit logic lives in DB triggers, so it can't be bypassed by the client.

**Frontend (TanStack Start)**
- Auth: `/auth` page (email/password + Google via Lovable broker). First signup auto-gets `admin` role (bootstrap); subsequent users default to `viewer` until promoted.
- `_authenticated` layout (integration-managed gate).
- App shell with sidebar nav: Dashboard, Master ADR Entry, All Transactions, Public Cloud, Private Cloud, Customers, Reports, Admin Settings. Items hidden based on role.
- **Master ADR Entry form** (single source of truth) — Zod validation matching every rule you listed:
  - Unique Potential ID (server check + DB constraint), End ≥ Start, Users > 0, numeric Selling Cost, required fields, conditional Cloud Provider (required & ∈ {AWS,Azure,GCP} when Public; auto "MakeMyLabs Private Cloud" when Private).
  - Customer combobox with "Create new customer" inline (case-insensitive normalized dedupe).
  - Dropdowns sourced from `config_master`.
- **Public Cloud Repository** view (filter: month/year/customer/provider/LOB/date range; sortable, paginated, column visibility, row → detail drawer with activity log).
- **Private Cloud Repository** view (same shape, no provider filter).
- **All Transactions** view (combined).
- **Customers** module (list with status, transaction count, total users, total revenue; activate/deactivate).
- **Transaction Detail drawer** showing all fields + activity log timeline.
- Stub pages for Dashboard / Reports / Admin Settings with "Phase 2/3" placeholders so nav is complete.

**Design system**
- Clean operational/enterprise look — neutral slate base, single accent (deep teal), data-dense tables, no marketing styling. All tokens in `src/styles.css`, semantic only.

## Phases 2–5 (follow-up iterations, not this turn)
- Phase 2: KPI dashboard + charts (recharts), global search, Excel export (xlsx) with filter metadata, customer summary.
- Phase 3: Admin user/role management UI, config_master editor, soft-delete restore, deeper audit views.
- Phase 4: P&L / cloud cost / profitability / forecasting tables + finance reports.
- Phase 5: E2E tests, monitoring, migration tools, UAT/go-live checklists.

## Technical notes
- DB triggers handle classification + audit (single source of truth, can't be bypassed).
- Roles in separate `user_roles` table queried via `has_role()` SECURITY DEFINER to avoid recursive RLS.
- Soft delete via `is_deleted` flag; all queries filter it out by default.
- Server functions (`createServerFn` + `requireSupabaseAuth`) for uniqueness checks and any privileged ops; never `supabaseAdmin` for normal reads.
- First user → admin bootstrap via a DB trigger checking if `user_roles` is empty.

## Open questions before I start
1. **First-user bootstrap**: OK with "first signup becomes admin, everyone after defaults to viewer until promoted"? Or do you want me to seed a specific admin email?
2. **Auth providers**: Email/password + Google, or email/password only for Phase 1?
3. **Phase 1 scope confirmation**: Ship Phase 1 as scoped above (foundation + entry + repositories + customers, with Dashboard/Reports/Admin as placeholders), then tackle Phase 2 next turn? Or do you want me to push further in one go (longer build, higher risk of issues)?
