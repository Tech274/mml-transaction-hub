// SCRUM-129 (Eng QC fix 1): the Bulk Upload preview shows ONLY the server check result.
// Nothing authoritative is computed in the browser. Pure helpers over Chris's contract
// (SCRUM-131-PR.md "Preview response contract", scrum-131-import-healer-approval @ eedae34):
//   PreviewResult.summary.privateRows / publicRows / errorCount / providerErrorRows /
//     providerAliasesApplied + healerFixCount and per-rule counts (SCRUM-131)
//   PreviewResult.providerRows: ProviderRowInfo[] (one per non-blank row, file order)
//   PreviewResult.healerFixes: HealerFix[] (SCRUM-131, every Healer fix incl. provider.alias)
//   PreviewResult.rowErrors: RowIssue[]
//   CommitResult.privateRows / publicRows (post-import confirmation)
import type { HealerFix } from "./review";
import type { CommitResult, PreviewResult } from "./service";
import type { ProviderRowInfo, RowIssue, StrictSummary } from "./validate";

/** The preview as the UI reads it (Chris's PreviewResult; healerFixes is optional in the type only). */
export type PreviewForUi = PreviewResult;

export interface ServerCloudCounts {
  privateCount: number;
  publicCount: number;
}

export function serverCloudCounts(
  summary: Pick<StrictSummary, "privateRows" | "publicRows">,
): ServerCloudCounts {
  return { privateCount: summary.privateRows, publicCount: summary.publicRows };
}

export function committedCloudCounts(
  result: Pick<CommitResult, "privateRows" | "publicRows">,
): ServerCloudCounts {
  return { privateCount: result.privateRows, publicCount: result.publicRows };
}

/** One line shown in the Healer fixes list. */
export interface HealerFixLine {
  line: number;
  /** Spreadsheet column letter, e.g. "L", or null when the server did not send one. */
  column: string | null;
  /** Column header the fix applies to, e.g. "Cloud Provider". */
  field: string;
  /** Original cell; "" when it was blank in the file. */
  from: string;
  to: string;
  /** Healer rule id, e.g. "provider.alias". */
  rule: string;
}

export function providerAliasFixes(rows: readonly ProviderRowInfo[]): HealerFixLine[] {
  return rows.flatMap((r) =>
    r.aliasApplied && r.storedProvider
      ? [
          {
            line: r.line,
            column: null,
            field: "Cloud Provider",
            from: r.providerInFile,
            to: r.storedProvider,
            rule: "provider.alias",
          },
        ]
      : [],
  );
}

function healerFixLine(h: HealerFix): HealerFixLine {
  return {
    line: h.line,
    column: h.column,
    field: h.header ?? h.column ?? h.rule,
    from: h.from,
    to: h.to,
    rule: h.rule,
  };
}

/**
 * All Healer fixes from the server, in line order. SCRUM-131: when the preview carries
 * `healerFixes` it is the ONLY source (it already holds every provider.alias fix, so adding the
 * providerRows aliases would list each alias twice). The providerRows aliases are the fallback
 * only for an older server that does not send `healerFixes`.
 */
export function serverHealerFixLines(
  p: Pick<PreviewForUi, "providerRows" | "healerFixes">,
): HealerFixLine[] {
  const lines = p.healerFixes
    ? p.healerFixes.map(healerFixLine)
    : providerAliasFixes(p.providerRows);
  return lines.slice().sort((a, b) => a.line - b.line);
}

/** SCRUM-131 Healer rules in the order the preview lists them (contract: SCRUM-131-PR.md). */
export const HEALER_RULE_ORDER = [
  "date.reorder_to_iso",
  "customer.match_existing",
  "provider.alias",
  "price.blank_to_zero",
  "price.invalid_to_zero",
  "text.trim",
] as const;

