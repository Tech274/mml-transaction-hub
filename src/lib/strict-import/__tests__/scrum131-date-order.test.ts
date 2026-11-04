// SCRUM-131 date fix: whole-file date order, the uploader's choice for all-ambiguous files, never a silent NULL.
// Synthetic data only (no real customer file contents).
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { createApprovalDb, submitAs, as, stageRow, USERS } from "@/test-support/scrum131-db";
import { pgUntypedDb } from "@/test-support/pg-untyped-db";
import {
  synthetic131Csv,
  synthetic131Rows,
  type Synthetic131Row,
} from "@/test-support/scrum131-fixture";
import { STRICT_HEADERS } from "@/test-support/scrum129-fixture";
import type { RawCell } from "../cells";
import { runApprove } from "../approval";
import { approvalDepsFor } from "../approval-queries";
import { healDate, type ChosenDateOrder } from "../healer";
import { reviewImport, stageSummaryOf } from "../review";
import { runPreview, StrictImportError, type StrictImportDeps } from "../service";
import type { XlsxLike } from "../parse";
import { HEADER, row } from "./fixtures";

const CUSTOMERS = [{ customer_name: "Acme Test Co" }];
/** One row per [start, end] pair, line 2 onwards, unique Potential IDs. */
const file = (dates: [RawCell, RawCell][], dateOrder?: ChosenDateOrder) =>
  reviewImport(
    HEADER,
    dates.map(([s, e], i) =>
      row(i + 2, { "Potential ID": `PID-DATE-${i}`, "Start Date": s, "End Date": e }),
    ),
    { customers: CUSTOMERS, dateOrder },
  );
type Review = ReturnType<typeof file>;
const healed = (r: Review) => r.validation.records.map((x) => [x.start_date, x.end_date]);
const dateBlockers = (r: Review) =>
  r.report.blockers
    .filter((b) => /Date/.test(b.header ?? ""))
    .map((b) => [b.line, b.header, b.code]);

describe("D1 whole-file day-first / month-first detection", () => {
  it("DD-MM: a first part above 12 makes the whole file day-first (05-04 = 5 April); /, . and D-M-YYYY too", () => {
    const r = file([
      ["21-04-2026", "30-04-2026"],
      ["05-04-2026", "06-04-2026"],
      ["21/04/2026", "1-4-2026"],
      ["13.05.2026", "05.05.2026"],
    ]);
    expect(r.canSubmit).toBe(true);
    expect(r.report.dateOrder).toMatchObject({
      order: "DMY",
      used: "DMY",
      source: "file",
      needsChoice: false,
    });
    expect(r.report.dateOrder.dayFirstExample).toBe('line 2, Start Date "21-04-2026"');
    expect(healed(r)).toEqual([
      ["2026-04-21", "2026-04-30"],
      ["2026-04-05", "2026-04-06"],
      ["2026-04-21", "2026-04-01"],
      ["2026-05-13", "2026-05-05"],
    ]);
  });

  it("MM-DD: a middle part above 12 makes the whole file month-first (05-04 = 4 May)", () => {
    const r = file([
      ["04-21-2026", "04-30-2026"],
      ["05-04-2026", "06-04-2026"],
    ]);
    expect(r.canSubmit).toBe(true);
    expect(r.report.dateOrder).toMatchObject({ order: "MDY", used: "MDY", source: "file" });
    expect(healed(r)).toEqual([
      ["2026-04-21", "2026-04-30"],
      ["2026-05-04", "2026-06-04"],
    ]);
  });

  it("ISO text and Excel date cells keep working and need no order", () => {
    const r = file([
      ["2026-04-21", "2026-04-30"],
      [
        { kind: "date", iso: "2026-04-05" },
        { kind: "date", iso: "2026-04-06" },
      ],
    ]);
    expect(r.canSubmit).toBe(true);
    expect(r.report.dateOrder).toMatchObject({
      order: "UNKNOWN",
      used: null,
      needsChoice: false,
      ambiguousCells: 0,
    });
    expect(healed(r)).toEqual([
      ["2026-04-21", "2026-04-30"],
      ["2026-04-05", "2026-04-06"],
    ]);
  });

  it("an impossible date (31-02-2026) is blocked and is NOT evidence of an order", () => {
    const r = file([
      ["31-02-2026", "2026-04-06"],
      ["05-04-2026", "06-04-2026"],
    ]);
    expect(r.report.dateOrder).toMatchObject({
      order: "UNKNOWN",
      dayFirstCells: 0,
      needsChoice: true,
    });
    expect(dateBlockers(r)).toEqual([
      [2, "Start Date", "date.impossible"],
      [3, "Start Date", "date.ambiguous"],
      [3, "End Date", "date.ambiguous"],
    ]);
  });
});

