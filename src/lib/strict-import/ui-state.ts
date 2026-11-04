// SCRUM-103: small pure helpers for the bulk import screen (unit-tested).
import { PUBLIC_STRICT_COLUMNS, STRICT_COLUMNS, STRICT_TEMPLATE_STATUS, STRICT_TEMPLATE_VERSION } from "./template";
import { REQUIRED_TRANSACTION_FIELDS } from "@/lib/transaction-completeness";
import { centsToDecimalString, duplicateFileMessage } from "./commit-plan";
import type { PreviewResult } from "./service";

export { duplicateFileMessage };

/** Name variants and new customers are shown. They never block the import. */
export function needsAcknowledgement(_p: PreviewResult): boolean {
  return false;
}

/**
 * Mirrors the server's blockers. SCRUM-131: a repeat file (same SHA-256) is a WARNING by default
 * (approved 06:07), so it no longer needs "Import anyway"; the argument is kept for old callers.
 * The action is now "Submit for approval": nothing is imported until an approver signs off.
 */
export function canCommit(p: PreviewResult, _importAnyway?: boolean): boolean {
  return canSubmitForApproval(p);
}

/** SCRUM-131: true when the file can be submitted for sign-off (no blocker anywhere). */
export function canSubmitForApproval(p: PreviewResult): boolean {
  if (p.blockers.length > 0) return false;
  if (p.rowErrors.length > 0) return false;
  return p.canSubmit ?? true;
}

/** Exact money display from integer cents, en-IN digit grouping, always 2 decimals. */
export function formatCents(cents: number): string {
  const [whole, frac] = centsToDecimalString(cents).split(".");
  const neg = whole.startsWith("-");
  const digits = neg ? whole.slice(1) : whole;
  const grouped = new Intl.NumberFormat("en-IN").format(BigInt(digits));
  return `${neg ? "-" : ""}₹${grouped}.${frac}`;
}

/** Header-only CSV template in the exact proposed column order (the parser treats the first row as the header). */
export function strictTemplateCsv(): string {
  return `${PUBLIC_STRICT_COLUMNS.map((c) => c.header).join(",")}\n`;
}

export function strictTemplateFilename(): string {
  return `strict-import-template-${STRICT_TEMPLATE_VERSION}.csv`;
}

/**
 * SCRUM-131 (John, 06:55): the instructions name all six REQUIRED_TRANSACTION_FIELDS as required, in
 * template column order. Text only: the template column `required` flags and lenient mode are unchanged.
 * Lab type is not listed: it is derived from Cloud Provider.
 */
export const STRICT_REQUIRED_COLUMN_HEADERS: readonly string[] = STRICT_COLUMNS.filter((c) =>
  (REQUIRED_TRANSACTION_FIELDS as readonly string[]).includes(c.field),
).map((c) => c.header);

/** Instruction lines for the Bulk Upload screen (and anywhere the template is explained). */
export const STRICT_TEMPLATE_INSTRUCTIONS: readonly string[] = [
  `Required in every row: ${STRICT_REQUIRED_COLUMN_HEADERS.join(", ")}. A blank required cell stops the file until it is filled in.`,
  "Cloud type follows the Cloud Provider (MakeMyLabs, Oracle, SAP = Private cloud; AWS, Azure, GCP = Public cloud). You do not fill it in.",
  "Other blank cells are saved empty and can be filled in later by editing. A blank or 0 Input/Selling Cost is saved as 0 and the row counts as Incomplete.",
  "Nothing is imported until an approver signs off.",
];

export const STRICT_TEMPLATE_BANNER = `${STRICT_TEMPLATE_INSTRUCTIONS.join(" ")} (${STRICT_TEMPLATE_STATUS})`;
