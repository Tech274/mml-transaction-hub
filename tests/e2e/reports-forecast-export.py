"""
E2E: Revenue Forecasting Excel export respects Year/Provider/LOB filters
and includes both the Totals strip and detailed rows.

Run: PORT=8080 python3 tests/e2e/reports-forecast-export.py
"""
import asyncio, json, os, sys, zipfile
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/reports-forecast-export")
SHOTS.mkdir(parents=True, exist_ok=True)


async def restore(page):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if key and sess:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})"
        )


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800}, accept_downloads=True)
        page = await ctx.new_page()
        await restore(page)

        await page.goto(f"{BASE}/reports", wait_until="networkidle")
        await page.screenshot(path=str(SHOTS / "1_reports.png"))

        # If the user lacks reports access, bail gracefully.
        if await page.get_by_text("does not have permission").count() > 0:
            print("No permission for Reports — skipping.")
            await browser.close()
            return 0

        # Pick the first non-"All" provider and LOB to prove filters propagate to export.
        # (Fall back silently if only one option exists.)
        async def pick(label: str) -> str | None:
            trig = page.locator("label", has_text=label).locator("..").locator("[role=combobox]")
            await trig.click()
            opts = page.locator("[role=option]")
            await opts.first.wait_for()
            n = await opts.count()
            chosen = None
            for i in range(n):
                t = (await opts.nth(i).inner_text()).strip()
                if t and not t.startswith("All"):
                    chosen = t
                    await opts.nth(i).click()
                    break
            else:
                await page.keyboard.press("Escape")
            return chosen

        picked_provider = await pick("Cloud provider")
        picked_lob = await pick("Line of business")
        await page.screenshot(path=str(SHOTS / "2_filters.png"))

        # Switch to Revenue Forecast tab
        await page.get_by_role("tab", name="Revenue Forecast").click()
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(SHOTS / "3_forecast.png"))

        # Click Export Excel within the forecast tab
        forecast_panel = page.locator('[role=tabpanel][data-state=active]')
        export_btn = forecast_panel.get_by_role("button", name="Export Excel")
        async with page.expect_download() as dl:
            await export_btn.click()
        download = await dl.value
        path = await download.path()
        size = os.path.getsize(path) if path else 0
        print(f"Downloaded {download.suggested_filename} ({size} bytes)")
        if size == 0:
            failures.append("empty xlsx download")
        else:
            # Peek inside the xlsx zip to confirm filter metadata + section rows.
            with zipfile.ZipFile(path) as z:
                shared = ""
                if "xl/sharedStrings.xml" in z.namelist():
                    shared = z.read("xl/sharedStrings.xml").decode("utf-8", errors="ignore")
                # Concatenate all sheet xml content
                sheets = "".join(
                    z.read(n).decode("utf-8", errors="ignore")
                    for n in z.namelist() if n.startswith("xl/worksheets/")
                )
                blob = shared + sheets
                for token in ["Totals", "Monthly", "By customer", "By provider", "Revenue", "Applied Filters"]:
                    if token not in blob:
                        failures.append(f"missing '{token}' in exported xlsx")
                if picked_provider and picked_provider not in blob:
                    failures.append(f"provider filter '{picked_provider}' not recorded in xlsx metadata")
                if picked_lob and picked_lob not in blob:
                    failures.append(f"LOB filter '{picked_lob}' not recorded in xlsx metadata")

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
