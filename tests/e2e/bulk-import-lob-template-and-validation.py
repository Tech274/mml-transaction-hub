"""E2E: line_of_business is restricted to VILT | Standalone | Integrated.

Covers three assertions in a single Playwright run:
  1. Downloadable templates (public + private) and their sample rows only
     ever emit VILT / Standalone / Integrated in the line_of_business column.
  2. Uploading a CSV with an invalid line_of_business value ("Training") is
     rejected with a per-row + per-column error that names the field, the
     bad value, and the allowed set.
  3. The database-layer constraint rejects any direct insert into
     `transactions` with a bad line_of_business (verifying the API/server
     enforcement, not just the client).

Requires an authenticated ops/admin session via LOVABLE_BROWSER_SUPABASE_*.
"""
import asyncio, json, os, re
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-lob"
ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED = {"VILT", "Standalone", "Integrated"}

BAD_CSV = (
    "potential_id,month,year,customer_name,lab_name,line_of_business,"
    "start_date,end_date,total_users,input_cost,selling_cost,cloud_provider\n"
    "POT-LOB-001,1,2026,Acme Corp,AWS Lab,Training,"
    "2026-01-01,2026-01-31,10,1000.00,1500.00,AWS\n"
)


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


def assert_lob_column_allowed(csv_text: str, label: str):
    lines = [l for l in csv_text.splitlines() if l.strip()]
    assert len(lines) >= 2, f"{label}: template is empty"
    header = [h.strip() for h in lines[0].split(",")]
    assert "line_of_business" in header, f"{label}: header missing line_of_business"
    idx = header.index("line_of_business")
    for i, row in enumerate(lines[1:], start=2):
        cols = [c.strip() for c in row.split(",")]
        val = cols[idx] if idx < len(cols) else ""
        assert val in ALLOWED, (
            f"{label}: row {i} has disallowed line_of_business={val!r}; "
            f"allowed={sorted(ALLOWED)}"
        )
    print(f"OK — {label} uses only {sorted(ALLOWED)}")


async def download_template(page, button_text_re: str) -> str:
    async with page.expect_download() as dl_info:
        await page.get_by_role("button", name=re.compile(button_text_re, re.I)).click()
    download = await dl_info.value
    dest = ROOT / (await download.suggested_filename())
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

        # ---------- 1) Public + Private templates ----------
        await page.goto("http://localhost:8080/entry", wait_until="domcontentloaded")
        await page.get_by_role("tab", name="Bulk Import").click()
        await page.wait_for_selector("button:has-text('Download')", timeout=10000)

        # Public cloud template
        public_csv = await download_template(page, r"Download Public Cloud Template")
        assert_lob_column_allowed(public_csv, "public template")

        # Switch to private cloud, download that template too
        await page.get_by_role("button", name=re.compile(r"Private", re.I)).first.click()
        private_csv = await download_template(page, r"Download Private Cloud Template")
        assert_lob_column_allowed(private_csv, "private template")

        # ---------- 2) Client-side + rendered error UI ----------
        # Switch back to public, upload bad CSV
        await page.get_by_role("button", name=re.compile(r"Public", re.I)).first.click()
        bad_path = ROOT / "bad-lob.csv"
        bad_path.write_text(BAD_CSV)
        await page.set_input_files('input[type="file"]', str(bad_path))
        await page.wait_for_selector('[data-testid="row-errors-2"]', timeout=8000)

        # The cell for line_of_business on row 2 must be flagged invalid.
        cell = page.locator('[data-testid="invalid-cell-2-line_of_business"]')
        assert await cell.count() == 1, "line_of_business cell must be highlighted invalid"

        # The error chip must exist AND surface the allowed-values hint.
        err = page.locator('[data-testid="row-error-2-line_of_business"]')
        err_text = (await err.inner_text()).lower()
        for token in ["line_of_business", "vilt", "standalone", "integrated"]:
            assert token in err_text, f"error UI missing token {token!r}: {err_text!r}"

        hint = page.locator('[data-testid="lob-allowed-hint-2"]')
        assert await hint.count() == 1, "LOB allowed-values hint should be visible"
        await page.screenshot(path=str(ROOT / "1_error_ui.png"))

        # Import button should be disabled (no valid rows) OR importing must not
        # produce a successful run — verify by checking the invalid count toast/label.
        assert await page.locator('button:has-text("Import")').is_disabled(), (
            "Import must be disabled when the only row has an invalid line_of_business"
        )

        # ---------- 3) DB-layer enforcement ----------
        db_result = await page.evaluate(
            """async () => {
              const { supabase } = await import('/src/integrations/supabase/client.ts');
              const { error } = await supabase.from('transactions').insert({
                potential_id: 'POT-LOB-DBCHECK-' + Date.now(),
                customer_name: 'Acme Corp',
                lab_name: 'AWS Lab',
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

        print("OK — templates, error UI, and DB constraint all enforce VILT/Standalone/Integrated")
        await browser.close()


asyncio.run(main())
