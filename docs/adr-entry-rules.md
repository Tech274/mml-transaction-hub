# ADR entry rules (SCRUM-66)

One manual transaction ("ADR entry") is checked in three places:

- **Form**: `src/components/master-adr-form.tsx`, messages next to each field.
- **Server**: `createAdrTransaction` in `src/lib/transactions.functions.ts` checks the same
  schema again, because the browser can be bypassed. Both use `src/lib/adr-entry.ts`.
- **Database**: CHECK constraints and RLS on `public.transactions`, the last line of defence.

| Field | Rule | Form + server | Database |
|---|---|---|---|
| Potential ID | required, 1–50 characters after trimming; may repeat (several lines per potential) | yes | NOT NULL |
| Month | whole number 1–12 | yes | `CHECK (month BETWEEN 1 AND 12)` |
| Year | 2000–2100 | yes | `CHECK (year BETWEEN 2000 AND 2100)` |
| Customer | must be picked from the customer list (id is a UUID) | yes | FK to `customers` |
| Lab name | required, at most 200 characters | yes | NOT NULL |
| Lab type | `public_cloud` or `private_cloud` | yes | CHECK |
| Cloud provider | Public Cloud: AWS, Azure or GCP. Private Cloud: always "MakeMyLabs Private Cloud" (set automatically) | yes | NOT NULL only |
| System config | Private Cloud only; one of the 6 listed sizes | yes | none |
| Line of business | VILT, Standalone or Integrated | yes | `transactions_line_of_business_check` |
| Start / end date | real dates, YYYY-MM-DD; end ≥ start | yes | `CHECK (end_date >= start_date)` |
| Total users | whole number > 0 | yes | `CHECK (total_users > 0)` |
| Input cost | number ≥ 0 and ≤ 1,000,000,000 | yes | `transactions_input_cost_nonneg` (SCRUM-103 migration, not yet applied) |
| Selling cost | number ≥ 0 and ≤ 1,000,000,000 | yes | `CHECK (selling_cost >= 0)` |
| Margin | selling below cost is allowed (28 Sep). The form may show a note; it does not block save | note only | none |
| Who may save | admin, ops_lead, ops_user; `created_by` = the signed-in user | server (RLS) | RLS policy "Ops create transactions" |

No rule is stricter than what the form accepted before SCRUM-66, except where the
database already rejected the value (line of business, dates). Existing workflows are unchanged.

## Existing records

`supabase/tests/reports/adr_rule_violations.sql` is a **read-only report** that counts
existing live transactions breaking each rule, with up to 20 example ids per rule.
It does not fix anything. Run it on sandbox first; on live only with approval.

## Open (not changed here)

- The legacy bulk importer and the strict importer (SCRUM-103) follow the 28 Sep
  rules: blanks are NULL, unstorable cells are NULL plus a preview warning, and
  selling below cost is allowed. Editing a transaction uses `adrEditSchema`, which
  does not re-apply required fields or the old margin check.
- Negative margin (input cost > selling cost) is a note, not a block.
- Database constraints for the rules that only the app enforces (provider, system config,
  margin) could be added as `NOT VALID` constraints after the report shows the existing data.
