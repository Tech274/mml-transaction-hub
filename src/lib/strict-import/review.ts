// SCRUM-131: the approved upload flow up to sign-off, as one pure function:
//
//   parse (parse.ts) -> HEALER (healer.ts) -> validate (validate.ts, "approval" tiers) -> review
//
// The review is what the uploader sees, what the server stages and what Chief signs off:
//  - the Healer report: FIXED values (line, field, original -> healed, rule) and FLAGGED issues
//    (blockers and warnings, with the original value);
//  - the staged rows: exactly what will be stored (healed RpcRow), the original cells, the row's
//    warnings and whether the row is Incomplete (Peter's isIncompleteTransaction, not a local rule);
//  - the summary for the sign-off card: rows, Private/Public split, totals, Complete/Incomplete.
// A file with ANY blocker is never staged (blockedRows > 0 -> canSubmit false).
import { isIncompleteTransaction } from "@/lib/transaction-completeness";
import type { RawRow } from "./cells";
import { buildRpcRows, centsToDecimalString, MAX_ROWS_PER_BATCH, type RpcRow } from "./commit-plan";
import {
  correctionsByRule,
  healSheet,
  HEALER_VERSION,
  type HealerContext,
  type HealerCorrection,
  type HealerFlagCode,
  type HealerResult,
  type HealerRule,
  type IssueTier,
} from "./healer";
import { PROPOSED_RULES } from "./template";
import { matchHeaders, validateStrict, type BatchKind, type RowIssue, type StrictValidationResult } from "./validate";

export interface ReviewIssue extends RowIssue {
  tier: IssueTier;
  /** Healer flag code when the Healer raised it; null for validator issues. */
  code: HealerFlagCode | null;
  source: "healer" | "validate";
}

export interface HealerReport {
  healerVersion: typeof HEALER_VERSION;
  dateOrder: HealerResult["dateOrder"];
  fixed: HealerCorrection[];
  fixedByRule: Record<HealerRule, number>;
  blockers: ReviewIssue[];
  warnings: ReviewIssue[];
  newCustomers: string[];
}

export interface StagedRow {
  source_line: number;
  healed: RpcRow;
  /** The file's cells by header (display text), for "original vs stored" on the sign-off screen. */
  original: Record<string, string>;
  warnings: string[];
  is_incomplete: boolean;
}

export interface ReviewSummary {
  rows: number;
  blankRowsIgnored: number;
  blockedRows: number;
  warningRows: number;
  privateRows: number;
  publicRows: number;
  batchKind: BatchKind | null;
  correctionCount: number;
  incompleteRows: number;
  completeRows: number;
  incompleteSellingCents: number;
  incompleteInputCents: number;
  totalUsers: number;
  totalSellingCents: number;
  totalInputCents: number;
}

export interface ImportReview {
  healer: HealerResult;
  validation: StrictValidationResult;
  report: HealerReport;
  summary: ReviewSummary;
  /** Empty when the file has blockers (never staged). */
  stagedRows: StagedRow[];
  /** Reasons the file cannot be submitted for approval. Empty = can submit. */
  blockers: string[];
  canSubmit: boolean;
}

function key(line: number, column: string | null): string {
  return `${line}|${column ?? ""}`;
}

/** Summary sent with stage_import (Healer report counts only; the DB computes counts and totals itself). */
export function stageSummaryOf(review: ImportReview): Record<string, unknown> {
  const warningsByType: Record<string, number> = {};
  for (const w of review.report.warnings) {
    const t = w.code ?? w.header ?? "other";
    warningsByType[t] = (warningsByType[t] ?? 0) + 1;
  }
  return {
    healer_version: review.report.healerVersion,
    // import_stage_summary (070900) keeps date_order only when order matches ^[a-z_]{1,20}$, so send it lowercase
    // ("dmy", "mdy", "unknown"), with "_chosen" when the uploader picked it ("dmy_chosen"). TS-only, no SQL change.
    date_order: {
      order:
        review.report.dateOrder.source === "uploader" && review.report.dateOrder.used
          ? `${review.report.dateOrder.used.toLowerCase()}_chosen`
          : review.report.dateOrder.order.toLowerCase(),
      dayFirstCells: review.report.dateOrder.dayFirstCells,
      monthFirstCells: review.report.dateOrder.monthFirstCells,
    },
    fixed_by_rule: review.report.fixedByRule,
    warnings_by_type: warningsByType,
    warning_count: review.report.warnings.length,
    blocker_count: review.report.blockers.length,
    new_customers: review.report.newCustomers,
    blank_rows_ignored: review.summary.blankRowsIgnored,
  };
}

