# ADR entry rules (SCRUM-103)

One manual transaction ("ADR entry") and an edit of an existing transaction use the
same rules. Both are in `src/lib/adr-entry.ts`:

- **New transaction**: `src/components/master-adr-form.tsx` and `createAdrTransaction`.
- **Edit**: `src/components/transaction-edit-form.tsx` and `updateAdrTransaction`.
- **Database**: CHECK constraints and RLS on `public.transactions`. Nullable columns
  and the dropped date-order check live in
  `supabase/migrations/20260928031000_scrum103_lenient_import.sql` (applied to live
  28 Sep 2026), so the database accepts a blank business column.

Nothing on the form is required except lab type (public or private), because that
column is NOT NULL. A blank cell is stored as NULL, never as 0. A value that cannot
be stored (a bad date, a negative amount, a line of business outside the list) is
rejected so it is not written as a wrong value.

| Field | Rule | Form + server | Database after the pending migration |
|---|---|---|---|
| Potential ID | optional, at most 200 characters; may repeat | blank → NULL | nullable |
| Month | optional whole number 1–12 | blank → NULL | nullable; `CHECK (month BETWEEN 1 AND 12)` when set |
| Year | optional, 2000–2100 | blank → NULL | nullable; check when set |
| Customer | optional. A typed name is found or created. No id is required | blank → NULL | `customer_id` nullable |
| Lab name | optional, at most 200 characters | blank → NULL | nullable |
| Lab type | `public_cloud` or `private_cloud` | required | NOT NULL |
| Cloud provider | Public: the chosen provider, or NULL. Private: a blank provider is stored as "MakeMyLabs Private Cloud"; a filled provider is kept | yes | nullable. The trigger fills a blank private provider |
| System config | Private only, optional. One of the 6 listed sizes when set | blank → NULL | none. `is_complete` for a private row uses this field |
| Line of business | optional. When set: VILT, Standalone or Integrated | blank → NULL | nullable; check when set |
| Start / end date | optional real dates, YYYY-MM-DD. End before start is a note, and both dates are saved | note only | date-order check dropped |
| Total users | optional whole number > 0 | blank → NULL | nullable; check when set |
| Input cost | optional number ≥ 0 and ≤ 1,000,000,000 | blank → NULL | `CHECK (input_cost IS NULL OR input_cost >= 0)` |
| Selling cost | optional number ≥ 0 and ≤ 1,000,000,000 | blank → NULL | `CHECK (selling_cost IS NULL OR selling_cost >= 0)` |
| Margin | selling below cost is allowed. The form may show a note; it does not block save | note only | none |
| Who may save | admin, ops_lead, ops_user; `created_by` = the signed-in user | server (RLS) | RLS policy "Ops create transactions" |

`is_complete` (All Transactions filter) is true only when every business field has a
value. 0 counts. NULL and blank text do not. A public row needs `cloud_provider`. A
private row needs `system_config`, not a provider. The new private-cloud price fields
are optional and are not part of `is_complete`.

## Private-cloud price (approved 28 Sep 2026)

The per-user selling price is typed on the line. The numbers 250 / 100 / 350 in the
original notes were examples only. Input cost incurred is `private_input_cost_pct`
percent of that entered price. The percent defaults to 20 and an admin can change it
in `cost_rates`. Margin is the remaining percent. Batch totals are the per-user
figures times `total_users`.

Example: 350 per user, 30 users, 20% → revenue 10,500; input cost 70 per user
(2,100); margin 280 per user (8,400).

Licence and API-key prices are components of the entered selling price. The form
shows each component times batch size (the auto-opening total). The percent still
applies to the entered per-user selling price, not to a fixed split. `selling_cost`
is filled from price × users and can be typed over. The product name is stored.
A value that looks like a secret key is rejected. Both the create form and the edit
drawer use `AdrExtraFields`.

## Bulk import

The Bulk Import tab is the lenient importer for admin, ops_lead and ops_user. No
config flag. Every non-blank row inserts one transaction. New customer names are
created automatically and listed as "new customer". Case variants are a warning.
The same file (same SHA-256) shows
`This exact file was already imported on <date> (batch <id>)`
and needs one Import anyway confirmation.

Legacy import is admin-only. It also inserts every non-blank row, including rows
that match an existing transaction or each other.

## Existing records

`supabase/tests/reports/adr_rule_violations.sql` is a **read-only report**. It does
not fix anything. Do not backfill 0 into blank costs.
