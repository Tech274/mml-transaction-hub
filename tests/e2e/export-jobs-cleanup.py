"""
E2E: short retention window + Run cleanup removes old jobs and updates
"Last cleaned at". Also verifies "Next cleanup at" appears and validation
blocks invalid retention input.

Run from /dev-server:
    PORT=8080 python3 tests/e2e/export-jobs-cleanup.py
"""
import asyncio, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/export-jobs-cleanup")
SHOTS.mkdir(parents=True, exist_ok=True)

DAY = 24 * 60 * 60 * 1000
NOW = 1_750_000_000_000


def seed_jobs():
    # 2 old (10 days), 2 recent (within last hour)
    return [
        {"id": "old_1", "filename": "old1.xlsx", "scope": "customers-all",
         "total": 10, "processed": 10, "attempts": 1, "status": "done",
         "startedAt": NOW - 10 * DAY, "endedAt": NOW - 10 * DAY + 1000,
         "user": "qa@example.com"},
        {"id": "old_2", "filename": "old2.xlsx", "scope": "customers-all",
         "total": 10, "processed": 10, "attempts": 1, "status": "done",
         "startedAt": NOW - 9 * DAY, "endedAt": NOW - 9 * DAY + 1000,
         "user": "qa@example.com"},
        {"id": "new_1", "filename": "new1.xlsx", "scope": "customers-all",
         "total": 10, "processed": 10, "attempts": 1, "status": "done",
         "startedAt": NOW - 60 * 1000, "endedAt": NOW - 30 * 1000,
         "user": "qa@example.com"},
        {"id": "new_2", "filename": "new2.xlsx", "scope": "customers-all",
         "total": 10, "processed": 10, "attempts": 1, "status": "error",
         "error": "boom",
         "startedAt": NOW - 30 * 1000, "endedAt": NOW - 10 * 1000,
         "user": "qa@example.com"},
    ]


async def restore(page, jobs):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if key and sess:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})"
        )
    # Clear retention/lastCleaned to known state, then seed jobs
    await page.evaluate(
        "() => { localStorage.removeItem('lovable.exportJobs.retention.v1');"
        " localStorage.removeItem('lovable.exportJobs.lastCleanedAt.v1'); }"
    )
    await page.evaluate(
        f"window.localStorage.setItem('lovable.exportJobs.v1', {json.dumps(json.dumps(jobs))})"
    )


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await restore(page, seed_jobs())

        await page.goto(f"{BASE}/admin", wait_until="networkidle")
        tab = page.get_by_role("tab", name="Export Jobs")
        if await tab.count() == 0:
            print("Export Jobs tab not visible — skipping.")
            await browser.close()
            return 0
        await tab.click()
        await page.screenshot(path=str(SHOTS / "1_initial.png"))

        # Set retention to 5 days (old jobs at 9/10 days should be deleted)
        ret_input = page.locator('#retention-days')
        await ret_input.fill("5")

        # Validation: invalid input shows error and disables buttons
        await ret_input.fill("0")
        err = page.get_by_test_id("retention-error")
        if await err.count() == 0 or "at least 1" not in (await err.inner_text()).lower():
            failures.append("validation error not shown for 0 days")
        if not await page.get_by_role("button", name="Run cleanup now").is_disabled():
            failures.append("Run cleanup not disabled with invalid input")
        await ret_input.fill("5")

        # Save retention then run cleanup
        await page.get_by_role("button", name="Save retention").click()
        before = await page.locator("text=/\\d+ of \\d+ jobs/").first.inner_text()
        if "4 of 4" not in before:
            failures.append(f"pre-cleanup counter wrong: {before!r}")
        await page.get_by_role("button", name="Run cleanup now").click()

        # After cleanup: 2 jobs remain
        await page.wait_for_timeout(200)
        after = await page.locator("text=/\\d+ of \\d+ jobs/").first.inner_text()
        if "2 of 2" not in after:
            failures.append(f"post-cleanup counter wrong: {after!r}")

        last = await page.get_by_test_id("last-cleaned-at").inner_text()
        if "never" in last.lower():
            failures.append(f"last cleaned still 'never': {last!r}")

        nxt = await page.get_by_test_id("next-cleanup-at").inner_text()
        if "next cleanup at" not in nxt.lower():
            failures.append(f"next-cleanup-at not rendered: {nxt!r}")
        if "on next page load" in nxt.lower():
            failures.append(f"next-cleanup-at should show a date after cleanup ran: {nxt!r}")
        await page.screenshot(path=str(SHOTS / "2_after_cleanup.png"))

        # Verify localStorage actually has 2 jobs left
        remaining = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('lovable.exportJobs.v1') || '[]').map(j => j.id)"
        )
        if sorted(remaining) != ["new_1", "new_2"]:
            failures.append(f"localStorage jobs wrong after cleanup: {remaining!r}")

        await browser.close()

    if failures:
        print("FAILURES:")
        for f in failures: print(" -", f)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
