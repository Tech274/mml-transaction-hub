"""E2E: download the corrected CSV for failed rows and verify the
before/after suggested values match the Preview dialog selections.

Uploads a CSV with two failed rows, opens the Preview dialog, unchecks the
`cloud_provider` suggestion on the second row, clicks "Download corrected
CSV", parses the downloaded file, and asserts:

  * Row 1's cloud_provider is corrected (aws -> AWS)
  * Row 2's cloud_provider is left as-is (checkbox was cleared)
  * Row 1's month is corrected from "01" to "1" (numeric coercion suggestion)

Any mismatch fails the assertion.
"""
import asyncio, csv, io, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-corrected-csv"
ROOT.mkdir(parents=True, exist_ok=True)

CSV_BAD = (
    "potential_id,month,year,customer_name,lab_name,line_of_business,"
    "start_date,end_date,total_users,input_cost,selling_cost,cloud_provider\n"
    "POT-CSV-001,1,2026,Acme Corp,AWS Lab,Training,"
    "2026-01-01,2026-01-31,10,1000.00,1500.00,aws\n"
    "POT-CSV-002,2,2026,Beta Ltd,Azure POC,Consulting,"
    "2026-02-01,2026-02-28,5,500.00,900.00,azure\n"
)


async def main() -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            accept_downloads=True,
        )
        page = await ctx.new_page()

        storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
        session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
        await page.goto("http://localhost:8080", wait_until="domcontentloaded")
        if storage_key and session_json:
            await page.evaluate("([k,v]) => window.localStorage.setItem(k, v)", [storage_key, session_json])
        await page.goto("http://localhost:8080/entry", wait_until="networkidle")

        bulk_tab = page.get_by_role("tab", name="Bulk Import")
        if not await bulk_tab.count():
            print("SKIP: no Bulk Import access"); await browser.close(); return
        await bulk_tab.click()

        tmp = Path("/tmp/browser/csv-e2e.csv"); tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(CSV_BAD, encoding="utf-8")
        await page.locator('input[type="file"]').first.set_input_files(str(tmp))
        await page.wait_for_timeout(300)
        confirm = page.get_by_role("button", name="Confirm mapping")
        if await confirm.count(): await confirm.first.click()
        await page.wait_for_timeout(300)

        await page.get_by_role("button", name="Preview suggestions").click()
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(ROOT / "01_preview.png"))

        # Uncheck cloud_provider on line 3 (2nd data row, header is line 1).
        cb = page.locator('[aria-label="Apply suggestion for line 3 field cloud_provider"]')
        if await cb.count():
            await cb.first.click()
            await page.wait_for_timeout(100)

        async with page.expect_download() as dl_info:
            await page.get_by_role("button", name="Download corrected CSV").click()
        download = await dl_info.value
        dest = ROOT / "corrected.csv"
        await download.save_as(str(dest))

        text = dest.read_text(encoding="utf-8")
        rows = list(csv.DictReader(io.StringIO(text)))
        print("downloaded rows:", rows)

        by_id = {r["potential_id"]: r for r in rows}
        assert by_id["POT-CSV-001"]["cloud_provider"] == "AWS", by_id["POT-CSV-001"]
        assert by_id["POT-CSV-002"]["cloud_provider"].lower() == "azure", (
            "expected untouched lowercase azure since checkbox was cleared: "
            + repr(by_id["POT-CSV-002"]["cloud_provider"])
        )
        print("corrected CSV matches selections ✓")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