describe("D2 inconsistent (mixed) files are blocked as a whole", () => {
  it("day-first and month-first proof in one file, no ambiguous cell: every DD-MM-style date is blocked", () => {
    const r = file([
      ["21-04-2026", "30-04-2026"],
      ["04-21-2026", "04-30-2026"],
      ["2026-04-01", { kind: "date", iso: "2026-04-02" }],
    ]);
    expect(r.canSubmit).toBe(false);
    expect(r.report.dateOrder).toMatchObject({ order: "MIXED", used: null, needsChoice: false });
    expect(dateBlockers(r)).toEqual([
      [2, "Start Date", "date.mixed_order"],
      [2, "End Date", "date.mixed_order"],
      [3, "Start Date", "date.mixed_order"],
      [3, "End Date", "date.mixed_order"],
    ]);
    const msg = r.report.blockers[0].message;
    expect(msg).toContain("Start Date:");
    expect(msg).toContain('"21-04-2026"');
    expect(msg).toContain(
      'Day-first: line 2, Start Date "21-04-2026"; month-first: line 3, Start Date "04-21-2026"',
    );
    expect(r.stagedRows).toEqual([]);
  });

  it("a choice cannot rescue a mixed file", () => {
    const r = file(
      [
        ["21-04-2026", "30-04-2026"],
        ["04-21-2026", "04-30-2026"],
      ],
      "DMY",
    );
    expect(r.canSubmit).toBe(false);
    expect(dateBlockers(r).every((b) => b[2] === "date.mixed_order")).toBe(true);
  });
});

