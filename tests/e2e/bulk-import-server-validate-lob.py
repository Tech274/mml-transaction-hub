"""E2E: validateBulkImportRows stores a bad line of business as blank and warns.

SCRUM-103 (28 Sep): an unknown LOB does not block the import. A trailing space
that trims to a known value is stored as that value.
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-server-validate"
ROOT.mkdir(parents=True, exist_ok=True)

ROWS = [
    dict(potential_id="POT-1", month="1", year="2026", customer_name="Acme",
         lab_name="AWS Lab", line_of_business="VILT",
         start_date="2026-01-01", end_date="2026-01-31", total_users="10",
         input_cost="100", selling_cost="200", cloud_provider="AWS"),
    dict(potential_id="POT-2", month="2", year="2026", customer_name="Beta",
         lab_name="Azure Lab", line_of_business="Standalone ",
         start_date="2026-02-01", end_date="2026-02-28", total_users="5",
         input_cost="50", selling_cost="90", cloud_provider="Azure"),
    dict(potential_id="POT-3", month="3", year="2026", customer_name="Gamma",
         lab_name="GCP Lab", line_of_business="Training",
         start_date="2026-03-01", end_date="2026-03-31", total_users="7",
         input_cost="70", selling_cost="140", cloud_provider="GCP"),
]


async def restore(context, page):
    sk = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sj = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cj = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cj:
        cookies = json.loads(cj)
        for c in cookies: c["url"] = "http://localhost:8080"
        await context.add_cookies(cookies)
    await page.goto("http://localhost:8080")
    if sk and sj:
        await page.evaluate(f"window.localStorage.setItem({json.dumps(sk)}, {json.dumps(sj)})")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await restore(ctx, page)
        await page.goto("http://localhost:8080/entry", wait_until="domcontentloaded")

        result = await page.evaluate(
            """async (rows) => {
              const m = await import('/src/lib/bulk-import.functions.ts');
              return await m.validateBulkImportRows({ data: { kind: 'public_cloud', rows } });
            }""",
            ROWS,
        )
        print("validate response:", json.dumps(result, indent=2))

        assert result["kind"] == "public_cloud"
        assert result["total_rows"] == 3
        assert result["errors"] == []
        assert result["rows_to_import"] == 3

        by_line = {r["line"]: r for r in result["rows"]}
        assert by_line[2]["values"]["line_of_business"] == "VILT"
        assert by_line[3]["values"]["line_of_business"] == "Standalone"
        assert by_line[4]["values"]["line_of_business"] is None

        lob_warnings = [w for w in result["warnings"] if w["column"] == "line_of_business"]
        assert len(lob_warnings) == 1, lob_warnings
        w = lob_warnings[0]
        assert w["line"] == 4 and w["value"] == "Training"
        msg = w["message"].lower()
        for tok in ["vilt", "standalone", "integrated"]:
            assert tok in msg, f"warning missing {tok!r}: {w['message']}"

        print("OK — unknown LOB is a warning and a blank cell, not a block")
        await browser.close()


asyncio.run(main())
