"""E2E: preset rename / share / delete propagate visibility across roles.

Uses three browser contexts driven by distinct sessions:
  * OWNER — creator of the preset (LOVABLE_BROWSER_SUPABASE_* env vars)
  * SHARED_VIEWER — a second signed-in user (LOVABLE_BROWSER_SUPABASE_*_VIEWER)
  * NON_SHARED — an unrelated signed-in user (LOVABLE_BROWSER_SUPABASE_*_OTHER)

Assertions (each after the owner's action, with a hard reload on the
viewer + non-shared contexts):
  1. Owner creates preset P (private) → owner sees it, viewer + other do NOT.
  2. Owner toggles is_shared=true → viewer sees it, other does NOT.
  3. Owner renames P → viewer sees the new name immediately after reload.
  4. Owner toggles is_shared=false → viewer no longer sees it.
  5. Owner deletes P → nobody sees it.

Selectors:
  * preset row: [data-testid="preset-row-<name>"]
  * preset selector option: [data-testid="preset-option-<name>"]
  * rename input: [data-testid="preset-rename-input"]
  * share toggle: [data-testid="preset-share-toggle"]
  * delete button: [data-testid="preset-delete-btn"]
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent / "screenshots" / "bulk-import-presets-roles"
ROOT.mkdir(parents=True, exist_ok=True)

PRESET_NAME = "shared-visibility-preset"
RENAMED = "shared-visibility-preset-renamed"


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


async def open_manager(page):
    await page.goto("http://localhost:8080/bulk-import", wait_until="domcontentloaded")
    await page.get_by_role("button", name="Manage presets").click()
    await page.wait_for_selector('[data-testid^="preset-row-"], text=No presets', timeout=5000)


async def visible_names(page):
    return await page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid^="preset-row-"]'))
                  .map(el => el.getAttribute('data-testid').replace('preset-row-', ''))"""
    )


async def check(page, label: str, expected: bool, name: str):
    await open_manager(page)
    names = await visible_names(page)
    got = name in names
    print(f"  {label}: expects={expected} got={got} names={names}")
    assert got == expected, f"{label} visibility mismatch (name={name})"


async def owner_create(owner):
    await open_manager(owner)
    await owner.locator('[data-testid="preset-new-name"]').fill(PRESET_NAME)
    await owner.locator('[data-testid="preset-new-save"]').click()
    await owner.wait_for_selector(f'[data-testid="preset-row-{PRESET_NAME}"]')


async def owner_toggle_share(owner, shared: bool, name: str):
    row = owner.locator(f'[data-testid="preset-row-{name}"]')
    toggle = row.locator('[data-testid="preset-share-toggle"]')
    state = await toggle.get_attribute("aria-checked")
    if (state == "true") != shared:
        await toggle.click()
    await owner.wait_for_timeout(250)


async def owner_rename(owner, old: str, new: str):
    row = owner.locator(f'[data-testid="preset-row-{old}"]')
    await row.locator('[data-testid="preset-rename-input"]').fill(new)
    await row.locator('[data-testid="preset-rename-save"]').click()
    await owner.wait_for_selector(f'[data-testid="preset-row-{new}"]')


async def owner_delete(owner, name: str):
    owner.on("dialog", lambda d: asyncio.create_task(d.accept()))
    row = owner.locator(f'[data-testid="preset-row-{name}"]')
    await row.locator('[data-testid="preset-delete-btn"]').click()
    await owner.wait_for_selector(f'[data-testid="preset-row-{name}"]', state="detached", timeout=5000)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        owner_ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        viewer_ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        other_ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        owner = await owner_ctx.new_page()
        viewer = await viewer_ctx.new_page()
        other = await other_ctx.new_page()

        await restore(owner_ctx, owner)
        await restore(viewer_ctx, viewer, prefix="_VIEWER")
        await restore(other_ctx, other, prefix="_OTHER")

        # 1. Private preset — owner only
        await owner_create(owner)
        await check(owner, "owner sees private", True, PRESET_NAME)
        await check(viewer, "viewer hidden (private)", False, PRESET_NAME)
        await check(other, "other hidden (private)", False, PRESET_NAME)

        # 2. Share
        await owner_toggle_share(owner, True, PRESET_NAME)
        await check(viewer, "viewer sees after share", True, PRESET_NAME)
        await check(other, "other still hidden (not target)", False, PRESET_NAME)

        # 3. Rename
        await owner_rename(owner, PRESET_NAME, RENAMED)
        await check(viewer, "viewer sees renamed", True, RENAMED)
        await check(other, "other still hidden after rename", False, RENAMED)

        # 4. Unshare
        await owner_toggle_share(owner, False, RENAMED)
        await check(viewer, "viewer hidden after unshare", False, RENAMED)

        # 5. Delete
        await owner_delete(owner, RENAMED)
        await check(owner, "owner sees deleted gone", False, RENAMED)
        await check(viewer, "viewer sees deleted gone", False, RENAMED)
        await check(other, "other sees deleted gone", False, RENAMED)

        print("OK — preset visibility across roles is correct")
        await browser.close()


asyncio.run(main())
