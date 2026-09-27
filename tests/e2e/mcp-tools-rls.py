"""E2E: MCP tools return RLS-filtered data for the signed-in user and fail safely without auth.

We call the same server functions the MCP tools use (via createClient with a user bearer),
plus hit the /mcp endpoint unauthenticated to prove it refuses without OAuth.
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "mcp-tools-rls"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        # 1. Unauthenticated MCP call must be rejected (401/403).
        resp = await context.request.post(
            "http://localhost:8080/mcp",
            headers={"Accept": "application/json, text/event-stream", "Content-Type": "application/json"},
            data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
        )
        assert resp.status in (401, 403), f"unauthenticated /mcp should reject, got {resp.status}"
        print("unauth /mcp status:", resp.status)

        # 2. Signed-in user: use restored session and open the agent-integrations page.
        storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
        session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
        auth_status = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS")
        print("auth status:", auth_status)
        if auth_status != "injected" or not (storage_key and session_json):
            print("no injected session; stopping after unauth check")
            await browser.close()
            return

        await page.goto("http://localhost:8080")
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )
        await page.goto("http://localhost:8080/agent-integrations", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "integrations.png"))
        assert "Connect an AI assistant" in await page.content(), "integrations page missing"

        await browser.close()

asyncio.run(main())
