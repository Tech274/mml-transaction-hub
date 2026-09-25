"""E2E: downloadable template + server validator + DB constraint stay in sync."""
import asyncio, json, os, re
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-template-sync"
ROOT.mkdir(parents=True, exist_ok=True)
ALLOWED = {"VILT", "Standalone", "Integrated"}


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


async def download_template(page, name_re):
    async with page.expect_download() as dl:
        await page.get_by_role("button", name=re.compile(name_re, re.I)).click()
    d = await dl.value
    dest = ROOT / (await d.suggested_filename())
    await d.save_as(str(dest))
    return dest.read_text()


def parse_template(csv_text):
    version, body = None, []
    for l in csv_text.splitlines():
        s = l.strip()
        if not s: continue
        if s.startswith("#"):
            m = re.match(r"^#\s*template_version:\s*(.+)$", s)
            if m: version = m.group(1).strip()
            continue
        body.append(l)
    header = [h.strip() for h in body[0].split(",")]
    rows = [[c.strip() for c in r.split(",")] for r in body[1:]]
    return version, header, rows


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800}, accept_downloads=True)
        page = await ctx.new_page()
        await restore(ctx, page)
        await page.goto("http://localhost:8080/entry", wait_until="domcontentloaded")
        await page.get_by_role("tab", name="Bulk Import").click()

        pub = await download_template(page, r"Download Public Cloud Template")
        pub_v, pub_h, pub_rows = parse_template(pub)
        assert pub_v, "public template missing # template_version marker"
        lob_i = pub_h.index("line_of_business")
        for i, row in enumerate(pub_rows, start=2):
            assert row[lob_i] in ALLOWED, f"public row {i} bad LOB {row[lob_i]!r}"

        await page.get_by_role("button", name=re.compile(r"Private", re.I)).first.click()
        priv = await download_template(page, r"Download Private Cloud Template")
        priv_v, priv_h, _ = parse_template(priv)
        assert priv_v == pub_v, f"template version drift {pub_v} vs {priv_v}"

        schema = await page.evaluate(
            """async () => { const m = await import('/src/lib/bulk-import.functions.ts');
               return await m.getTemplateSchema(); }"""
        )
        print("server schema:", json.dumps(schema, indent=2))
        assert schema["version"] == pub_v
        assert set(schema["line_of_business"]["allowed"]) == ALLOWED
        assert list(schema["headers"]["public_cloud"]) == pub_h
        assert list(schema["headers"]["private_cloud"]) == priv_h

        good = await page.evaluate(
            """async (v) => { const m = await import('/src/lib/bulk-import.functions.ts');
               return await m.validateBulkImportRows({ data: { kind: 'public_cloud', rows: [], client_template_version: v } }); }""",
            pub_v,
        )
        assert good["version_matches"] is True, good
        stale = await page.evaluate(
            """async () => { const m = await import('/src/lib/bulk-import.functions.ts');
               return await m.validateBulkImportRows({ data: { kind: 'public_cloud', rows: [], client_template_version: '0.0.0-stale' } }); }"""
        )
        assert stale["version_matches"] is False
        assert stale["template_version"] == pub_v

        print(f"OK — template + server + validator all pinned to {pub_v}")
        await browser.close()


asyncio.run(main())
