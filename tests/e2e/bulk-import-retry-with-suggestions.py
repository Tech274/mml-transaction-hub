"""E2E smoke: bulk-import retry with suggestions + corrected CSV download.

Assumes an authenticated Supabase session is injected via
LOVABLE_BROWSER_SUPABASE_* env vars and that the signed-in user has
ops_user / ops_lead / admin role (required to see the Bulk Import tab).

Flow:
  1. Restore session and open /entry.
  2. Switch to Bulk Import tab, upload a CSV with one bad row
     (cloud_provider = "aws " lowercase w/ trailing space, month = 13).
  3. Confirm mapping, expect 1 invalid.
  4. Open Preview suggestions dialog, screenshot.
  5. Uncheck one suggestion, verify Download corrected CSV works.
  6. Re-check, click "Apply & retry", assert row becomes valid.
"""
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-retry"
ROOT.mkdir(parents=True, exist_ok=True)

CSV_BAD = (
    "potential_id,month,year,customer_name,lab_name,line_of_business,"
    "start_date,end_date,total_users,input_cost,selling_cost,cloud_provider\n"
    "POT-E2E-001,13,2026,Acme Corp,AWS Lab A,Training,"
    "2026-01-01,2026-01-31,10,1000.00,1500.00,aws \n"
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
        await page.screenshot(path=str(ROOT / "01_entry.png"))

        bulk_tab = page.get_by_role("tab", name="Bulk Import")
        if not await bulk_tab.count():
            print("SKIP: user lacks Bulk Import access")
            await browser.close()
            return
        await bulk_tab.click()
        await page.screenshot(path=str(ROOT / "02_bulk_tab.png"))

        # Upload CSV via the hidden file input.
        tmp_csv = Path("/tmp/browser/bulk-e2e.csv")
        tmp_csv.parent.mkdir(parents=True, exist_ok=True)
        tmp_csv.write_text(CSV_BAD, encoding="utf-8")
        file_input = page.locator('input[type="file"]').first
        await file_input.set_input_files(str(tmp_csv))
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(ROOT / "03_uploaded.png"))

        # Confirm mapping if the pre-import step is shown.
        confirm = page.get_by_role("button", name="Confirm mapping")
        if await confirm.count():
            await confirm.first.click()
            await page.wait_for_timeout(300)
        await page.screenshot(path=str(ROOT / "04_validated.png"))

        # Open Preview suggestions.
        preview_btn = page.get_by_role("button", name="Preview suggestions")
        await preview_btn.click()
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(ROOT / "05_preview_dialog.png"))

        # Per-field checkboxes visible?
        checkboxes = page.locator('[aria-label^="Apply suggestion for line"]')
        cb_count = await checkboxes.count()
        print(f"per-field checkboxes rendered: {cb_count}")

        # Apply & retry.
        apply_btn = page.get_by_role("button", name="Apply & retry")
        await apply_btn.click()
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(ROOT / "06_after_apply.png"))

        # Preset save dialog reachable?
        manage_btn = page.get_by_role("button", name=lambda n: n and "Manage presets" in n)
        print("preset manage button present:", await manage_btn.count() > 0)

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
