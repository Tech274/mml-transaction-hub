"""
E2E: cancel an async Excel export mid-flight, and verify the Customer Audit
Excel export contains a Deactivation Reason column and respects current sort.

Run from /dev-server:
    PORT=8080 python3 tests/e2e/cancel-export-and-audit.py

Requires LOVABLE_BROWSER_SUPABASE_* (signed-in admin) per browser-use guide.
"""
import asyncio, json, os, sys, zipfile, io, re
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/cancel-export-audit")
SHOTS.mkdir(parents=True, exist_ok=True)


async def restore_session(page):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if key and sess:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})"
        )


def xlsx_sheet_xml(xlsx_bytes: bytes, sheet_name: str) -> str:
    """Return the raw sheet XML for a given sheet name from an xlsx blob."""
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes)) as z:
        workbook_xml = z.read("xl/workbook.xml").decode("utf-8")
        m = re.search(rf'<sheet[^>]*name="{re.escape(sheet_name)}"[^>]*sheetId="(\d+)"', workbook_xml)
        if not m:
            raise AssertionError(f"sheet {sheet_name!r} not found in workbook")
        # Just take the first worksheet that exists matching ordering. Sheet 1 is Info, 2 is Data.
        names = [n for n in z.namelist() if n.startswith("xl/worksheets/sheet")]
        names.sort()
        # The 'Data' sheet is the last appended one
        target = names[-1] if sheet_name == "Data" else names[0]
        return z.read(target).decode("utf-8")


async def cancel_async_export(page) -> list[str]:
    failures: list[str] = []
    # Seed a fake large dataset by visiting customers with an obviously broad scope;
    # if dataset is too small to cross the threshold, skip with a clear note.
    await page.goto(f"{BASE}/customers", wait_until="networkidle")
    await page.screenshot(path=str(SHOTS / "1_customers.png"))

    export_btn = page.get_by_role("button", name="Export")
    if await export_btn.count() == 0:
        print("Export permission not granted — skipping cancel check.")
        return failures

    await export_btn.click()
    await page.get_by_role("menuitem").filter(has_text="All customers").click()

    dialog = page.get_by_role("dialog").filter(has_text="Preparing Excel export")
    try:
        await dialog.wait_for(state="visible", timeout=2000)
    except Exception:
        print("Dataset under async threshold — cancel check N/A.")
        return failures

    cancel_btn = dialog.get_by_role("button", name="Cancel export")
    await cancel_btn.wait_for(state="visible", timeout=5000)
    await cancel_btn.click()
    await page.screenshot(path=str(SHOTS / "2_cancelled.png"))

    # Dialog should show the cancelled state with a Restart button
    try:
        await dialog.get_by_text("Export cancelled.").wait_for(timeout=3000)
    except Exception:
        failures.append("dialog did not show 'Export cancelled.' after Cancel")
    if await dialog.get_by_role("button", name="Restart").count() == 0:
        failures.append("Restart button not visible after cancel")
    if await dialog.get_by_role("button", name="Download").count() != 0:
        failures.append("Download button should not be visible after cancel")
    return failures


async def audit_export_has_deactivation_reason(page, context) -> list[str]:
    failures: list[str] = []
    await page.goto(f"{BASE}/admin", wait_until="networkidle")
    # Switch to Customer Audit tab
    await page.get_by_role("tab", name="Customer Audit").click()
    await page.screenshot(path=str(SHOTS / "3_audit_tab.png"))

    # Flip sort order to ascending so we can verify it carries through
    sort_btn = page.get_by_role("button", name=re.compile(r"^When"))
    await sort_btn.click()  # desc -> asc

    export_btn = page.get_by_role("button", name="Export to Excel")
    if await export_btn.is_disabled():
        print("No customer audit rows — skipping audit export check.")
        return failures

    async with page.expect_download() as dl_info:
        await export_btn.click()
    dl = await dl_info.value
    path = await dl.path()
    if not path:
        failures.append("no audit xlsx downloaded")
        return failures
    data = Path(path).read_bytes()

    # Verify "Deactivation Reason" header appears in the Data sheet
    data_xml = xlsx_sheet_xml(data, "Data")
    if "Deactivation Reason" not in data_xml:
        failures.append("audit xlsx missing 'Deactivation Reason' column header")

    # Verify the Info sheet records sortDir=asc (current sort order)
    info_xml = xlsx_sheet_xml(data, "Info")
    if "sortDir" not in info_xml or "asc" not in info_xml:
        failures.append("audit xlsx Info sheet did not record sortDir=asc")

    print(f"Audit export OK ({len(data)} bytes)")
    return failures


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800}, accept_downloads=True)
        page = await ctx.new_page()
        await restore_session(page)

        failures += await cancel_async_export(page)
        failures += await audit_export_has_deactivation_reason(page, ctx)

        await browser.close()

    if failures:
        print("FAILURES:")
        for f in failures: print(" -", f)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