describe("D3 all-ambiguous files: never guessed, the uploader chooses", () => {
  const AMBIGUOUS: [RawCell, RawCell][] = [
    ["05-04-2026", "06-04-2026"],
    ["01-02-2026", "03-03-2026"],
  ];

  it("without a choice: blocked, needsChoice, the message asks for the format", () => {
    const r = file(AMBIGUOUS);
    expect(r.canSubmit).toBe(false);
    expect(r.report.dateOrder).toMatchObject({
      order: "UNKNOWN",
      ambiguousCells: 3,
      needsChoice: true,
      used: null,
    });
    // 03-03-2026 reads the same either way: not blocked, not counted as ambiguous.
    expect(dateBlockers(r)).toEqual([
      [2, "Start Date", "date.ambiguous"],
      [2, "End Date", "date.ambiguous"],
      [3, "Start Date", "date.ambiguous"],
    ]);
    expect(r.report.blockers[0].message).toMatch(/^Start Date: "05-04-2026" is ambiguous/);
    expect(r.report.blockers[0].message).toContain(
      "Choose the date format for this file (DD-MM-YYYY or MM-DD-YYYY)",
    );
    expect(r.stagedRows).toEqual([]);
  });

  it("with DD-MM chosen: read day-first, recorded as the uploader's choice", () => {
    const r = file(AMBIGUOUS, "DMY");
    expect(r.canSubmit).toBe(true);
    expect(r.report.dateOrder).toMatchObject({
      order: "UNKNOWN",
      used: "DMY",
      source: "uploader",
      needsChoice: false,
      chosen: "DMY",
    });
    expect(healed(r)).toEqual([
      ["2026-04-05", "2026-04-06"],
      ["2026-02-01", "2026-03-03"],
    ]);
    expect(stageSummaryOf(r).date_order).toEqual({
      order: "dmy_chosen",
      dayFirstCells: 0,
      monthFirstCells: 0,
    });
  });

  it("with MM-DD chosen: read month-first", () => {
    const r = file(AMBIGUOUS, "MDY");
    expect(r.canSubmit).toBe(true);
    expect(r.report.dateOrder).toMatchObject({ used: "MDY", source: "uploader" });
    expect(healed(r)).toEqual([
      ["2026-05-04", "2026-06-04"],
      ["2026-01-02", "2026-03-03"],
    ]);
  });

  it("a choice that contradicts the file's proof is a blocker (server re-check); a matching one is accepted", () => {
    const dates: [RawCell, RawCell][] = [
      ["21-04-2026", "30-04-2026"],
      ["05-04-2026", "06-04-2026"],
    ];
    const wrong = file(dates, "MDY");
    expect(wrong.canSubmit).toBe(false);
    expect(dateBlockers(wrong)).toEqual([[2, "Start Date", "date.order_conflict"]]);
    expect(wrong.report.blockers[0].message).toContain(
      "chosen (MM-DD-YYYY) does not match this file, which is DD-MM-YYYY",
    );
    expect(wrong.report.blockers[0].message).toContain(
      "Send without a date format, or fix the file.",
    );
    expect(wrong.report.blockers[0].message).not.toContain("Remove the choice");
    const same = file(dates, "DMY");
    expect(same.canSubmit).toBe(true);
    expect(same.report.dateOrder).toMatchObject({ used: "DMY", source: "file" });
  });

  it("a choice on a file that needs none (ISO only) is ignored", () => {
    const r = file([["2026-04-05", "2026-04-06"]], "MDY");
    expect(r.canSubmit).toBe(true);
    expect(r.report.dateOrder).toMatchObject({ used: null, source: null, chosen: "MDY" });
    expect(healed(r)).toEqual([["2026-04-05", "2026-04-06"]]);
  });
});

