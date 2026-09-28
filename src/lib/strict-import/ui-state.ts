// SCRUM-103: small pure helpers for the bulk import screen (unit-tested).
import { PUBLIC_STRICT_COLUMNS, STRICT_TEMPLATE_STATUS, STRICT_TEMPLATE_VERSION } from "./template";
import { centsToDecimalString, duplicateFileMessage } from "./commit-plan";
import type { PreviewResult } from "./service";

export { duplicateFileMessage };

/** Name variants and new customers are shown. They never block the import. */
export function needsAcknowledgement(_p: PreviewResult): boolean {
  return false;
}

/** Mirrors the server's commit blockers, plus the single Import anyway confirmation. */
export function canCommit(p: PreviewResult, importAnyway: boolean): boolean {
  if (p.blockers.length > 0) return false;
  if (p.priorImport && !importAnyway) return false;
  return true;
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

export const STRICT_TEMPLATE_BANNER = `Blank cells are saved empty and can be filled in by editing (${STRICT_TEMPLATE_STATUS}). A value that cannot be stored is left blank and listed below.`;