export function reviewImport(
  header: string[],
  rows: RawRow[],
  ctx: HealerContext & { blankRowsIgnored?: number },
): ImportReview {
  const healer = healSheet(header, rows, ctx);
  const validation = validateStrict(healer.header, healer.rows, { blankRowsIgnored: ctx.blankRowsIgnored, tiers: "approval" });

  // Healer flags win over validator issues on the same cell (same line and column).
  const healerKeys = new Set(healer.flags.map((f) => key(f.line, f.column)));
  const fromHealer: ReviewIssue[] = healer.flags.map((f) => ({
    line: f.line,
    column: f.column,
    header: f.header,
    value: f.value,
    message: f.message,
    tier: f.tier,
    code: f.code,
    source: "healer",
  }));
  const fromValidate = (issues: RowIssue[], tier: IssueTier): ReviewIssue[] =>
    issues.filter((i) => i.column === null || !healerKeys.has(key(i.line, i.column))).map((i) => ({ ...i, tier, code: null, source: "validate" }));
  const byLine = (a: ReviewIssue, b: ReviewIssue) => a.line - b.line || (a.column ?? "").localeCompare(b.column ?? "");
  const blockers = [...fromHealer.filter((f) => f.tier === "blocker"), ...fromValidate(validation.rowErrors, "blocker")].sort(byLine);
  const warnings = [...fromHealer.filter((f) => f.tier === "warning"), ...fromValidate(validation.warnings, "warning")].sort(byLine);

  const blockedLines = new Set(blockers.filter((b) => b.line > 1).map((b) => b.line));
  const fileLevelBlock = blockers.some((b) => b.line <= 1);
  const warningLines = new Set(warnings.filter((w) => w.line > 1).map((w) => w.line));

  const reasons: string[] = [];
  if (blockers.length > 0) {
    reasons.push(
      `${blockers.length} blocking issue(s) on ${blockedLines.size} row(s)${fileLevelBlock ? " and in the header" : ""}. Fix the file and upload it again; nothing was staged.`,
    );
  }
  if (validation.records.length === 0) reasons.push("The file has no rows to import.");
  if (validation.records.length > MAX_ROWS_PER_BATCH) {
    reasons.push(`Too many rows in one file (${validation.records.length} > ${MAX_ROWS_PER_BATCH}). Split the file.`);
  }
  const canSubmit = reasons.length === 0;

  // What will be stored. Only built when nothing blocks (buildRpcRows refuses a row without a provider).
  let stagedRows: StagedRow[] = [];
  if (canSubmit) {
    const rpcRows = buildRpcRows(validation.records);
    const { map } = matchHeaders(header, PROPOSED_RULES);
    const originalByLine = new Map(rows.map((r) => [r.line, r]));
    const warnByLine = new Map<number, string[]>();
    for (const w of warnings) {
      if (w.line <= 1) continue;
      const list = warnByLine.get(w.line) ?? [];
      list.push(w.header ? `${w.header}: ${w.message}` : w.message);
      warnByLine.set(w.line, list);
    }
    stagedRows = rpcRows.map((r) => {
      const raw = originalByLine.get(r.source_line);
      const original: Record<string, string> = {};
      for (const col of PROPOSED_RULES.columns) {
        const idx = map.get(col.field);
        if (idx === undefined) continue;
        const v = raw && idx < raw.cells.length ? raw.cells[idx] : null;
        original[col.header] = v === null ? "" : typeof v === "object" ? v.iso : String(v);
      }
      // Prices are never null in approval tiers (blank -> 0).
      const healed: RpcRow = {
        ...r,
        input_cost: r.input_cost ?? centsToDecimalString(0),
        selling_cost: r.selling_cost ?? centsToDecimalString(0),
      };
      return {
        source_line: r.source_line,
        healed,
        original,
        warnings: warnByLine.get(r.source_line) ?? [],
        is_incomplete: isIncompleteTransaction(healed),
      };
    });
  }

  const recs = validation.records;
  const incomplete = recs.filter((r) =>
    isIncompleteTransaction({
      potential_id: r.potential_id,
      month: r.month,
      year: r.year,
      customer_name: r.customer_name,
      lab_name: r.lab_name,
      cloud_provider: r.cloud_provider,
      input_cost: r.input_cost_cents === null ? null : r.input_cost_cents / 100,
      selling_cost: r.selling_cost_cents === null ? null : r.selling_cost_cents / 100,
    }),
  );
  const s = validation.summary;
  const summary: ReviewSummary = {
    rows: recs.length,
    blankRowsIgnored: s.blankRowsIgnored,
    blockedRows: blockedLines.size,
    warningRows: warningLines.size,
    privateRows: s.privateRows,
    publicRows: s.publicRows,
    batchKind: s.batchKind,
    correctionCount: healer.corrections.length,
    incompleteRows: incomplete.length,
    completeRows: recs.length - incomplete.length,
    incompleteSellingCents: incomplete.reduce((a, r) => a + (r.selling_cost_cents ?? 0), 0),
    incompleteInputCents: incomplete.reduce((a, r) => a + (r.input_cost_cents ?? 0), 0),
    totalUsers: recs.reduce((a, r) => a + (r.total_users ?? 0), 0),
    totalSellingCents: s.totalSellingCents,
    totalInputCents: s.totalInputCents,
  };

  return {
    healer,
    validation,
    report: {
      healerVersion: HEALER_VERSION,
      dateOrder: healer.dateOrder,
      fixed: healer.corrections,
      fixedByRule: correctionsByRule(healer.corrections),
      blockers,
      warnings,
      newCustomers: healer.newCustomers,
    },
    summary,
    stagedRows,
    blockers: reasons,
    canSubmit,
  };
}

