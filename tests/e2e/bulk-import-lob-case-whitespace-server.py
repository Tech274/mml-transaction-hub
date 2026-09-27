"""E2E (server layer): DB CHECK rejects case/whitespace LOB variants."""
import asyncio, json, os, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-lob-server"
ROOT.mkdir(parents=True, exist_ok=True)

INVALID = [
    "vilt", "VILT ", " VILT", "Vilt",
    "standalone", "Standalone ", " Standalone", "STANDALONE",
    "integrated", "Integrated ", " Integrated", "INTEGRATED",
    "Training", "", "vilt/standalone",
]
VALID = ["VILT", "Standalone", "Integrated"]


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


async def try_insert(page, lob, tag):
    return await page.evaluate(
        """async ({ lob, tag }) => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data, error } = await supabase.from('transactions').insert({
            potential_id: 'POT-LOB-CW-' + tag,
            customer_name: 'Acme Corp', lab_name: 'AWS Lab',
            lab_type: 'public_cloud', cloud_provider: 'AWS',
            line_of_business: lob,
            start_date: '2026-01-01', end_date: '2026-01-31',
            total_users: 1, selling_cost: 100, month: 1, year: 2026,
          }).select('id').maybeSingle();
          return { id: data?.id ?? null, error: error?.message ?? null, code: error?.code ?? null };
        }""",
        {"lob": lob, "tag": tag},
    )


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await restore(ctx, page)
        await page.goto("http://localhost:8080/entry", wait_until="domcontentloaded")

        failures = []
        for i, v in enumerate(INVALID):
            res = await try_insert(page, v, f"inv{i}-{int(time.time()*1000)}")
            print(f"invalid {v!r}: {res}")
            if res["id"] is not None:
                failures.append(("INVALID accepted", v, res))
            else:
                msg = (res.get("error") or "").lower()
                if not any(t in msg for t in ("check", "constraint", "line_of_business")):
                    failures.append(("wrong error", v, res))

        created = []
        for i, v in enumerate(VALID):
            res = await try_insert(page, v, f"ok{i}-{int(time.time()*1000)}")
            print(f"valid {v!r}: {res}")
            if res["id"] is None: failures.append(("VALID rejected", v, res))
            else: created.append(res["id"])

        if created:
            await page.evaluate(
                """async (ids) => { const { supabase } = await import('/src/integrations/supabase/client.ts');
                   await supabase.from('transactions').delete().in('id', ids); }""",
                created,
            )

        if failures:
            for f in failures: print("FAIL:", f)
            raise SystemExit(1)
        print("OK — DB CHECK rejects case/whitespace variants; exact matches pass")
        await browser.close()


asyncio.run(main())
