"""E2E: signed URLs for original CSV / error artifact are gated by ownership.

Setup requires two sessions injected via env vars:
  * Default LOVABLE_BROWSER_SUPABASE_* — the OWNER of an existing run
    that has both original_csv_path and error_artifact_path set.
  * LOVABLE_BROWSER_SUPABASE_*_OTHER — a non-owner, non-shared user with
    an authenticated session (any role) who must NOT be able to read
    those artifacts.

Assertions:
  1. As OWNER: createSignedUrl for both paths succeeds AND the returned
     URL fetches HTTP 200.
  2. As NON-OWNER: createSignedUrl EITHER returns an error, OR the
     signed URL fetches a non-2xx (403/400) response. Both are treated
     as "permission denied" — the artifact must not be downloadable.

If no run with artifacts exists yet, the test uploads a bad CSV as OWNER
to guarantee an error_artifact_path is written before checking ACLs.
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-artifact-acl"
ROOT.mkdir(parents=True, exist_ok=True)

CSV_BAD = (
    "potential_id,month,year,customer_name,lab_name,line_of_business,"
    "start_date,end_date,total_users,input_cost,selling_cost,cloud_provider\n"
    "POT-ACL-001,13,2026,Acme Corp,AWS Lab,Training,"
    "2026-01-01,2026-01-31,10,1000.00,1500.00,aws \n"
)


async def restore(context, page, prefix: str = ""):
    sk = os.environ.get(f"LOVABLE_BROWSER_SUPABASE_STORAGE_KEY{prefix}")
    sj = os.environ.get(f"LOVABLE_BROWSER_SUPABASE_SESSION_JSON{prefix}")
    cj = os.environ.get(f"LOVABLE_BROWSER_SUPABASE_COOKIES_JSON{prefix}")
    if cj:
        cookies = json.loads(cj)
        for c in cookies:
            c["url"] = "http://localhost:8080"
        await context.add_cookies(cookies)
    await page.goto("http://localhost:8080")
    if sk and sj:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(sk)}, {json.dumps(sj)})"
        )


async def ensure_artifact_run(page):
    """As OWNER, upload a bad CSV so we have at least one run with an
    error_artifact_path. Returns { runId, originalCsvPath, errorArtifactPath }."""
    await page.goto("http://localhost:8080/entry", wait_until="domcontentloaded")
    # Try to reuse an existing run first
    existing = await page.evaluate(
        """async () => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data, error } = await supabase
            .from('bulk_import_runs')
            .select('id,original_csv_path,error_artifact_path')
            .not('error_artifact_path', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1);
          return { error: error?.message ?? null, row: (data ?? [])[0] ?? null };
        }"""
    )
    if existing.get("row"):
        return existing["row"]

    # Otherwise, upload a bad CSV to create one
    await page.get_by_role("tab", name="Bulk Import").click()
    csv_path = ROOT / "acl-bad.csv"
    csv_path.write_text(CSV_BAD)
    await page.set_input_files('input[type="file"]', str(csv_path))
    await page.get_by_role("button", name="Import").click()
    await page.wait_for_timeout(3000)
    made = await page.evaluate(
        """async () => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data } = await supabase
            .from('bulk_import_runs')
            .select('id,original_csv_path,error_artifact_path')
            .not('error_artifact_path', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1);
          return (data ?? [])[0] ?? null;
        }"""
    )
    assert made, "failed to create a run with error_artifact_path"
    return made


async def try_signed_url(page, path):
    return await page.evaluate(
        """async (p) => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data, error } = await supabase.storage
            .from('bulk-imports')
            .createSignedUrl(p, 60);
          if (error || !data?.signedUrl) {
            return { ok: false, signedError: error?.message ?? 'no signed url' };
          }
          let status = 0, body = '';
          try {
            const r = await fetch(data.signedUrl);
            status = r.status;
            body = (await r.text()).slice(0, 200);
          } catch (e) { status = -1; body = String(e); }
          return { ok: status >= 200 && status < 300, status, body, url: data.signedUrl };
        }""",
        path,
    )


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)

        owner_ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        owner = await owner_ctx.new_page()
        await restore(owner_ctx, owner)
        run = await ensure_artifact_run(owner)
        print("run under test:", run)

        # Owner should be able to download
        for label, path in [("original_csv_path", run.get("original_csv_path")),
                            ("error_artifact_path", run.get("error_artifact_path"))]:
            if not path:
                continue
            res = await try_signed_url(owner, path)
            print(f"OWNER {label}: {res}")
            assert res["ok"], f"owner must be able to download {label}: {res}"

        # Non-owner must be blocked
        other_ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        other = await other_ctx.new_page()
        await restore(other_ctx, other, prefix="_OTHER")
        await other.goto("http://localhost:8080", wait_until="domcontentloaded")

        for label, path in [("original_csv_path", run.get("original_csv_path")),
                            ("error_artifact_path", run.get("error_artifact_path"))]:
            if not path:
                continue
            res = await try_signed_url(other, path)
            print(f"OTHER {label}: {res}")
            blocked = (not res.get("ok")) or res.get("status") in (400, 401, 403, 404)
            assert blocked, f"non-owner should be denied for {label}: {res}"

        print("OK — signed-URL ACL respects ownership")
        await browser.close()


asyncio.run(main())
