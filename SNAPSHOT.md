# SNAPSHOT: review copy synced to live HEAD

This repository mirrors the MML Transaction Hub source at Lovable HEAD.

| Item | Value |
|---|---|
| Source | Lovable project `cf3e24da-03ad-433c-be90-bd7ad878f932` (`mml-internal`, https://mml-internal.lovable.app) |
| Source commit | `7db1fd062445eabfa3de1d6b078522c030a90672`, "Locked down anon table access" |
| Commit date | 25 Sep 2026, 08:13 IST |
| Previous snapshot | `544e54a0909a185a08b89986b700c56a263f7a1c` (17 Sep 2026, 20:01 IST), "Added admin user mgmt & bulk import" |
| Synced | 25 Sep 2026 |

The repo now mirrors Lovable HEAD `7db1fd06` (25 Sep 2026). These three commits landed on live after the 17 Sep snapshot and are included here:

| SHA | Date (IST) | Title |
|---|---|---|
| `9259efcd8ef8a167ab00f9587983767f60aee7d7` | 25 Sep 2026 08:08 | Paused bulk-import cleanup (also bumped `@lovable.dev/vite-tanstack-config` 2.13.1 → 2.23.1 in `package.json` and `bun.lock`) |
| `88b60c100d9be37a3ea791201f4d2da05d6282ca` | 25 Sep 2026 08:10 | Closed public sign-up flow (`src/routes/auth.tsx`) |
| `7db1fd062445eabfa3de1d6b078522c030a90672` | 25 Sep 2026 08:13 | Locked down anon table access (new migrations) |

## Status

- This copy matches the live Lovable tree at `7db1fd06`, except `.env` (left out) and the repo-only review docs below.
- It is still **not** connected to Lovable's native GitHub integration. Edits made here will **not** reach the Lovable project or the live app, and newer Lovable edits will **not** show up here until another sync.
- When a workspace admin connects Lovable's GitHub integration, Lovable creates and syncs **its own** repository, and that repository becomes the source of truth. Once it exists, this snapshot should be archived.
- Do not deploy from this repo.

## Contents

- Every file from the Lovable project at the commit above except `.env`: 216 of the 217 project files.
- `docs/review/`: the review documents (GAP_ANALYSIS.md, REBUILD_PLAN.md, PRIORITIZED_ACTIONS.md). These exist only in this repo and were kept. In the GAP_ANALYSIS copy, exploit-level detail has been removed. The findings, impact and fixes are unchanged.
- `SNAPSHOT.md`: this file.

## Secrets

- **No secrets are included.** `.env` was left out on purpose. It holds only the public Supabase project id, URL and publishable (anon) key. Copy the variable names from the Lovable project, or ask the team for them.
- There are no service-role keys, Freshdesk API keys or other private credentials in the source. Those come from server environment variables and Lovable/Supabase secrets, and none are included here.
- Note: two migrations (`20260916232816_…` and `20260917005823_…`) embed the project's public anon key in their cron job definitions. The anon key is public by design and ships to every browser. It is kept here so the migrations stay byte-identical to the source. It is **not** a secret, but relying on it as a scheduled-job credential is a finding in its own right (see docs/review/GAP_ANALYSIS.md, G-03).
