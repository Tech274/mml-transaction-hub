# Customers drill-down & async export — E2E test

Playwright script lives at `tests/e2e/customers-drilldown-export.py`. Run it
against the running app with a signed-in Supabase session injected into the
sandbox (see browser-use docs). It covers:

1. `/customers?am=<name>&status=active&q=acme&range=6` hydrates the AM
   dropdown, status filter, search box, and range filter from search params.
2. The export dropdown opens an async progress dialog when the result set is
   above the threshold, progress reaches 100%, and the "Download" button
   produces a real `.xlsx` blob.
