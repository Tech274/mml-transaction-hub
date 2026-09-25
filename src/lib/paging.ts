// SCRUM-94 (G-14): small helpers to read everything without silent caps and
// to avoid repeating slow external calls on every page view.

/**
 * Reads pages until a short page arrives. Stops at maxRows and says so
 * (truncated = true) instead of silently dropping rows.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize: number,
  maxRows: number,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const page = await fetchPage(from, Math.min(from + pageSize, maxRows) - 1);
    rows.push(...page);
    if (page.length < Math.min(pageSize, maxRows - from)) return { rows, truncated: false };
  }
  // Hit the cap exactly: check whether anything is left.
  const more = await fetchPage(maxRows, maxRows);
  return { rows, truncated: more.length > 0 };
}

/** Caches one async value for ttlMs (per server instance). */
export function ttlCache<T>(ttlMs: number, load: () => Promise<T>, now: () => number = Date.now) {
  let value: { v: T; at: number } | null = null;
  let inflight: Promise<T> | null = null;
  return async (): Promise<T> => {
    if (value && now() - value.at < ttlMs) return value.v;
    if (inflight) return inflight;
    inflight = load()
      .then((v) => {
        value = { v, at: now() };
        return v;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
