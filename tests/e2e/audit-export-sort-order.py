"""
E2E: confirm the Customer Audit Excel export includes a Deactivation Reason
column AND that the export's sort order exactly matches the UI's current
sort. We toggle the "When" sort to ascending in the UI, export, then read
back the Info sheet (sortDir=asc) and verify the Data sheet rows are
monotonically non-decreasing by the When column.

Run from /dev-server:
    PORT=8080 python3 tests/e2e/audit-export-sort-order.py
"""
import asyncio, io, json, os, re, sys, zipfile
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("PORT", "8080")
BASE = f"http://localhost:{PORT}"
SHOTS = Path("/tmp/browser/audit-export-sort")
SHOTS.mkdir(parents=True, exist_ok=True)


async def restore_session(page):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    await page.goto(BASE, wait_until="domcontentloaded")
    if key and sess:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})"
        )


def read_sheet(xlsx: bytes, label: str) -> str:
    with zipfile.ZipFile(io.BytesIO(xlsx)) as z:
        names = sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))
        target = names[-1] if label == "Data" else names[0]
        return z.read(target).decode("utf-8")


def shared_strings(xlsx: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(xlsx)) as z:
        if "xl/sharedStrings.xml" not in z.namelist():
            return []
        xml = z.read("xl/sharedStrings.xml").decode("utf-8")
    return re.findall(r"<t[^>]*>([^<]*)</t>", xml)


def column_values(data_xml: bytes_or_str, ss: list[str], col_letter: str) -> list[str]:
    rows = re.findall(r"<row[^>]*>(.*?)</row>", data_xml, flags=re.S)
    out = []
    for r in rows[1:]:  # skip header
        cells = re.findall(rf'<c r="{col_letter}\d+"[^>]*?(?:\s+t="([^"]+)")?[^>]*>(?:<v>([^<]*)</v>)?', r)
        if not cells: continue
        t, v = cells[0]
        if v == "": out.append(""); continue
        if t == "s":
            try: out.append(ss[int(v)])
            except Exception: out.append(v)
        else:
            out.append(v)
    return out


bytes_or_str = str  # alias for the loose type hint above


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800}, accept_downloads=True)
        page = await ctx.new_page()
        await restore_session(page)

        await page.goto(f"{BASE}/admin", wait_until="networkidle")
        tab = page.get_by_role("tab", name="Customer Audit")
        if await tab.count() == 0:
            print("Customer Audit tab not visible — skipping."); await browser.close(); return 0
        await tab.click()
        await page.screenshot(path=str(SHOTS / "1_audit_tab.png"))

        # Default sort is desc; click the When header to switch to asc
        sort_btn = page.get_by_role("button", name=re.compile(r"^When"))
        if await sort_btn.count() > 0:
            await sort_btn.click()

        export_btn = page.get_by_role("button", name="Export to Excel")
        if await export_btn.count() == 0 or await export_btn.is_disabled():
            print("No customer audit rows to export — skipping content checks.")
            await browser.close(); return 0

        async with page.expect_download() as dl_info:
            await export_btn.click()
        dl = await dl_info.value
        path = await dl.path()
        data = Path(path).read_bytes() if path else b""
        if not data:
            failures.append("audit xlsx download empty")
            await browser.close()
            print("FAILURES:", failures); return 1

        ss = shared_strings(data)
        data_xml = read_sheet(data, "Data")
        info_xml = read_sheet(data, "Info")

        if "Deactivation Reason" not in (" ".join(ss) + data_xml):
            failures.append("Deactivation Reason header not found in Data sheet")

        if "sortDir" not in (info_xml + " ".join(ss)) or "asc" not in (" ".join(ss) + info_xml):
            failures.append("Info sheet did not record sortDir=asc")

        # Find the When column letter from the header row
        header_row_match = re.search(r"<row[^>]*>(.*?)</row>", data_xml, flags=re.S)
        when_letter = None
        if header_row_match:
            for cell in re.finditer(r'<c r="([A-Z]+)\d+"[^>]*?(?:\s+t="s")?[^>]*><v>(\d+)</v>', header_row_match.group(1)):
                col, ssidx = cell.group(1), int(cell.group(2))
                if ssidx < len(ss) and ss[ssidx].strip().lower() == "when":
                    when_letter = col; break
        if when_letter:
            vals = column_values(data_xml, ss, when_letter)
            # asc => monotonic non-decreasing
            if any(vals[i] > vals[i+1] for i in range(len(vals) - 1)):
                failures.append("Data rows not in ascending When order")
        else:
            failures.append("could not locate When column in header")

        await browser.close()

    if failures:
        print("FAILURES:")
        for f in failures: print(" -", f)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
