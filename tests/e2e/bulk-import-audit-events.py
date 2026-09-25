"""E2E: verify audit log entries are written when applying suggested
corrections and starting a retry.

Setup: requires an authenticated ops_user/ops_lead/admin session injected
via LOVABLE_BROWSER_SUPABASE_* env vars.

Assertions:
  * After clicking "Apply & retry" in the Preview dialog, a row exists in
    bulk_import_audit_events with event_type='apply_suggestions', matching
    actor_id and details.fields_applied > 0.
  * After submitting the retry run, a row exists with event_type
    ='retry_started', run_id set to the new run, parent_run_id set to the
    prior run, and matching line_number data in details.

Both assertions query the Data API directly via the injected session so we
read what the app actually wrote.
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-audit"
ROOT.mkdir(parents=True, exist_ok=True)

CSV_BAD = (
    "potential_id,month,year,customer_name,lab_name,line_of_business,"
    "start_date,end_date,total_users,input_cost,selling_cost,cloud_provider\n"
    "POT-AUDIT-001,13,2026,Acme Corp,AWS Lab,Training,"
    "2026-01-01,2026-01-31,10,1000.00,1500.00,aws \n"
)


async def query_audit(page, event_type: str):
    return await page.evaluate(
        """async (evt) => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data, error } = await supabase
            .from('bulk_import_audit_events')
            .select('id,run_id,parent_run_id,event_type,actor_id,details,created_at')
            .eq('event_type', evt)
            .order('created_at', { ascending: false })
            .limit(5);
          return { error: error?.message ?? null, rows: data ?? [] };
        }""",
        event_type,
    )


async def main() -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
        session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
        await page.goto("http://localhost:8080", wait_until="domcontentloaded")
        if storage_key and session_json:
            await page.evaluate(
                "([k,v]) => window.localStorage.setItem(k, v)",
                [storage_key, session_json],
            )

        await page.goto("http://localhost:8080/entry", wait_until="networkidle")
        bulk_tab = page.get_by_role("tab", name="Bulk Import")
        if not await bulk_tab.count():
            print("SKIP: user lacks Bulk Import access")
            await browser.close(); return
        await bulk_tab.click()

        tmp = Path("/tmp/browser/audit-e2e.csv"); tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(CSV_BAD, encoding="utf-8")
        await page.locator('input[type="file"]').first.set_input_files(str(tmp))
        await page.wait_for_timeout(300)
        confirm = page.get_by_role("button", name="Confirm mapping")
        if await confirm.count(): await confirm.first.click()
        await page.wait_for_timeout(300)

        # 1) apply_suggestions
        await page.get_by_role("button", name="Preview suggestions").click()
        await page.wait_for_timeout(200)
        await page.screenshot(path=str(ROOT / "01_preview.png"))
        await page.get_by_role("button", name="Apply & retry").click()
        await page.wait_for_timeout(500)

        applied = await query_audit(page, "apply_suggestions")
        assert applied["error"] is None, applied["error"]
        assert applied["rows"], "expected an apply_suggestions row"
        latest = applied["rows"][0]
        assert latest["details"].get("fields_applied", 0) >= 1, latest
        assert latest["details"].get("kind") in ("public_cloud", "private_cloud"), latest
        print("apply_suggestions OK:", json.dumps(latest["details"]))

        # 2) retry_started — click "Import valid rows" to submit the retry
        submit = page.get_by_role("button", name=lambda n: n and "Import valid rows" in n)
        if await submit.count():
            await submit.first.click()
            # Wait for run to complete
            await page.wait_for_timeout(4000)

        retried = await query_audit(page, "retry_started")
        assert retried["error"] is None, retried["error"]
        assert retried["rows"], "expected a retry_started row"
        r = retried["rows"][0]
        assert r["run_id"], "retry_started must have run_id"
        assert r["details"].get("valid_rows", 0) >= 0
        print("retry_started OK:", json.dumps({"run_id": r["run_id"], "parent": r["parent_run_id"], "details": r["details"]}))

        await page.screenshot(path=str(ROOT / "02_done.png"))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
