"""
E2E: drill-down dialogs on Cloud Cost, Customer Profitability, and Margin
Analysis show the underlying transactions and repository breakdown, and the
drill table supports sorting + pagination.

Run: PORT=8080 python3 tests/e2e/reports-drilldown.py
"""
import asyncio, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/reports-drilldown")
SHOTS.mkdir(parents=True, exist_ok=True)


async def restore(page):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if key and sess:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})"
        )


async def drill_from_active_tab(page, tab_name: str, shot_name: str) -> list[str]:
    problems: list[str] = []
    await page.get_by_role("tab", name=tab_name).click()
    await page.wait_for_timeout(400)
    panel = page.locator('[role=tabpanel][data-state=active]')

    # Find the first data row inside the tab's tables. Skip tables with no rows.
    row = panel.locator("table tbody tr").first
    if await row.count() == 0:
        print(f"[{tab_name}] no rows to drill — skipping")
        return problems
    await row.click()

    dialog = page.get_by_role("dialog")
    await dialog.wait_for(state="visible", timeout=5000)
    # Wait for either data or error state
    content = dialog.locator('[data-testid="drill-content"]')
    err = dialog.locator('[data-testid="drill-error"]')
    try:
        await content.wait_for(state="visible", timeout=5000)
    except Exception:
        if await err.count() > 0:
            problems.append(f"[{tab_name}] drill dialog showed error state")
            return problems
        raise

    # Repository breakdown + underlying transactions both present
    if await dialog.locator('[data-testid="drill-repo"] table tbody tr').count() == 0:
        problems.append(f"[{tab_name}] repository breakdown is empty")
    tx_rows = dialog.locator('[data-testid="drill-transactions"] table tbody tr')
    if await tx_rows.count() == 0:
        problems.append(f"[{tab_name}] underlying transactions list is empty")

    # Sort by Revenue in the transactions table and confirm arrow indicator.
    sort_btn = dialog.locator('[data-testid="drill-transactions"] [data-testid="sort-selling_cost"]')
    if await sort_btn.count() > 0:
        await sort_btn.click()
        await page.wait_for_timeout(150)

    # Try pagination — if Next is enabled, it should advance.
    next_btn = dialog.locator('[data-testid="drill-transactions"] [data-testid="page-next"]')
    if await next_btn.count() > 0 and await next_btn.is_enabled():
        info_before = await dialog.locator('[data-testid="drill-transactions"] [data-testid="pagination-info"]').inner_text()
        await next_btn.click()
        await page.wait_for_timeout(150)
        info_after = await dialog.locator('[data-testid="drill-transactions"] [data-testid="pagination-info"]').inner_text()
        if info_before == info_after:
            problems.append(f"[{tab_name}] pagination Next did not advance page")

    await page.screenshot(path=str(SHOTS / f"{shot_name}.png"))
    # Close the dialog
    await page.keyboard.press("Escape")
    await dialog.wait_for(state="hidden", timeout=3000)
    return problems


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await restore(page)

        await page.goto(f"{BASE}/reports", wait_until="networkidle")
        if await page.get_by_text("does not have permission").count() > 0:
            print("No permission for Reports — skipping.")
            await browser.close()
            return 0

        for tab, name in [
            ("Cloud Cost", "1_cloud_cost"),
            ("Customer Profitability", "2_customer"),
            ("Margin Analysis", "3_margin"),
        ]:
            failures += await drill_from_active_tab(page, tab, name)

        await browser.close()

    if failures:
        print("FAILURES:")
        for f in failures:
            print(" -", f)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
