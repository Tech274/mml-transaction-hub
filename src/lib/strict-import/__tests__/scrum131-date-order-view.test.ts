// SCRUM-131 date fix: the preview's date-format prompt (pure helper). Synthetic only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reviewImport, stageSummaryOf } from "../review";
import {
  canPickDateOrder,
  dateOrderLabel,
  dateOrderPrompt,
  DATE_ORDER_OPTIONS,
  previewMatchesChoice,
  stageDateOrderLine,
  staleDateOrderNote,
} from "../date-order-view";
import { HEADER, row } from "./fixtures";

const report = (dates: [string, string][], dateOrder?: "DMY" | "MDY") =>
  reviewImport(
    HEADER,
    dates.map(([s, e], i) =>
      row(i + 2, { "Potential ID": `PID-V-${i}`, "Start Date": s, "End Date": e }),
    ),
    { customers: [{ customer_name: "Acme Test Co" }], dateOrder },
  ).report.dateOrder;

describe("dateOrderPrompt", () => {
  it("asks when every date is ambiguous and nothing was chosen", () => {
    expect(dateOrderPrompt(report([["05-04-2026", "06-04-2026"]]))).toEqual({
      kind: "choose",
      message:
        "2 dates could be day-first or month-first and nothing in the file says which. Choose the date format used in this file:",
    });
  });
  it("shows the choice once made", () => {
    expect(dateOrderPrompt(report([["05-04-2026", "06-04-2026"]], "MDY"))).toEqual({
      kind: "chosen",
      message: "Dates read as MM-DD-YYYY (your choice).",
      chosen: "MDY",
    });
  });
  it("shows nothing when the file proves its order, has only ISO dates, or no report", () => {
    expect(dateOrderPrompt(report([["21-04-2026", "05-04-2026"]]))).toBeNull();
    expect(dateOrderPrompt(report([["2026-04-05", "2026-04-06"]]))).toBeNull();
    expect(dateOrderPrompt(undefined)).toBeNull();
  });
  it("offers exactly the two orders the server accepts", () => {
    expect(DATE_ORDER_OPTIONS.map((o) => o.value)).toEqual(["DMY", "MDY"]);
  });
});

describe("stageDateOrderLine (F1: approver sees the uploader's choice)", () => {
  it("dmy_chosen / mdy_chosen give the line", () => {
    expect(stageDateOrderLine({ date_order: { order: "dmy_chosen" } })).toBe(
      "Dates read as DD-MM-YYYY (uploader's choice; nothing in the file proved the order)",
    );
    expect(stageDateOrderLine({ date_order: { order: "mdy_chosen", dayFirstCells: 0 } })).toBe(
      "Dates read as MM-DD-YYYY (uploader's choice; nothing in the file proved the order)",
    );
  });
  it("My uploads wording for the uploader's own view", () => {
    expect(stageDateOrderLine({ date_order: { order: "dmy_chosen" } }, "you")).toBe(
      "Dates read as DD-MM-YYYY (your choice; nothing in the file proved the order)",
    );
  });
  it("nothing when absent, a proven order, unknown, or an unexpected shape", () => {
    for (const s of [
      undefined,
      null,
      {},
      { date_order: null },
      { date_order: "dmy_chosen" },
      { date_order: ["dmy_chosen"] },
      { date_order: { order: "dmy" } },
      { date_order: { order: "mdy" } },
      { date_order: { order: "unknown" } },
      { date_order: { order: "DMY_CHOSEN" } },
      { date_order: {} },
    ]) {
      expect(stageDateOrderLine(s as never), JSON.stringify(s)).toBeNull();
    }
  });
  it("matches what submit stores for a chosen order (stageSummaryOf)", () => {
    const r = reviewImport(
      HEADER,
      [row(2, { "Start Date": "05-04-2026", "End Date": "06-04-2026" })],
      { customers: [{ customer_name: "Acme Test Co" }], dateOrder: "MDY" },
    );
    expect(stageDateOrderLine(stageSummaryOf(r))).toContain("MM-DD-YYYY (uploader's choice");
    const proven = reviewImport(
      HEADER,
      [row(2, { "Start Date": "21-04-2026", "End Date": "06-04-2026" })],
      { customers: [{ customer_name: "Acme Test Co" }] },
    );
    expect(stageDateOrderLine(stageSummaryOf(proven))).toBeNull();
  });
});

// Source guards (the repo has no DOM test setup): the screens use the helpers above.
const read = (p: string) => readFileSync(path.resolve(__dirname, "../../../..", p), "utf8");

