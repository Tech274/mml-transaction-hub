## Problem

## What changes

## Not in this PR

## Pending live step
<!-- e.g. "publish via the agreed flow", "apply migration X to sandbox, then live with approval", or "none" -->

## What to learn from this PR

## Checklist
- [ ] Tests added or updated (`bun run test`); typecheck and build pass
- [ ] No secrets, keys or real finance/customer data in code, tests or fixtures
- [ ] Jira ticket named in the title

### If this PR adds a migration (docs/migrations.md), second reviewer confirms
- [ ] Ticket, "REPO ONLY / NOT APPLIED" status and release order are in the header
- [ ] It's additive, or destructive with `-- approved-destructive:` and Vivek's approval on the ticket
- [ ] The `-- Rollback:` section is written and would work (think about data written in the meantime)
- [ ] Safe with the current live app (old code + new schema, and new code + old schema)
- [ ] New tables: RLS on, no anon grant, a policy per needed command
- [ ] No long lock or rewrite on large tables
- [ ] Added to the register in docs/migrations.md
