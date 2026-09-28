import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADR_EXTRA_FIELD_NAMES } from "@/lib/adr-entry";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("ADR form field parity", () => {
  const extra = read("src/components/adr-extra-fields.tsx");
  const createForm = read("src/components/master-adr-form.tsx");
  const editForm = read("src/components/transaction-edit-form.tsx");

  it("renders the same extra-field block on create and edit", () => {
    expect(createForm).toContain("<AdrExtraFields");
    expect(createForm).toContain('mode="create"');
    expect(editForm).toContain("<AdrExtraFields");
    expect(editForm).toContain('mode="edit"');
  });

  it("covers every extra field name from the shared schema", () => {
    for (const name of ADR_EXTRA_FIELD_NAMES) {
      expect(extra, name).toContain(`field-${name}`);
      expect(extra, name).toContain(name);
    }
  });
});
