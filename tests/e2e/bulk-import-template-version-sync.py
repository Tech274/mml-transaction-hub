"""E2E: the Bulk import template and the strict import server stay on one template version.

SCRUM-128 (C2, plan Q4): the legacy importer and its "Download Public/Private Cloud Template"
buttons were deleted with the SCRUM-44 flag. This script now drives the strict importer
(components/strict-import.tsx), which has one template for both cloud types:

  1. The "Template" button on Master ADR entry > Bulk import downloads
     strict-import-template-<version>.csv.
  2. The file is header-only and its headers equal STRICT_COLUMNS
     (src/lib/strict-import/template.ts), in order.
  3. The version in the file name equals STRICT_TEMPLATE_VERSION, and the server preview of a
     one-row file built from that template reports the same version (preview only: nothing is
     imported).

Requires an authenticated ops/admin session via LOVABLE_BROWSER_SUPABASE_* and a local dev
server on :8080. Synthetic data only.
"""
import asyncio, json, os, re
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-template-sync"
ROOT.mkdir(parents=True, exist_ok=True)
FILENAME_RE = re.compile(r"^strict-import-template-(.+)\.csv$")


async def restore(context, page):
    sk = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sj = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cj = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cj:
        cookies = json.loads(cj)
        for c in cookies: c["url"] = "http://localhost:8080"
        await context.add_cookies(cookies)
    await page.goto("http://localhost:8080")
    if sk and sj:
        await page.evaluate(f"window.localStorage.setItem({json.dumps(sk)}, {json.dumps(sj)})")


async def download_strict_template(page):
    async with page.expect_download() as dl:
        await page.get_by_role("button", name=re.compile(r"^\s*Template\s*$", re.I)).click()
    d = await dl.value
    name = d.suggested_filename
    dest = ROOT / name
    await d.save_as(str(dest))
    return name, dest.read_text()


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800}, accept_downloads=True)
        page = await ctx.new_page()
        await restore(ctx, page)
        await page.goto("http://localhost:8080/entry", wait_until="domcontentloaded")
        await page.get_by_role("tab", name=re.compile(r"Bulk import", re.I)).click()

        name, text = await download_strict_template(page)
        m = FILENAME_RE.match(name)
        assert m, f"unexpected template file name {name!r}"
        file_version = m.group(1)

        lines = [l for l in text.splitlines() if l.strip()]
        assert len(lines) == 1, f"template must be header-only, got {len(lines)} lines"
        header = [h.strip() for h in lines[0].split(",")]

        module = await page.evaluate(
            """async () => { const m = await import('/src/lib/strict-import/template.ts');
               return { version: m.STRICT_TEMPLATE_VERSION, headers: m.STRICT_COLUMNS.map((c) => c.header) }; }"""
        )
        print("strict template module:", json.dumps(module, indent=2))
        assert header == module["headers"], f"template headers drifted: {header} vs {module['headers']}"
        assert file_version == module["version"], f"file name version {file_version} vs {module['version']}"

        # Server side: preview a one-row file built from the downloaded header. Preview only.
        values = {h: "" for h in header}
        values.update({
            "Potential ID": "POT-E2E-0001", "Month": "1", "Year": "2026",
            "Customer Name": "Example Customer", "Lab Name": "Example Lab",
            "Line of Business": "VILT", "Start Date": "2026-01-01", "End Date": "2026-01-31",
            "Total Users": "10", "Input Cost": "1000", "Selling Cost": "1500", "Cloud Provider": "AWS",
        })
        one_row = ROOT / "one-row.csv"
        one_row.write_text(",".join(header) + "\n" + ",".join(values[h] for h in header) + "\n")
        await page.set_input_files('input[type="file"]', str(one_row))
        # The version badge appears only in the server preview header ("Preview <version>").
        badge = page.get_by_text(module["version"], exact=True)
        await badge.first.wait_for(timeout=15000)
        assert await badge.count() >= 1, "server preview does not report the template version"
        await page.screenshot(path=str(ROOT / "preview.png"))

        print(f"OK — template file, template module and server preview all pinned to {file_version}")
        await browser.close()


asyncio.run(main())
