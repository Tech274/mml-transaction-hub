// SCRUM-129: Bulk Upload copy (spec §129.3, final 06:15). Text helpers only.
// Eng QC fix 1: the preview computes nothing in the browser. Every number passed in here
// comes from the server check (PreviewResult.summary / CommitResult); see server-cloud-view.ts.

/** Private/Public row counts as reported by the server. */
export interface CloudCounts {
  privateCount: number;
  publicCount: number;
}

/** "336 Private cloud · 6 Public cloud" */
export function cloudPreviewSummary(p: CloudCounts): string {
  return `${p.privateCount} Private cloud · ${p.publicCount} Public cloud`;
}

/** Upload card help text (spec §129.3, final 06:15). */
export const BULK_UPLOAD_HELP_TEXT =
  "The Cloud Provider on each row decides its cloud type. Private cloud: MakeMyLabs, Oracle or SAP. Public cloud: AWS, Azure or GCP. A blank provider, or any other provider, stops the import with a row error. Nothing is saved as public by default.";

/** "336 Private cloud · 6 Public cloud · 0 errors" (spec §129.3 preview summary). */
export function cloudPreviewSummaryLine(p: CloudCounts, errorCount: number): string {
  return `${cloudPreviewSummary(p)} · ${errorCount} ${errorCount === 1 ? "error" : "errors"}`;
}

/** "All or nothing: 336 Private cloud and 6 Public cloud rows will be saved." */
export function importFootnote(p: CloudCounts): string {
  return `All or nothing: ${p.privateCount} Private cloud and ${p.publicCount} Public cloud rows will be saved.`;
}

/** "342 rows imported: 336 Private cloud · 6 Public cloud" */
export function importedTitle(inserted: number, p: CloudCounts | null): string {
  return p ? `${inserted} rows imported: ${cloudPreviewSummary(p)}` : `${inserted} rows imported`;
}
