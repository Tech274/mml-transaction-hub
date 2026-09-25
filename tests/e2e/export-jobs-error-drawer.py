"""
E2E: open the "View error" drawer for an errored export job and verify the
full last_error payload (name, message, stack) is shown.

Seeds a synthetic errored job into localStorage so the test is deterministic
and doesn't depend on a real failing export.

Run from /dev-server:
    PORT=8080 python3 tests/e2e/export-jobs-error-drawer.py
"""
import asyncio, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/export-jobs-error-drawer")
SHOTS.mkdir(parents=True, exist_ok=True)

SEED_JOB = {
    "id": "job_seed_err_1",
    "filename": "customers-2026-06-26.xlsx",
    "scope": "customers-all",
    "total": 50000,
    "processed": 1200,
    "attempts": 3,
    "status": "error",
    "error": "Workbook write failed: heap out of memory",
    "errorName": "RangeError",
    "errorStack": "RangeError: Workbook write failed: heap out of memory\n    at writeWorkbook (export-xlsx-async.ts:142:12)\n    at buildOnce (export-xlsx-async.ts:118:5)\n    at buildWithRetry (export-xlsx-async.ts:74:18)",
    "startedAt": 1750000000000,
    "endedAt": 1750000010000,
    "user": "qa@example.com",
}


async def restore_session(page):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if key and sess:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})"
        )
    # Seed the export jobs store
    await page.evaluate(
        f"window.localStorage.setItem('lovable.exportJobs.v1', {json.dumps(json.dumps([SEED_JOB]))})"
    )


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await restore_session(page)

        await page.goto(f"{BASE}/admin", wait_until="networkidle")
        # Switch to Export Jobs tab
        tab = page.get_by_role("tab", name="Export Jobs")
        if await tab.count() == 0:
            print("Export Jobs tab not visible — current role lacks feature_export_jobs_view. Skipping.")
            await browser.close()
            return 0
        await tab.click()
        await page.screenshot(path=str(SHOTS / "1_jobs_tab.png"))

        # Click the View error button on the seeded errored job row
        await page.get_by_role("button", name="View error").first.click()

        dlg = page.get_by_role("dialog").filter(has_text="Export job error")
        await dlg.wait_for(state="visible", timeout=3000)
        await page.screenshot(path=str(SHOTS / "2_drawer.png"))

        body = await dlg.inner_text()
        for needle in [
            SEED_JOB["error"],
            SEED_JOB["errorName"],
            "writeWorkbook (export-xlsx-async.ts:142:12)",
            "buildOnce",
            "buildWithRetry",
            SEED_JOB["filename"],
            SEED_JOB["user"],
        ]:
            if needle not in body:
                failures.append(f"drawer missing expected text: {needle!r}")

        await browser.close()

    if failures:
        print("FAILURES:")
        for f in failures: print(" -", f)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
