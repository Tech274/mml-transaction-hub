import { describe, expect, it, vi } from "vitest";
import {
  getSidebarOpenFromStorage,
  persistSidebarCollapsed,
  readSidebarCollapsedFromStorage,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
} from "@/lib/sidebar-prefs";

describe("sidebar preference persistence", () => {
  it("reads collapsed flag from storage", () => {
    const storage = {
      getItem: vi.fn(() => "true"),
    };
    expect(readSidebarCollapsedFromStorage(storage)).toBe(true);
    expect(getSidebarOpenFromStorage(storage)).toBe(false);
    expect(storage.getItem).toHaveBeenCalledWith(SIDEBAR_COLLAPSED_STORAGE_KEY);
  });

  it("defaults to expanded when nothing is stored", () => {
    const storage = {
      getItem: vi.fn(() => null),
    };
    expect(readSidebarCollapsedFromStorage(storage)).toBe(false);
    expect(getSidebarOpenFromStorage(storage)).toBe(true);
  });

  it("writes collapsed state to storage", () => {
    const storage = {
      setItem: vi.fn(),
    };
    persistSidebarCollapsed(storage, true);
    persistSidebarCollapsed(storage, false);
    expect(storage.setItem).toHaveBeenNthCalledWith(1, SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    expect(storage.setItem).toHaveBeenNthCalledWith(2, SIDEBAR_COLLAPSED_STORAGE_KEY, "false");
  });
});