describe("screens wire the date-format lines (source guards)", () => {
  it("F1: the sign-off page shows the uploader's choice near the Healer report and in the approve dialog", () => {
    const page = read("src/routes/_authenticated/import-approvals.$stageId.tsx");
    expect(page).toContain("const dateOrderLine = stageDateOrderLine(stage.summary);");
    expect(page).toContain('data-testid="date-order-line"');
    expect(page).toContain('dialog === "approve" && dateOrderLine && (');
    expect(page).toContain('data-testid="date-order-dialog"');
  });
  it("F1: My uploads shows the same line (your choice)", () => {
    expect(read("src/lib/my-uploads.ts")).toContain(
      'dateOrderNote: stageDateOrderLine(stage.summary, "you")',
    );
    expect(read("src/routes/_authenticated/my-uploads.tsx")).toContain(
      'data-testid="date-order-note"',
    );
  });
  it("nits: picker first, banner reason, preview kept while re-checking, aria-pressed", () => {
    const ui = read("src/components/strict-import.tsx");
    // The counts block is "Rows in file:" today and data-testid="preview-summary" after SCRUM-128 C15.
    const summaryAt = [ui.indexOf('data-testid="preview-summary"'), ui.indexOf("Rows in file:")]
      .filter((n) => n >= 0)
      .sort((a, b) => a - b)[0];
    expect(summaryAt).toBeGreaterThan(0);
    expect(ui.indexOf('data-testid="date-order-prompt"')).toBeLessThan(summaryAt);
    expect(ui).toContain("Choose a date format (above) to continue.");
    const choose = ui.slice(
      ui.indexOf("async function onChooseDateOrder"),
      ui.indexOf("acknowledgeRepeatFile: the"),
    );
    expect(choose).not.toContain("reset()");
    expect(ui).toContain("aria-pressed={selected}");
    expect(ui).toMatch(
      /aria-disabled=\{\s*!canPickDateOrder\(o\.value, dateOrder, resultDateOrder, busy\)\s*\}/,
    );
  });
});

describe("S2: a failed re-check keeps the old preview, and it can never be sent with the new choice", () => {
  it("Send only when the preview on screen was checked with the chosen format", () => {
    expect(previewMatchesChoice(undefined, undefined)).toBe(true); // no choice needed / made
    expect(previewMatchesChoice("DMY", "DMY")).toBe(true); // re-check succeeded
    expect(previewMatchesChoice(undefined, "DMY")).toBe(false); // first pick failed: old needsChoice preview
    expect(previewMatchesChoice("DMY", "MDY")).toBe(false); // switched format, re-check failed
  });

  it("buttons: retry the chosen format after a failure; nothing while busy; no-op when already matching", () => {
    expect(canPickDateOrder("DMY", "DMY", undefined, false)).toBe(true); // retry after failed first pick
    expect(canPickDateOrder("MDY", "DMY", undefined, false)).toBe(true); // or pick the other
    expect(canPickDateOrder("DMY", "DMY", "DMY", false)).toBe(false); // already shown
    expect(canPickDateOrder("MDY", "DMY", "DMY", false)).toBe(true); // change format
    expect(canPickDateOrder("MDY", undefined, undefined, true)).toBe(false); // busy
  });

  it("stale note says why Send is off and how to retry; none when the preview matches", () => {
    expect(staleDateOrderNote(undefined, "DMY")).toBe(
      "The preview below is still the one checked without a date format: the check with DD-MM-YYYY did not finish. Click DD-MM-YYYY to try again or pick the other format. Sending stays off until a check succeeds.",
    );
    expect(staleDateOrderNote("DMY", "MDY")).toContain(
      "still the one checked as DD-MM-YYYY: the check with MM-DD-YYYY",
    );
    expect(staleDateOrderNote("MDY", "MDY")).toBeNull();
    expect(staleDateOrderNote(undefined, undefined)).toBeNull();
    expect(dateOrderLabel("MDY")).toBe("MM-DD-YYYY");
  });

  it("strict-import.tsx: failure keeps the preview, Send/Submit-anyway gated, submit sends the shown preview's format", () => {
    const ui = read("src/components/strict-import.tsx");
    const choose = ui.slice(
      ui.indexOf("async function onChooseDateOrder"),
      ui.indexOf("acknowledgeRepeatFile: the"),
    );
    expect(choose).not.toContain("setResult(null)");
    expect(choose).toContain("setResultDateOrder(order);");
    expect(choose).toContain("Could not check the file as ${dateOrderLabel(order)}: ${message}");
    expect(choose).toContain("canPickDateOrder(order, dateOrder, resultDateOrder, busy)");
    // serverCanSubmit gates both Send (canSendForSignOff) and "Submit anyway" (canSubmitAnyway).
    expect(ui).toMatch(
      /const serverCanSubmit =\s*result && previewMatchesChoice\(resultDateOrder, dateOrder\)\s*\?\s*canSubmitForApproval\(result\)\s*:\s*false;/,
    );
    expect(ui).toContain("canSendForSignOff(serverCanSubmit, signOff)");
    expect(ui).toContain("canSubmitAnyway(serverCanSubmit, signOff)");
    expect(ui).toContain(
      "if (!file || !result || !previewMatchesChoice(resultDateOrder, dateOrder)) return;",
    );
    expect(ui).toContain("...(resultDateOrder ? { dateOrder: resultDateOrder } : {}),");
    expect(ui).not.toContain("...(dateOrder ? { dateOrder } : {}),");
    expect(ui).toContain('data-testid="date-order-stale"');
    // A new file clears both.
    expect(ui).toMatch(/setDateOrder\(undefined\);\s*setResultDateOrder\(undefined\);/);
  });
});