/** Corrections payload for stage_import. */
export function stageCorrections(review: ImportReview) {
  return review.report.fixed.map((c) => ({
    source_line: c.line,
    field: c.field,
    rule: c.rule,
    original: c.original,
    healed: c.healed,
  }));
}


// ---------------------------------------------------------------------------
// SCRUM-131 preview response contract (read by Peter's Bulk Upload preview). See SCRUM-131-PR.md.
// ---------------------------------------------------------------------------

/** One Healer fix as the preview shows it. `from` is "" when the cell was blank in the file. */
export interface HealerFix {
  line: number;
  column: string | null;
  header: string | null;
  from: string;
  to: string;
  rule: string;
}

export interface HealerFixCounts {
  /** All fixes (= healerFixes.length). */
  healerFixCount: number;
  /** rule date.reorder_to_iso */
  dateFixes: number;
  /** rule customer.match_existing */
  nameFixes: number;
  /** rule provider.alias */
  providerFixes: number;
  /** rules price.blank_to_zero + price.invalid_to_zero */
  priceFixes: number;
  /** rule text.trim */
  textFixes: number;
}

export function healerFixesOf(review: Pick<ImportReview, "report">): HealerFix[] {
  return review.report.fixed.map((c) => ({
    line: c.line,
    column: c.column ?? null,
    header: c.header ?? null,
    from: c.original ?? "",
    to: c.healed,
    rule: c.rule,
  }));
}

/** Counts are filters over the list, so they always agree with it. */
export function healerFixCounts(fixes: readonly HealerFix[]): HealerFixCounts {
  const n = (pred: (f: HealerFix) => boolean) => fixes.filter(pred).length;
  return {
    healerFixCount: fixes.length,
    dateFixes: n((f) => f.rule === "date.reorder_to_iso"),
    nameFixes: n((f) => f.rule === "customer.match_existing"),
    providerFixes: n((f) => f.rule === "provider.alias"),
    priceFixes: n((f) => f.rule === "price.blank_to_zero" || f.rule === "price.invalid_to_zero"),
    textFixes: n((f) => f.rule === "text.trim"),
  };
}

/**
 * SCRUM-129 providerRows, computed on the HEALED rows, then given back the file's own spelling: when the
 * Healer mapped an alias on a line, providerInFile is the original cell and aliasApplied is true.
 */
export function providerRowsOf(review: Pick<ImportReview, "report" | "validation">) {
  const alias = new Map<number, string>();
  for (const c of review.report.fixed) if (c.rule === "provider.alias") alias.set(c.line, c.original ?? "");
  return review.validation.providerRows.map((p) =>
    alias.has(p.line) ? { ...p, providerInFile: alias.get(p.line)!.trim(), aliasApplied: true } : p,
  );
}
