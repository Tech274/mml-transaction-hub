// SCRUM-128 C19: Peter's non-blocking review nits on C15 (presentation only), pinned in the source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) =>
  readFileSync(join(__dirname, "..", "..", "routes", "_authenticated", f), "utf8");

describe("import-approvals presentation (C19)", () => {
  const queue = read("import-approvals.index.tsx");
  const stage = read("import-approvals.$stageId.tsx");

  it("shows the empty row only when the list loaded without an error", () => {
    expect(queue).toContain("{!q.isLoading && !q.isError && stages.length === 0 && (");
    expect(queue).not.toContain("{!q.isLoading && stages.length === 0 && (");
  });

  it("says 'an approver', not Chief: the approver list is configurable", () => {
    expect(queue).toContain("until an approver signs it off");
    expect(queue).not.toContain("until Chief signs it off");
  });

  it("imports Button and buttonVariants in one statement", () => {
    expect(stage.match(/from "@\/components\/ui\/button"/g)).toHaveLength(1);
    expect(stage).toContain('import { Button, buttonVariants } from "@/components/ui/button";');
  });
});
