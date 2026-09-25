"""E2E: /api/public/bulk-template-version endpoint + UI mismatch banner.

Verifies:
  1. The public API endpoint returns the current TEMPLATE_VERSION.
  2. Uploading a CSV whose `# template_version:` marker is out of date
     produces a visible UI warning that names both the detected and
     current allowed versions.
"""
import asyncio, json, os, re, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-template-version-endpoint"
ROOT.mkdir(parents=True, exist_ok=True)
BASE = "http://localhost:8080"


async def restore(context, page):
    sk = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sj = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cj = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cj:
        cookies = json.loads(cj)
        for c in cookies: c["url"] = BASE
        await context.add_cookies(cookies)
    await page.goto(BASE)
    if sk and sj:
        await page.evaluate(f"window.localStorage.setItem({json.dumps(sk)}, {json.dumps(sj)})")


async def main():
    # 1) Public endpoint should expose the current template version.
    with urllib.request.urlopen(f"{BASE}/api/public/bulk-template-version") as r:
        payload = json.loads(r.read().decode())
    assert "template_version" in payload, payload
    current = payload["template_version"]
    assert re.match(r"^\d+\.\d+\.\d+$", current), current
    assert set(payload["line_of_business_allowed"]) == {"VILT", "Standalone", "Integrated"}
    print("endpoint template_version:", current)

    # 2) UI should warn when uploaded CSV template_version does not match.
    stale = "0.0.1-stale"
    assert stale != current
    csv = (
        f"# template_version: {stale}\n"
        "potential_id,month,year,customer_name,lab_name,line_of_business,"
        "start_date,end_date,total_users,input_cost,selling_cost,cloud_provider\n"
        "POT-STALE-1,1,2026,Acme,Lab,VILT,2026-01-01,2026-01-31,1,10,20,AWS\n"
    )
    csv_path = ROOT / "stale-template.csv"
    csv_path.write_text(csv)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await restore(ctx, page)
        await page.goto(f"{BASE}/entry", wait_until="domcontentloaded")
        await page.get_by_role("tab", name="Bulk Import").click()
        await page.set_input_files('input[type="file"]', str(csv_path))

        banner = page.get_by_test_id("template-version-mismatch-banner")
        await banner.wait_for(state="visible", timeout=5000)
        text = (await banner.inner_text()).lower()
        assert stale.lower() in text, text
        assert current.lower() in text, text
        detected = await page.get_by_test_id("tvm-detected").inner_text()
        current_ui = await page.get_by_test_id("tvm-current").inner_text()
        assert detected.strip() == stale
        assert current_ui.strip() == current
        await page.screenshot(path=str(ROOT / "1_mismatch_banner.png"))
        await browser.close()

    print("OK: version endpoint + UI mismatch banner verified")


asyncio.run(main())
