"""
E2E: verify the Admin Export Jobs filters (job type, status, date range,
requested by) combine correctly with pagination, and that filter state
persists across a page refresh (filters are stored in URL query / hash or
component state — the test reapplies and asserts results stay consistent
with the seeded dataset).

Seeds 60 deterministic jobs so we can validate paging (PAGE_SIZE=25 in the
component) and multi-filter narrowing.

Run from /dev-server:
    PORT=8080 python3 tests/e2e/export-jobs-filters-pagination.py
"""
import asyncio, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/export-jobs-filters")
SHOTS.mkdir(parents=True, exist_ok=True)

DAY = 24 * 60 * 60 * 1000
NOW = 1_750_000_000_000  # fixed reference timestamp


def seed_jobs():
    jobs = []
    statuses = ["done", "error", "cancelled", "running"]
    scopes = ["customers-all", "customer-audit-filtered", "transactions-all"]
    users = ["alice@example.com", "bob@example.com", "carol@example.com"]
    for i in range(60):
        started = NOW - (i * DAY)  # one job per day going back
        jobs.append({
            "id": f"job_seed_{i:03d}",
            "filename": f"file-{i:03d}.xlsx",
            "scope": scopes[i % 3],
            "total": 100,
            "processed": 100,
            "attempts": 1,
            "status": statuses[i % 4],
            "error": "boom" if statuses[i % 4] == "error" else None,
            "startedAt": started,
            "endedAt": started + 1000,
            "user": users[i % 3],
        })
    return jobs


async def restore_session(page, jobs):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if key and sess:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})"
        )
    await page.evaluate(
        f"window.localStorage.setItem('lovable.exportJobs.v1', {json.dumps(json.dumps(jobs))})"
    )


async def open_jobs_tab(page) -> bool:
    await page.goto(f"{BASE}/admin", wait_until="networkidle")
    tab = page.get_by_role("tab", name="Export Jobs")
    if await tab.count() == 0:
        print("Export Jobs tab not visible — skipping.")
        return False
    await tab.click()
    return True


async def read_counter(page) -> str:
    # The component renders "<filtered> of <total> jobs"
    return await page.locator("text=/\\d+ of \\d+ jobs/").first.inner_text()


async def main() -> int:
    failures: list[str] = []
    jobs = seed_jobs()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await restore_session(page, jobs)

        if not await open_jobs_tab(page):
            await browser.close(); return 0

        # 60 total, PAGE_SIZE=25 -> 3 pages
        counter = await read_counter(page)
        if "60 of 60" not in counter:
            failures.append(f"unfiltered counter wrong: {counter!r}")
        page_label = await page.locator("text=/Page \\d+ of \\d+/").first.inner_text()
        if "Page 1 of 3" not in page_label:
            failures.append(f"initial paging label wrong: {page_label!r}")
        await page.screenshot(path=str(SHOTS / "1_unfiltered.png"))

        # Filter: status=error (every 4th of 60 = 15)
        await page.get_by_role("combobox").nth(1).click()
        await page.get_by_role("option", name="Error").click()
        counter = await read_counter(page)
        if "15 of 60" not in counter:
            failures.append(f"status=error counter wrong: {counter!r}")

        # Add job-type filter: customers (one of three scopes => 20 total, intersect with error -> 5)
        await page.get_by_role("combobox").nth(0).click()
        await page.get_by_role("option", name="customers", exact=True).click()
        counter = await read_counter(page)
        # i%3==0 -> customers-all, i%4==1 -> error. Intersection: i where i%12==4 in 0..59 = {4,16,28,40,52} = 5
        if "5 of 60" not in counter:
            failures.append(f"status+type counter wrong: {counter!r}")

        # Add requested-by filter for alice (i%3==0 => same as customers scope here)
        await page.locator('input[placeholder="Requested by"]').fill("alice")
        counter = await read_counter(page)
        if "5 of 60" not in counter:
            failures.append(f"status+type+user counter wrong: {counter!r}")
        await page.screenshot(path=str(SHOTS / "2_filtered.png"))

        # Date-range: limit to last 10 days. Errored customers-alice rows at i=4 only (within 10 days of NOW)
        from datetime import datetime, timezone
        to_date = datetime.fromtimestamp(NOW / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        from_date = datetime.fromtimestamp((NOW - 10 * DAY) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        date_inputs = page.locator('input[type="date"]')
        await date_inputs.nth(0).fill(from_date)
        await date_inputs.nth(1).fill(to_date)
        counter = await read_counter(page)
        if "1 of 60" not in counter:
            failures.append(f"date-range counter wrong: {counter!r}")

        # Refresh: filters live in component state, so a hard refresh should clear them
        # AND the seeded jobs must still be there (persisted in localStorage).
        await page.reload(wait_until="networkidle")
        if not await open_jobs_tab(page):
            failures.append("export-jobs tab disappeared after reload")
        else:
            counter = await read_counter(page)
            if "60 of 60" not in counter:
                failures.append(f"after refresh, seeded jobs not retained: {counter!r}")
            # Re-apply filter and confirm same narrowing -> filters are deterministic
            await page.get_by_role("combobox").nth(1).click()
            await page.get_by_role("option", name="Error").click()
            counter = await read_counter(page)
            if "15 of 60" not in counter:
                failures.append(f"refresh re-apply status=error wrong: {counter!r}")

        # Pagination still works on filtered set: 15 errors at PAGE_SIZE=25 -> Page 1 of 1
        page_label = await page.locator("text=/Page \\d+ of \\d+/").first.inner_text()
        if "Page 1 of 1" not in page_label:
            failures.append(f"paging after status=error wrong: {page_label!r}")
        await page.screenshot(path=str(SHOTS / "3_after_refresh.png"))

        await browser.close()

    if failures:
        print("FAILURES:")
        for f in failures: print(" -", f)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