describe("D7 S1: a value with no valid reading under either order is impossible, never ambiguous", () => {
  const codes = (r: Review) =>
    dateBlockers(r).map(([line, header, code]) => `${line} ${header} ${code}`);
  const msgs = (r: Review) => r.report.blockers.map((b) => b.message);

  it("healDate: impossible under every file order", () => {
    for (const v of [
      "00-05-2026",
      "05-00-2026",
      "14-13-2026",
      "31-02-2026",
      "32-01-2026",
      "02-30-2026",
    ]) {
      for (const order of ["UNKNOWN", "DMY", "MDY", "MIXED"] as const) {
        expect(healDate(v, order), `${v} ${order}`).toEqual({
          kind: "flag",
          code: "date.impossible",
          message: `"${v}" is not a real calendar date.`,
        });
      }
    }
    // A real ambiguous date is still ambiguous with no order.
    expect(healDate("05-04-2026", "UNKNOWN")).toMatchObject({ code: "date.ambiguous" });
  });

  it("file with no ambiguous cell: impossible blockers, no needsChoice, no proof, no 'Choose' message", () => {
    const r = file([
      ["00-05-2026", "2026-04-06"],
      ["14-13-2026", "31-02-2026"],
      ["32-01-2026", "05-00-2026"],
    ]);
    expect(r.canSubmit).toBe(false);
    expect(r.report.dateOrder).toMatchObject({
      order: "UNKNOWN",
      dayFirstCells: 0,
      monthFirstCells: 0,
      ambiguousCells: 0,
      needsChoice: false,
      used: null,
    });
    expect(codes(r)).toEqual([
      "2 Start Date date.impossible",
      "3 Start Date date.impossible",
      "3 End Date date.impossible",
      "4 Start Date date.impossible",
      "4 End Date date.impossible",
    ]);
    expect(msgs(r)[0]).toBe('Start Date: "00-05-2026" is not a real calendar date.');
    expect(msgs(r)[1]).toBe('Start Date: "14-13-2026" is not a real calendar date.');
    for (const m of msgs(r)) expect(m).not.toContain("Choose the date format");
  });

  it("file with ambiguous cells: impossible cells stay impossible; only real ambiguous dates need the choice", () => {
    const dates: [RawCell, RawCell][] = [
      ["05-04-2026", "00-05-2026"],
      ["14-13-2026", "06-04-2026"],
      ["32-01-2026", "31-02-2026"],
    ];
    const r = file(dates);
    expect(r.report.dateOrder).toMatchObject({
      order: "UNKNOWN",
      ambiguousCells: 2,
      needsChoice: true,
      dayFirstCells: 0,
    });
    expect(codes(r)).toEqual([
      "2 Start Date date.ambiguous",
      "2 End Date date.impossible",
      "3 Start Date date.impossible",
      "3 End Date date.ambiguous",
      "4 Start Date date.impossible",
      "4 End Date date.impossible",
    ]);
    // A choice heals the ambiguous dates only; the impossible ones still block.
    const chosen = file(dates, "DMY");
    expect(chosen.report.dateOrder).toMatchObject({
      used: "DMY",
      source: "uploader",
      needsChoice: false,
    });
    expect(codes(chosen)).toEqual([
      "2 End Date date.impossible",
      "3 Start Date date.impossible",
      "4 Start Date date.impossible",
      "4 End Date date.impossible",
    ]);
    expect(chosen.canSubmit).toBe(false);
  });

  it("in a proven or a mixed file they are impossible too, and prove nothing", () => {
    const dmy = file([
      ["21-04-2026", "00-05-2026"],
      ["32-01-2026", "14-13-2026"],
    ]);
    expect(dmy.report.dateOrder).toMatchObject({
      order: "DMY",
      dayFirstCells: 1,
      monthFirstCells: 0,
    });
    expect(codes(dmy)).toEqual([
      "2 End Date date.impossible",
      "3 Start Date date.impossible",
      "3 End Date date.impossible",
    ]);
    const mixed = file([
      ["21-04-2026", "04-21-2026"],
      ["00-05-2026", "31-02-2026"],
    ]);
    expect(mixed.report.dateOrder).toMatchObject({
      order: "MIXED",
      dayFirstCells: 1,
      monthFirstCells: 1,
    });
    expect(codes(mixed)).toEqual([
      "2 Start Date date.mixed_order",
      "2 End Date date.mixed_order",
      "3 Start Date date.impossible",
      "3 End Date date.impossible",
    ]);
  });
});

describe("D4 never a silent NULL, never an auto-fill", () => {
  it("garbage dates block the row with the column and the value; nothing is staged", () => {
    const r = file([
      ["2026-04-21", "not a date"],
      ["21-04-26", "2026/04/21"],
      ["45000", "2026-4-21"],
    ]);
    expect(r.canSubmit).toBe(false);
    expect(r.report.blockers.map((b) => [b.line, b.header, b.value])).toEqual([
      [2, "End Date", "not a date"],
      [3, "Start Date", "21-04-26"],
      [3, "End Date", "2026/04/21"],
      [4, "Start Date", "45000"],
      [4, "End Date", "2026-4-21"],
    ]);
    for (const b of r.report.blockers) expect(b.message).toContain(String(b.value));
    expect(r.stagedRows).toEqual([]);
  });

  it("blank stays blank (warning, still imported); no date is filled in", () => {
    const r = file([
      ["21-04-2026", ""],
      ["", null],
    ]);
    expect(r.canSubmit).toBe(true);
    expect(healed(r)).toEqual([
      ["2026-04-21", null],
      [null, null],
    ]);
    expect(
      r.report.warnings.filter((w) => /Date/.test(w.header ?? "")).map((w) => [w.line, w.header]),
    ).toEqual([
      [2, "End Date"],
      [3, "Start Date"],
      [3, "End Date"],
    ]);
    expect(
      r.report.fixed
        .filter((f) => f.rule === "date.reorder_to_iso")
        .map((f) => [f.line, f.original, f.healed]),
    ).toEqual([[2, "21-04-2026", "2026-04-21"]]);
  });
});

