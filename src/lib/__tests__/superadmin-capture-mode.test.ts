import { describe, expect, it } from "vitest";
import { isSuperadminCaptureModeEnabled } from "@/lib/superadmin-capture-mode";

describe("Super Admin capture mode feature flag", () => {
  it("stays off for missing and non-true values", () => {
    expect(isSuperadminCaptureModeEnabled({})).toBe(false);
    expect(isSuperadminCaptureModeEnabled({ VITE_SUPERADMIN_CAPTURE_MODE: "1" })).toBe(false);
    expect(isSuperadminCaptureModeEnabled({ VITE_SUPERADMIN_CAPTURE_MODE: "TRUE" })).toBe(false);
  });

  it("is ignored outside development builds", () => {
    expect(isSuperadminCaptureModeEnabled({ VITE_SUPERADMIN_CAPTURE_MODE: "true" }, false)).toBe(false);
  });

  it("turns on only for the exact true string", () => {
    expect(isSuperadminCaptureModeEnabled({ VITE_SUPERADMIN_CAPTURE_MODE: "true" })).toBe(true);
  });
});
