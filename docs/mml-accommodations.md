# MML accommodations (demo slice)

Vivek approved the spec and the open questions on 28 Sep 2026. This note records the
pricing rule that replaces the earlier fixed 250 / 100 reading. The demo runs on a
local Supabase only. See `DEMO.md`.

## Per-user selling price

The per-user selling price is a field the user types on each private-cloud line.
Whatever amount is entered is the base. The figures 250, 100 and 350 were examples.

Input cost incurred = X% of that entered per-user selling price.

- X is `cost_rates.private_input_cost_pct`.
- The default is 20.
- Only an admin can change it. The change needs a reason and is written to `catalog_audit_log`.
- The line stores the percent it used (`input_cost_pct`) so a later rate change does not rewrite saved rows until the form recalculates.

Margin = (100 − X)% of the same entered price.

Batch totals = per-user values × batch size (`total_users`).

Example: entered 350 per user, batch 30, X = 20.

| | Per user | Batch |
|---|---:|---:|
| Revenue | 350 | 10,500 |
| Input cost | 70 | 2,100 |
| Margin | 280 | 8,400 |

Licence and API-key prices, when entered, are components of that selling price.
The form shows each component × batch size (the auto-opening total). The percent
still applies to the entered per-user selling price.

At batch close, a vendor invoice (INR, or USD with a typed FX rate) replaces the
estimate for the batch total. Reports stay in INR. A figure is labelled with the
basis it used: actual invoice allocation, then a typed cost, then an auto-filled
average.

## What this demo includes

Lab catalog, cost catalog and calculator, lab batches, the shared create/edit
fields, the margin routine (including the nightly job), hybrid tags that only an
admin can read, and dashboards/reports on the actual-then-entered-then-auto cost.
The bulk import template is unchanged.