describe("D5 XLSX: Excel serial dates and DD-MM strings through the real parser", () => {
  it("a date-formatted serial is a date, an unformatted number is blocked, a DD-MM string is healed", async () => {
    const base = synthetic131Rows()[300];
    const hdr: string[] = [...STRICT_HEADERS];
    const iS = hdr.indexOf("Start Date");
    const iE = hdr.indexOf("End Date");
    const mk = (pid: string, s: unknown, e: unknown) => {
      const r: unknown[] = hdr.map(() => "");
      const set = (h: string, v: unknown) => (r[hdr.indexOf(h)] = v);
      set("Potential ID", pid);
      set("Month", base.month);
      set("Year", base.year);
      set("Customer Name", base.customer);
      set("Lab Name", base.lab);
      set("Line of Business", base.lob);
      set("Total Users", base.users);
      set("Input Cost", base.input);
      set("Selling Cost", base.selling);
      set("Cloud Provider", base.provider);
      r[iS] = s;
      r[iE] = e;
      return r;
    };
    const build = (rows: unknown[][], formatFirst: boolean) => {
      const ws = XLSX.utils.aoa_to_sheet([hdr, ...rows]);
      if (formatFirst) {
        ws[XLSX.utils.encode_cell({ r: 1, c: iS })].z = "dd-mm-yyyy";
        ws[XLSX.utils.encode_cell({ r: 1, c: iE })].z = "dd-mm-yyyy";
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Data");
      return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    };
    const deps: StrictImportDeps = {
      hasImportRole: async () => true,
      listCustomers: async () =>
        synthetic131Rows().map((r) => ({
          customer_name: r.customer,
          normalized_name: r.customer.toLowerCase(),
        })),
      priorImport: async () => null,
      callStage: async () => {
        throw new Error("not used");
      },
      loadXlsx: async () => XLSX as unknown as XlsxLike,
    };
    // 46133 = 2026-04-21, 46142 = 2026-04-30
    const ok = await runPreview(deps, {
      filename: "d.xlsx",
      bytes: build([mk("SYN-X-0", 46133, 46142), mk("SYN-X-1", "21-04-2026", "05-04-2026")], true),
    });
    expect(ok.canSubmit).toBe(true);
    expect(ok.dateOrder).toMatchObject({ order: "DMY", used: "DMY", source: "file" });
    expect(
      (ok.healerFixes ?? [])
        .filter((f) => f.rule === "date.reorder_to_iso")
        .map((f) => [f.from, f.to]),
    ).toEqual([
      ["21-04-2026", "2026-04-21"],
      ["05-04-2026", "2026-04-05"],
    ]);
    const plain = await runPreview(deps, {
      filename: "d.xlsx",
      bytes: build([mk("SYN-X-0", 46133, "2026-04-30")], false),
    });
    expect(plain.canSubmit).toBe(false);
    expect(plain.rowErrors.map((e) => [e.header, e.value])).toEqual([["Start Date", "46133"]]);
  });
});

describe("D6 end to end: submit -> stage_import -> approve -> transactions (PGlite, synthetic)", () => {
  const base = synthetic131Rows()[300];
  const rowsWith = (tag: string, dates: [string, string][]): Synthetic131Row[] =>
    dates.map(([start, end], i) => ({ ...base, potentialId: `SYN-DATE-${tag}-${i}`, start, end }));
  const approve = async (
    db: Awaited<ReturnType<typeof createApprovalDb>>,
    s: Awaited<ReturnType<typeof submitAs>>,
  ) =>
    runApprove(approvalDepsFor(pgUntypedDb(db, as(USERS.CHIEF)), USERS.CHIEF), {
      stageId: s.stageId,
      fileSha256: s.fileSha256,
      rowsSha256: s.rowsSha256,
      reason: null,
    });
  const txDates = async (db: Awaited<ReturnType<typeof createApprovalDb>>, tag: string) =>
    (
      await db.query<{ s: string | null; e: string | null }>(
        "select start_date::text s, end_date::text e from public.transactions where potential_id like $1 order by potential_id",
        [`SYN-DATE-${tag}-%`],
      )
    ).rows.map((r) => [r.s, r.e]);

  it("REGRESSION (6 Oct): 21-04-2026 is stored as 2026-04-21, never NULL; a blank stays NULL", async () => {
    const db = await createApprovalDb();
    const s = await submitAs(
      db,
      USERS.OPS,
      synthetic131Csv(
        rowsWith("reg", [
          ["21-04-2026", "30-04-2026"],
          ["05-04-2026", ""],
        ]),
      ),
      "reg.csv",
    );
    expect(s.dateOrder).toEqual({ used: "DMY", source: "file" });
    expect((await stageRow(db, s.stageId)).summary).toMatchObject({
      date_order: { order: "dmy", dayFirstCells: 2 },
    });
    await approve(db, s);
    expect(await txDates(db, "reg")).toEqual([
      ["2026-04-21", "2026-04-30"],
      ["2026-04-05", null],
    ]);
  }, 60_000);

  it("all-ambiguous file: refused on the server without a choice; with DD-MM chosen it is staged and stored day-first", async () => {
    const db = await createApprovalDb();
    const csv = synthetic131Csv(
      rowsWith("amb", [
        ["05-04-2026", "06-04-2026"],
        ["01-02-2026", "03-02-2026"],
      ]),
    );
    const refused = await submitAs(db, USERS.OPS, csv, "amb.csv").catch((e) => e);
    expect(refused).toBeInstanceOf(StrictImportError);
    expect((refused as StrictImportError).code).toBe("blocked");
    // The four ambiguous dates (detail and wording: D3). Nothing was staged.
    expect((refused as StrictImportError).reasons).toEqual([
      "4 blocking issue(s) on 2 row(s). Fix the file and upload it again; nothing was staged.",
    ]);

    const s = await submitAs(db, USERS.OPS, csv, "amb.csv", { dateOrder: "DMY" });
    expect(s.dateOrder).toEqual({ used: "DMY", source: "uploader" });
    expect((await stageRow(db, s.stageId)).summary).toMatchObject({
      date_order: { order: "dmy_chosen" },
    });
    await approve(db, s);
    expect(await txDates(db, "amb")).toEqual([
      ["2026-04-05", "2026-04-06"],
      ["2026-02-01", "2026-02-03"],
    ]);
  }, 60_000);

  it("a choice that contradicts a day-first file is refused on the server", async () => {
    const db = await createApprovalDb();
    const csv = synthetic131Csv(
      rowsWith("conf", [
        ["21-04-2026", "30-04-2026"],
        ["05-04-2026", "06-04-2026"],
      ]),
    );
    const refused = await submitAs(db, USERS.OPS, csv, "conf.csv", { dateOrder: "MDY" }).catch(
      (e) => e,
    );
    expect((refused as StrictImportError).code).toBe("blocked");
    // One date.order_conflict blocker (wording: D3).
    expect((refused as StrictImportError).reasons).toEqual([
      "1 blocking issue(s) on 1 row(s). Fix the file and upload it again; nothing was staged.",
    ]);
    expect(await db.query("select 1 from public.import_stages")).toMatchObject({ rows: [] });
  }, 60_000);
});