/** Sentence-case heading per rule. An unknown rule falls back to its id. */
export const HEALER_RULE_LABELS: Record<(typeof HEALER_RULE_ORDER)[number], string> = {
  "date.reorder_to_iso": "Dates rewritten as YYYY-MM-DD",
  "customer.match_existing": "Customer names matched to an existing customer",
  "provider.alias": "Provider names standardised",
  "price.blank_to_zero": "Blank prices stored as 0",
  "price.invalid_to_zero": "Invalid prices stored as 0",
  "text.trim": "Extra spaces trimmed",
};

export function healerRuleLabel(rule: string): string {
  return (HEALER_RULE_LABELS as Record<string, string>)[rule] ?? rule;
}

export interface HealerFixGroup {
  rule: string;
  label: string;
  fixes: HealerFixLine[];
}

/**
 * Healer fix lines grouped by rule: known rules in HEALER_RULE_ORDER, then any other rule by id.
 * Lines keep line order inside a group. Empty groups are left out.
 */
export function groupHealerFixesByRule(lines: readonly HealerFixLine[]): HealerFixGroup[] {
  const byRule = new Map<string, HealerFixLine[]>();
  for (const l of lines) byRule.set(l.rule, [...(byRule.get(l.rule) ?? []), l]);
  const known: readonly string[] = HEALER_RULE_ORDER;
  const rules = [
    ...known.filter((r) => byRule.has(r)),
    ...[...byRule.keys()].filter((r) => !known.includes(r)).sort(),
  ];
  return rules.map((rule) => ({
    rule,
    label: healerRuleLabel(rule),
    fixes: (byRule.get(rule) ?? []).slice().sort((a, b) => a.line - b.line),
  }));
}

/** "Line 12 · col G" (column omitted when the server sent none). */
export function healerFixWhere(l: Pick<HealerFixLine, "line" | "column">): string {
  return l.column ? `Line ${l.line} · col ${l.column}` : `Line ${l.line}`;
}

/** Number of Healer fixes: summary.healerFixCount when the server sends it, else the list length. */
export function serverHealerFixCount(
  p: Pick<PreviewForUi, "providerRows" | "healerFixes"> & {
    summary: Partial<Pick<NonNullable<PreviewForUi["summary"]>, "healerFixCount">>;
  },
): number {
  return p.summary.healerFixCount ?? serverHealerFixLines(p).length;
}

/** "{n} providers standardised (e.g. OCI → Oracle)". Count = summary.providerAliasesApplied. */
export function serverStandardisedLine(
  p: Pick<PreviewForUi, "providerRows"> & {
    summary: Pick<StrictSummary, "providerAliasesApplied">;
  },
): string | null {
  const n = p.summary.providerAliasesApplied;
  if (!n) return null;
  const first = p.providerRows.find((r) => r.aliasApplied && r.storedProvider);
  const base = `${n} ${n === 1 ? "provider" : "providers"} standardised`;
  return first ? `${base} (e.g. ${first.providerInFile} → ${first.storedProvider})` : base;
}

/** Server row errors grouped by line, for the per-row table. */
export function serverErrorsByLine(rowErrors: readonly RowIssue[]): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const e of rowErrors) m.set(e.line, [...(m.get(e.line) ?? []), e.message]);
  return m;
}

/**
 * Sanity check that the server's summary matches its own row list (Chris: "the summary counts
 * equal the matching filters over this list"). Used by tests; the UI shows the summary.
 */
export function providerRowsAgreeWithSummary(
  p: Pick<PreviewResult, "providerRows"> & {
    summary: Pick<
      StrictSummary,
      "privateRows" | "publicRows" | "providerErrorRows" | "providerAliasesApplied"
    >;
  },
): boolean {
  const r = p.providerRows;
  return (
    r.filter((x) => x.cloudType === "private_cloud").length === p.summary.privateRows &&
    r.filter((x) => x.cloudType === "public_cloud").length === p.summary.publicRows &&
    r.filter((x) => x.blocked).length === p.summary.providerErrorRows &&
    r.filter((x) => x.aliasApplied).length === p.summary.providerAliasesApplied
  );
}
