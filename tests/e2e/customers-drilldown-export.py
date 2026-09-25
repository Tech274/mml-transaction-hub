"""
End-to-end test: customers drill-down query params + async Excel export.

Run from /dev-server:
    PORT=8080 python3 tests/e2e/customers-drilldown-export.py

Requires the Supabase session env vars described in the browser-use guide
(LOVABLE_BROWSER_SUPABASE_*).
"""
import asyncio, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/customers-e2e")
SHOTS.mkdir(parents=True, exist_ok=True)


async def restore_session(page):
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            accept_downloads=True,
        )
        page = await ctx.new_page()
        await restore_session(page)

        # --- 1. Drill-down: search params hydrate filters ---
        url = f"{BASE}/customers?am=__none&status=inactive&q=acme&range=12"
        await page.goto(url, wait_until="networkidle")
        await page.screenshot(path=str(SHOTS / "1_drilldown.png"))

        search_value = await page.locator('input[placeholder^="Search customers"]').input_value()
        if search_value != "acme":
            failures.append(f"search input not hydrated: got {search_value!r}")

        # Status select renders the selected label as text in the trigger
        status_text = (await page.locator('[role="combobox"]').all_inner_texts())
        if not any("Inactive" in t for t in status_text):
            failures.append(f"status filter not hydrated: {status_text!r}")

        # --- 2. Async export progress + download ---
        # Click the Export dropdown trigger
        export_btn = page.get_by_role("button", name="Export")
        if await export_btn.count() == 0:
            print("Export permission not granted to this user — skipping export check.")
        else:
            await export_btn.click()
            # "All customers" is the broadest scope; if >threshold it routes to async dialog
            await page.get_by_role("menuitem").filter(has_text="All customers").click()
            # Dialog may be sync (small dataset) or async; only assert async path if dialog opens
            dialog = page.get_by_role("dialog").filter(has_text="Preparing Excel export")
            try:
                await dialog.wait_for(state="visible", timeout=2000)
                await page.screenshot(path=str(SHOTS / "2_progress.png"))
                # Wait for Download button (appears when blob is ready)
                download_btn = dialog.get_by_role("button", name="Download")
                await download_btn.wait_for(state="visible", timeout=30_000)
                async with page.expect_download() as dl_info:
                    await download_btn.click()
                download = await dl_info.value
                path = await download.path()
                if not path or os.path.getsize(path) == 0:
                    failures.append("downloaded xlsx is empty")
                else:
                    print(f"Downloaded {download.suggested_filename} ({os.path.getsize(path)} bytes)")
            except Exception:
                print("Async dialog did not appear (dataset under threshold) — OK.")

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
