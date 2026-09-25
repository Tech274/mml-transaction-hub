# SNAPSHOT: read-only review copy

This repository is a **read-only review snapshot** of the MML Transaction Hub source code, taken from Lovable.

| Item | Value |
|---|---|
| Source | Lovable project `cf3e24da-03ad-433c-be90-bd7ad878f932` (`mml-internal`, https://mml-internal.lovable.app) |
| Source commit | `544e54a0909a185a08b89986b700c56a263f7a1c`, "Added admin user mgmt & bulk import" |
| Commit date | 17 Sep 2026, 14:31 UTC (20:01 IST) |
| Snapshot taken | 25 Sep 2026 (IST), by Atlas for Vivek C |
| Method | Files were read through the Lovable API and pushed with the GitHub API. No git clone was used and nothing in Lovable was changed. |

## Status: NOT synced with Lovable

- This repo is **not** connected to Lovable. Edits made here will **not** reach the Lovable project or the live app, and new Lovable edits will **not** show up here.
- Lovable's native GitHub integration has **not** been connected yet. A workspace admin still needs to connect it. When they do, Lovable creates and syncs **its own** repository, and that repository becomes the source of truth. Once it exists, this snapshot should be archived.
- Treat this repo as a reference for the review only. Do not deploy from it.

## Contents

- Every file from the Lovable project at the commit above except `.env`: 214 of the 215 project files.
- `docs/review/`: the review documents (GAP_ANALYSIS.md, REBUILD_PLAN.md, PRIORITIZED_ACTIONS.md). In the GAP_ANALYSIS copy, exploit-level detail has been removed. The findings, impact and fixes are unchanged.
- `SNAPSHOT.md`: this file.

## Secrets

- **No secrets are included.** `.env` was left out on purpose. It holds only the public Supabase project id, URL and publishable (anon) key. Copy the variable names from the Lovable project, or ask the team for them.
- There are no service-role keys, Freshdesk API keys or other private credentials in the source. Those come from server environment variables and Lovable/Supabase secrets, and none are included here.
- Note: two migrations (`20260916232816_…` and `20260917005823_…`) embed the project's public anon key in their cron job definitions. The anon key is public by design and ships to every browser. It is kept here so the migrations stay byte-identical to the source. It is **not** a secret, but relying on it as a scheduled-job credential is a finding in its own right (see docs/review/GAP_ANALYSIS.md, G-03).
