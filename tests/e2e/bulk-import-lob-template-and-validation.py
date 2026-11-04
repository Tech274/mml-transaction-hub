"""E2E: line_of_business is limited to VILT | Standalone | Integrated.

SCRUM-128 (C2, plan Q4): the legacy importer and its "Download Public/Private Cloud Template"
buttons were deleted with the SCRUM-44 flag. This script now drives the strict importer
(components/strict-import.tsx) and checks its rules as they stand after the 28 Sep 2026 owner
direction ("nothing on upload is a strict rule"):

  1. The "Template" download is header-only (no sample rows, so it can never emit a bad
     line_of_business) and has a "Line of Business" column; the allowed set in
     src/lib/bulk-template.ts is exactly VILT / Standalone / Integrated.
  2. Uploading a row with line_of_business "Training" keeps the row, lists a warning that names
     the column, the bad value and the allowed set, and says the value is stored blank. The row
     is NOT rejected (unit test: src/lib/strict-import/__tests__/validate.test.ts). Nothing is
     imported: the script never presses Import.
  3. The database constraint still rejects a direct insert into `transactions` with a bad
     line_of_business (server enforcement, not just the client).

Requires an authenticated ops/admin session via LOVABLE_BROWSER_SUPABASE_* and a local dev
server on :8080. Synthetic data only.
"""
import asyncio, json, os, re
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-lob"
ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED = {"VILT", "Standalone", "Integrated"}


async def restore(context, page):
    sk = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sj = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cj = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cj:
        cookies = json.loads(cj)
        for c in cookies:
            c["url"] = "http://localhost:8080"
        await context.add_cookies(cookies)
    await page.goto("http://localhost:8080")
    if sk and sj:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(sk)}, {json.dumps(sj)})"
        )


async def download_strict_template(page) -> str:
    async with page.expect_download() as dl_info:
        await page.get_by_role("button", name=re.compile(r"^\s*Template\s*$", re.I)).click()
    download = await dl_info.value
    dest = ROOT / download.suggested_filename
    await download.save_as(str(dest))
    return dest.read_text()


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            accept_downloads=True,
        )
        page = await context.new_page()
        await restore(context, page)

        # ---------- 1) Template ----------
        await page.goto("http://localhost:8080/entry", wait_until="domcontentloaded")
        await page.get_by_role("tab", name=re.compile(r"Bulk import", re.I)).click()
        await page.wait_for_selector("button:has-text('Template')", timeout=10000)

        csv_text = await download_strict_template(page)
        lines = [l for l in csv_text.splitlines() if l.strip()]
        assert len(lines) == 1, "strict template must be header-only (no sample rows)"
        header = [h.strip() for h in lines[0].split(",")]
        assert "Line of Business" in header, f"template header missing Line of Business: {header}"
        allowed = await page.evaluate(
            """async () => { const m = await import('/src/lib/bulk-template.ts');
               return [...m.LINE_OF_BUSINESS_OPTIONS]; }"""
        )
        assert set(allowed) == ALLOWED, f"allowed LOB drifted: {allowed}"
        print(f"OK — template is header-only; allowed LOB = {sorted(ALLOWED)}")

        # ---------- 2) Bad LOB: kept, stored blank, warned ----------
        values = {h: "" for h in header}
        values.update({
            "Potential ID": "POT-LOB-001", "Month": "1", "Year": "2026",
            "Customer Name": "Example Customer", "Lab Name": "Example Lab",
            "Line of Business": "Training", "Start Date": "2026-01-01", "End Date": "2026-01-31",
            "Total Users": "10", "Input Cost": "1000", "Selling Cost": "1500", "Cloud Provider": "AWS",
        })
        bad_path = ROOT / "bad-lob.csv"
        bad_path.write_text(",".join(header) + "\n" + ",".join(values[h] for h in header) + "\n")
        await page.set_input_files('input[type="file"]', str(bad_path))

        warning_row = page.get_by_role("row").filter(has_text="Line of Business").filter(has_text="Training")
        await warning_row.first.wait_for(timeout=15000)
        row_text = (await warning_row.first.inner_text()).lower()
        for token in ["training", "vilt", "standalone", "integrated", "stored blank"]:
            assert token in row_text, f"warning row missing {token!r}: {row_text!r}"
        assert await page.get_by_role("button", name=re.compile(r"^Import 1 rows?$", re.I)).count() == 1, (
            "the row must be kept (lenient import): expected an 'Import 1 rows' button"
        )
        await page.screenshot(path=str(ROOT / "1_warning_ui.png"))

        # ---------- 3) DB-layer enforcement ----------
        db_result = await page.evaluate(
            """async () => {
              const { supabase } = await import('/src/integrations/supabase/client.ts');
              const { error } = await supabase.from('transactions').insert({
                potential_id: 'POT-LOB-DBCHECK-' + Date.now(),
                customer_name: 'Example Customer',
                lab_name: 'Example Lab',
                lab_type: 'public_cloud',
                cloud_provider: 'AWS',
                line_of_business: 'Training',
                start_date: '2026-01-01',
                end_date: '2026-01-31',
                total_users: 1,
                selling_cost: 100,
                month: 1,
                year: 2026,
              });
              return { error: error?.message ?? null, code: error?.code ?? null };
            }"""
        )
        print("DB insert result:", db_result)
        assert db_result["error"], "DB should reject invalid line_of_business insert"
        msg = db_result["error"].lower()
        assert (
            "line_of_business" in msg
            or "check" in msg
            or "constraint" in msg
        ), f"expected constraint violation, got: {db_result['error']}"

        print("OK — template, lenient preview warning, and DB constraint all hold for line_of_business")
        await browser.close()


asyncio.run(main())
