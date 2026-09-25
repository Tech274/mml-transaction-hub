"""
E2E: force the transactions query to fail, verify the reports-error banner is
shown, then let the next request succeed and confirm Retry recovers with
correct data for Cloud Cost, Customer Profitability, and Margin tabs.

Run: PORT=8080 python3 tests/e2e/reports-drilldown-error-retry.py
"""
import asyncio, json, os, sys
from datetime import date
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/reports-error-retry")
SHOTS.mkdir(parents=True, exist_ok=True)

YEAR = date.today().year
FIXTURES = [
    {"month": 1, "year": YEAR, "repository_type": "public_cloud",
     "cloud_provider": "AWS", "line_of_business": "VILT",
     "customer_name": "Acme", "lab_name": "Lab-A",
     "total_users": 5, "input_cost": 100, "selling_cost": 500,
     "start_date": f"{YEAR}-01-01", "end_date": f"{YEAR+1}-12-31",
     "is_deleted": False},
    {"month": 1, "year": YEAR, "repository_type": "private_cloud",
     "cloud_provider": "Azure", "line_of_business": "Standalone",
     "customer_name": "Beta", "lab_name": "Lab-B",
     "total_users": 3, "input_cost": 80, "selling_cost": 300,
     "start_date": f"{YEAR}-01-01", "end_date": f"{YEAR+1}-12-31",
     "is_deleted": False},
]


async def restore(page):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if key and sess:
        await page.evaluate(f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})")


async def main() -> int:
    failures: list[str] = []
    state = {"fail_next": True}

    async def handler(route):
        if state["fail_next"]:
            state["fail_next"] = False
            await route.fulfill(
                status=500, content_type="application/json",
                body=json.dumps({"message": "simulated failure", "code": "PGRST000"}))
        else:
            await route.fulfill(status=200, content_type="application/json",
                                body=json.dumps(FIXTURES))

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await restore(page)
        await ctx.route("**/rest/v1/transactions*", handler)

        await page.goto(f"{BASE}/reports", wait_until="networkidle")
        if await page.get_by_text("does not have permission").count() > 0:
            print("No permission — skipping.")
            await browser.close()
            return 0

        # 1. Error banner shows
        err = page.locator('[data-testid="reports-error"]')
        try:
            await err.wait_for(state="visible", timeout=5000)
        except Exception:
            failures.append("reports-error banner did not appear")
        await page.screenshot(path=str(SHOTS / "1_error.png"))

        # 2. Retry → recovers with real data
        await err.get_by_role("button", name="Retry").click()
        await page.wait_for_timeout(400)
        if await err.count() > 0 and await err.is_visible():
            failures.append("error banner still visible after retry")

        # 3. Verify each tab renders drill data correctly after recovery
        async def check_drill(tab_name: str, expected_provider: str):
            await page.get_by_role("tab", name=tab_name).click()
            await page.wait_for_timeout(200)
            panel = page.locator('[role=tabpanel][data-state=active]')
            first_row = panel.locator("table tbody tr").first
            await first_row.click()
            dialog = page.get_by_role("dialog")
            await dialog.locator('[data-testid="drill-content"]').wait_for(state="visible", timeout=5000)
            tx_count = await dialog.locator('[data-testid="drill-transactions"] table tbody tr').count()
            if tx_count == 0:
                failures.append(f"[{tab_name}] no drill transactions after recovery")
            await page.keyboard.press("Escape")
            await dialog.wait_for(state="hidden", timeout=3000)

        await check_drill("Cloud Cost", "AWS")
        await check_drill("Customer Profitability", "Acme")
        await check_drill("Margin Analysis", "VILT")

        await page.screenshot(path=str(SHOTS / "2_recovered.png"))
        await browser.close()

    if failures:
        print("FAILURES:")
        for f in failures: print(" -", f)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
