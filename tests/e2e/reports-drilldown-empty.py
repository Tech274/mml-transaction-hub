"""
E2E: drill-down dialog shows a clear empty state (data-testid=drill-empty)
when filter changes leave zero matching transactions — no stale rows.

Run: PORT=8080 python3 tests/e2e/reports-drilldown-empty.py
"""
import asyncio, json, os, sys
from datetime import date
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/reports-drilldown-empty")
SHOTS.mkdir(parents=True, exist_ok=True)

YEAR = date.today().year
OTHER_YEAR = str(YEAR - 3)  # value guaranteed present in the FilterSelect list (YEARS spans -3..+4)

FIXTURES = [
    {"month": 1, "year": YEAR, "repository_type": "public_cloud",
     "cloud_provider": "AWS", "line_of_business": "VILT",
     "customer_name": "Acme", "lab_name": "Lab-1",
     "total_users": 5, "input_cost": 100, "selling_cost": 250,
     "start_date": f"{YEAR}-01-01", "end_date": f"{YEAR+1}-12-31",
     "is_deleted": False},
    {"month": 2, "year": YEAR, "repository_type": "public_cloud",
     "cloud_provider": "AWS", "line_of_business": "VILT",
     "customer_name": "Beta", "lab_name": "Lab-2",
     "total_users": 3, "input_cost": 80, "selling_cost": 200,
     "start_date": f"{YEAR}-01-01", "end_date": f"{YEAR+1}-12-31",
     "is_deleted": False},
]


async def restore(page):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if key and sess:
        await page.evaluate(f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})")


async def mock_transactions(route):
    await route.fulfill(status=200, content_type="application/json",
                        body=json.dumps(FIXTURES))


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await restore(page)
        await ctx.route("**/rest/v1/transactions*", mock_transactions)

        await page.goto(f"{BASE}/reports", wait_until="networkidle")
        if await page.get_by_text("does not have permission").count() > 0:
            print("No permission for Reports — skipping.")
            await browser.close()
            return 0

        # Drill into AWS (only provider in fixture)
        panel = page.locator('[role=tabpanel][data-state=active]')
        await panel.locator("table tbody tr").first.click()
        dialog = page.get_by_role("dialog")
        await dialog.locator('[data-testid="drill-content"]').wait_for(state="visible", timeout=5000)
        await page.screenshot(path=str(SHOTS / "1_open.png"))

        # Now change Year filter to a year with no data
        year_trigger = page.locator("label", has_text="Year").locator("..").locator("[role=combobox]")
        await year_trigger.click()
        await page.get_by_role("option", name=OTHER_YEAR).click()
        await page.wait_for_timeout(300)

        empty = dialog.locator('[data-testid="drill-empty"]')
        if await empty.count() == 0 or not await empty.is_visible():
            failures.append("expected data-testid=drill-empty after filter change")
        # And ensure stale rows are gone
        stale = dialog.locator('[data-testid="drill-transactions"]')
        if await stale.count() > 0:
            failures.append("stale drill transactions table still rendered")
        await page.screenshot(path=str(SHOTS / "2_empty.png"))

        await browser.close()

    if failures:
        print("FAILURES:")
        for f in failures: print(" -", f)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
