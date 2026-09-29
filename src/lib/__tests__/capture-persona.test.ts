import { describe, expect, it } from "vitest";
import { getCaptureRole, getCaptureRoleFromSearch } from "@/lib/capture-persona";

describe("capture persona role resolution", () => {
  it("reads a valid role from URL search", () => {
    expect(getCaptureRoleFromSearch("?captureRole=finance")).toBe("finance");
  });

  it("ignores invalid search values", () => {
    expect(getCaptureRoleFromSearch("?captureRole=unknown")).toBeNull();
  });

  it("prefers search role over env role", () => {
    expect(
      getCaptureRole(
        { VITE_SUPERADMIN_CAPTURE_ROLE: "viewer" },
        "?captureRole=ops_user",
      ),
    ).toBe("ops_user");
  });

  it("falls back to env role and then admin default", () => {
    expect(
      getCaptureRole(
        { VITE_SUPERADMIN_CAPTURE_ROLE: "leadership" },
        "",
      ),
    ).toBe("leadership");
    expect(getCaptureRole({}, "")).toBe("admin");
  });
});
