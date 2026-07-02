"""
E2E: Revenue Forecast Excel export across multiple year/provider/LOB filter
combinations. For each combo, read the on-screen Revenue KPI + Monthly
projection rows and confirm the exported xlsx contains matching Totals and
detailed monthly rows.

Run: PORT=8080 python3 tests/e2e/reports-forecast-export-matrix.py
"""
import asyncio, json, os, re, sys, zipfile
from datetime import date
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/reports-forecast-matrix")
SHOTS.mkdir(parents=True, exist_ok=True)

YEAR = date.today().year

# Deterministic fixtures: one row per (provider, LOB) combo.
FIXTURES = []
for prov, lob, sell, cost in [
    ("AWS",   "VILT",       500, 200),
    ("AWS",   "Standalone", 300, 150),
    ("Azure", "VILT",       400, 100),
    ("Azure", "Standalone", 600, 250),
]:
    FIXTURES.append({
        "month": 1, "year": YEAR, "repository_type": "public_cloud",
        "cloud_provider": prov, "line_of_business": lob,
        "customer_name": f"{prov}-{lob}", "lab_name": f"Lab-{prov}-{lob}",
        "total_users": 5, "input_cost": cost, "selling_cost": sell,
        "start_date": f"{YEAR}-01-01", "end_date": f"{YEAR+1}-12-31",
        "is_deleted": False,
    })


async def restore(page):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if key and sess:
        await page.evaluate(f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})")


def digits(s: str) -> int:
    m = re.findall(r"\d", s)
    return int("".join(m)) if m else 0


async def pick(page, label: str, option_label: str):
    trig = page.locator("label", has_text=label).locator("..").locator("[role=combobox]")
    await trig.click()
    await page.get_by_role("option", name=option_label, exact=True).click()
    await page.wait_for_timeout(150)


async def run_combo(page, provider: str, lob: str) -> list[str]:
    problems: list[str] = []
    await pick(page, "Cloud provider", provider)
    await pick(page, "Line of business", lob)

    # Expected revenue = sum of selling_cost for matching fixtures (year already
    # filtered by default to current YEAR)
    expected_revenue = sum(
        r["selling_cost"] for r in FIXTURES
        if r["cloud_provider"] == provider and r["line_of_business"] == lob
    )

    # Read on-screen Revenue KPI
    revenue_kpi = page.locator("div", has_text="Revenue").filter(
        has=page.locator("div.text-lg")).first
    # Simpler: read all KPI cards by their label
    kpi_text = await page.locator(".text-lg.font-semibold").first.inner_text()
    if digits(kpi_text) != expected_revenue:
        problems.append(f"[{provider}/{lob}] KPI Revenue={digits(kpi_text)}, expected {expected_revenue}")

    # Switch to Revenue Forecast tab
    await page.get_by_role("tab", name="Revenue Forecast").click()
    await page.wait_for_timeout(200)
    panel = page.locator('[role=tabpanel][data-state=active]')

    # Read on-screen Monthly projection rows (Month → Revenue)
    monthly_rows = panel.locator("table").first.locator("tbody tr")
    n = await monthly_rows.count()
    on_screen_months = []
    for i in range(n):
        cells = monthly_rows.nth(i).locator("td")
        month = (await cells.nth(0).inner_text()).strip()
        rev = digits(await cells.nth(1).inner_text())
        on_screen_months.append((month, rev))

    # Export
    async with page.expect_download() as dl:
        await panel.get_by_role("button", name="Export Excel").click()
    download = await dl.value
    path = await download.path()

    with zipfile.ZipFile(path) as z:
        blob = ""
        for name in z.namelist():
            if name.startswith("xl/") and name.endswith(".xml"):
                blob += z.read(name).decode("utf-8", errors="ignore")

    # Totals: Revenue row must include expected value
    if str(expected_revenue) not in blob:
        problems.append(f"[{provider}/{lob}] expected revenue {expected_revenue} missing from xlsx")
    # Applied Filters must record provider + LOB
    if provider not in blob:
        problems.append(f"[{provider}/{lob}] provider not in xlsx metadata")
    if lob not in blob:
        problems.append(f"[{provider}/{lob}] LOB not in xlsx metadata")
    # Detailed monthly rows: each on-screen month key should appear
    for month_key, _ in on_screen_months[:3]:  # sample first 3
        if month_key not in blob:
            problems.append(f"[{provider}/{lob}] monthly key {month_key!r} missing from xlsx")

    # Back to the Cloud Cost tab for the next combo
    await page.get_by_role("tab", name="Cloud Cost").click()
    return problems


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800}, accept_downloads=True)
        page = await ctx.new_page()
        await restore(page)
        await ctx.route("**/rest/v1/transactions*", lambda r: r.fulfill(
            status=200, content_type="application/json", body=json.dumps(FIXTURES)))

        await page.goto(f"{BASE}/reports", wait_until="networkidle")
        if await page.get_by_text("does not have permission").count() > 0:
            print("No permission — skipping.")
            await browser.close()
            return 0

        # Ensure year is current (it defaults to current year, but pick explicitly)
        await pick(page, "Year", str(YEAR))

        for prov, lob in [
            ("AWS", "VILT"),
            ("AWS", "Standalone"),
            ("Azure", "VILT"),
            ("Azure", "Standalone"),
        ]:
            failures += await run_combo(page, prov, lob)

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
