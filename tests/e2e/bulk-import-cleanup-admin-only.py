"""E2E: cleanup endpoint is admin-gated.

Assertions:
  1. When signed in as a non-admin (viewer), the "Run cleanup" button
     (data-testid="admin-cleanup-trigger") is NOT rendered in the
     bulk-import history header.
  2. Directly invoking the `runArtifactCleanup` server function as a
     non-admin returns a 403 / "Forbidden" error and does NOT return a
     success payload.

Requires a non-admin session via LOVABLE_BROWSER_SUPABASE_* env vars.
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-cleanup-gated"
ROOT.mkdir(parents=True, exist_ok=True)


async def restore_session(context, page):
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = "http://localhost:8080"
        await context.add_cookies(cookies)
    await page.goto("http://localhost:8080")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )


async def call_cleanup_direct(page):
    """Invoke the server function via the browser fetch used by TanStack RPC,
    so we exercise the same auth path the UI would use."""
    return await page.evaluate(
        """async () => {
          try {
            const mod = await import('/src/lib/bulk-import.functions.ts');
            const res = await mod.runArtifactCleanup({ data: { days: 90 } });
            return { ok: true, res };
          } catch (e) {
            const msg = (e && e.message) || String(e);
            const status = (e && (e.status || e.response?.status)) ?? null;
            return { ok: false, status, message: msg };
          }
        }"""
    )


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        await restore_session(context, page)
        await page.goto("http://localhost:8080/bulk-import", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(ROOT / "1_history.png"))

        btn = page.locator('[data-testid="admin-cleanup-trigger"]')
        count = await btn.count()
        assert count == 0, f"non-admin should not see cleanup button (found {count})"

        result = await call_cleanup_direct(page)
        print("direct call result:", json.dumps(result, indent=2))

        assert not result.get("ok"), "cleanup must reject non-admin callers"
        msg = (result.get("message") or "").lower()
        status = result.get("status")
        assert status in (401, 403) or "forbidden" in msg or "admin" in msg, (
            f"expected 401/403/forbidden, got status={status} message={msg!r}"
        )

        print("OK — non-admin blocked from cleanup UI + endpoint")
        await browser.close()


asyncio.run(main())
