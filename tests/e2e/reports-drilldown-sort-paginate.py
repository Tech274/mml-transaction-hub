"""
E2E: change sort order + page size + page number on the drill-down tables,
and verify the underlying transactions and repository breakdown update.

Run: PORT=8080 python3 tests/e2e/reports-drilldown-sort-paginate.py
"""
import asyncio, json, os, sys
from datetime import date
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/reports-drilldown-sortpage")
SHOTS.mkdir(parents=True, exist_ok=True)

YEAR = date.today().year

# 30 rows, same provider AWS, distinct customer names, ascending selling_cost
FIXTURES = [
    {"month": 1, "year": YEAR, "repository_type": "public_cloud",
     "cloud_provider": "AWS", "line_of_business": "VILT",
     "customer_name": f"Cust-{i:02d}", "lab_name": f"Lab-{i:02d}",
     "total_users": i, "input_cost": i * 10, "selling_cost": i * 100,
     "start_date": f"{YEAR}-01-01", "end_date": f"{YEAR+1}-12-31",
     "is_deleted": False}
    for i in range(1, 31)
]


async def restore(page):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if key and sess:
        await page.evaluate(f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})")


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await restore(page)
        await ctx.route("**/rest/v1/transactions*", lambda r: r.fulfill(
            status=200, content_type="application/json", body=json.dumps(FIXTURES)))

        await page.goto(f"{BASE}/reports", wait_until="networkidle")
        if await page.get_by_text("does not have permission").count() > 0:
            print("No permission — skipping.")
            await browser.close()
            return 0

        # Drill into the single AWS provider row
        panel = page.locator('[role=tabpanel][data-state=active]')
        await panel.locator("table tbody tr").first.click()
        dialog = page.get_by_role("dialog")
        tx = dialog.locator('[data-testid="drill-transactions"]')
        await tx.wait_for(state="visible", timeout=5000)

        # Default page size is 25 → "Showing 1–25 of 30"
        info = tx.locator('[data-testid="pagination-info"]')
        text = await info.inner_text()
        if "1–25 of 30" not in text:
            failures.append(f"default pagination text unexpected: {text!r}")

        # Change page size to 10 → "Showing 1–10 of 30"
        await tx.locator('[data-testid="page-size"]').select_option("10")
        await page.wait_for_timeout(100)
        text = await info.inner_text()
        if "1–10 of 30" not in text:
            failures.append(f"after page-size=10: {text!r}")
        # Row count should now be 10
        if await tx.locator("table tbody tr").count() != 10:
            failures.append("expected 10 rows after page-size=10")

        # Advance to page 2
        await tx.locator('[data-testid="page-next"]').click()
        await page.wait_for_timeout(100)
        text = await info.inner_text()
        if "11–20 of 30" not in text:
            failures.append(f"after next page: {text!r}")

        # Go back to page 1, then sort by Revenue desc (click sort twice)
        await tx.locator('[data-testid="page-prev"]').click()
        sort_btn = tx.locator('[data-testid="sort-selling_cost"]')
        await sort_btn.click()   # asc
        await sort_btn.click()   # desc
        await page.wait_for_timeout(100)
        first_customer = await tx.locator("table tbody tr").first.locator("td").first.inner_text()
        if first_customer.strip() != "Cust-30":
            failures.append(f"expected Cust-30 first after revenue desc sort, got {first_customer!r}")

        # Sort ascending by Customer name: click Customer sort once
        cust_sort = tx.locator('[data-testid="sort-customer_name"]')
        await cust_sort.click()
        await page.wait_for_timeout(100)
        first_customer = await tx.locator("table tbody tr").first.locator("td").first.inner_text()
        if first_customer.strip() != "Cust-01":
            failures.append(f"expected Cust-01 first after customer asc sort, got {first_customer!r}")

        # Repository breakdown should collapse to a single row with count 30
        repo = dialog.locator('[data-testid="drill-repo"] table tbody tr')
        if await repo.count() != 1:
            failures.append(f"expected 1 repository row, got {await repo.count()}")
        else:
            cells = repo.first.locator("td")
            repo_name = (await cells.nth(0).inner_text()).strip()
            repo_count = (await cells.nth(1).inner_text()).strip()
            if repo_name != "public_cloud" or repo_count != "30":
                failures.append(f"unexpected repo row: {repo_name!r}, count={repo_count!r}")

        await page.screenshot(path=str(SHOTS / "final.png"))
        await browser.close()

    if failures:
        print("FAILURES:")
        for f in failures: print(" -", f)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
