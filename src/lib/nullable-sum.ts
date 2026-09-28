// SCRUM-103: totals skip NULL costs. A missing cost is not zero, and nothing
// here writes a number back onto the source row.

/** Add `value` into `total`, ignoring null, undefined and non-finite numbers. */
export function addNullable(total: number, value: number | string | null | undefined): number {
  if (value == null || value === "") return total;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return total;
  return total + n;
}
