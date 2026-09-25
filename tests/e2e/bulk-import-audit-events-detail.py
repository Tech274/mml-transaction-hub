"""E2E: verify audit rows store the EXACT run_id, line_number, and
selected fields list for both apply_suggestions and retry_started events
(not just presence of run_id).

Flow:
  1. Upload a CSV with a known bad row on line 2.
  2. Open the Preview dialog and select a specific subset of suggested
     fields for that row (e.g. only `month` + `cloud_provider`).
  3. Click "Apply & retry", capture the run_id of the parent and child.
  4. Query bulk_import_audit_events and assert:
       * apply_suggestions row: run_id == parent, details.line_numbers
         contains 2, details.fields_applied == ['month','cloud_provider'].
       * retry_started row: run_id == child, parent_run_id == parent,
         details.line_numbers == [2].
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-audit-detail"
ROOT.mkdir(parents=True, exist_ok=True)

CSV_BAD = (
    "potential_id,month,year,customer_name,lab_name,line_of_business,"
    "start_date,end_date,total_users,input_cost,selling_cost,cloud_provider\n"
    "POT-DTL-001,13,2026,Acme Corp,AWS Lab,Training,"
    "2026-01-01,2026-01-31,10,1000.00,1500.00,aws \n"
)


async def restore_session(context, page):
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = "http://localhost:8080"
        await context.add_cookies(cookies)
    await page.goto("http://localhost:8080")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )


async def fetch_audit(page, event_type: str):
    return await page.evaluate(
        """async (evt) => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data, error } = await supabase
            .from('bulk_import_audit_events')
            .select('id,run_id,parent_run_id,event_type,details,created_at')
            .eq('event_type', evt)
            .order('created_at', { ascending: false })
            .limit(1);
          return { error: error?.message ?? null, row: (data ?? [])[0] ?? null };
        }""",
        event_type,
    )


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        await restore_session(context, page)
        await page.goto("http://localhost:8080/bulk-import", wait_until="domcontentloaded")

        # Upload
        csv_path = ROOT / "bad.csv"
        csv_path.write_text(CSV_BAD)
        await page.set_input_files('input[type="file"]', str(csv_path))
        await page.get_by_role("button", name="Import").click()
        await page.wait_for_selector('[data-testid="preview-open"]', timeout=15000)
        await page.locator('[data-testid="preview-open"]').click()

        # Select ONLY 'month' + 'cloud_provider' on the failing row
        await page.locator('[data-testid="preview-clear-all"]').click()
        await page.locator('[data-testid="preview-field-checkbox-2-month"]').check()
        await page.locator('[data-testid="preview-field-checkbox-2-cloud_provider"]').check()
        await page.screenshot(path=str(ROOT / "1_preview.png"))

        await page.get_by_role("button", name="Apply & retry").click()
        await page.wait_for_selector('[data-testid="retry-started"]', timeout=15000)

        applied = await fetch_audit(page, "apply_suggestions")
        retried = await fetch_audit(page, "retry_started")
        print("apply:", json.dumps(applied, indent=2))
        print("retry:", json.dumps(retried, indent=2))

        assert applied["row"], "no apply_suggestions row"
        assert retried["row"], "no retry_started row"

        a_details = applied["row"]["details"] or {}
        r_details = retried["row"]["details"] or {}

        assert applied["row"]["run_id"], "apply_suggestions.run_id missing"
        assert set(a_details.get("fields_applied", [])) == {"month", "cloud_provider"}, (
            f"fields_applied mismatch: {a_details.get('fields_applied')}"
        )
        assert 2 in (a_details.get("line_numbers") or []), (
            f"line_numbers missing 2: {a_details.get('line_numbers')}"
        )

        assert retried["row"]["parent_run_id"] == applied["row"]["run_id"], (
            "retry_started.parent_run_id must equal parent run id"
        )
        assert retried["row"]["run_id"] and retried["row"]["run_id"] != applied["row"]["run_id"], (
            "retry_started.run_id must be a new run id"
        )
        assert r_details.get("line_numbers") == [2], (
            f"retry line_numbers mismatch: {r_details.get('line_numbers')}"
        )

        print("OK — audit rows match exact run_id / line_number / fields")
        await browser.close()


asyncio.run(main())
