// Interim rule until SCRUM-58 is decided: money figures in agent output are visible
// only to admin, leadership and finance.

export const MONEY_ROLES = ["admin", "leadership", "finance"] as const;
export const MONEY_HIDDEN = "[hidden for your role]";

const MONEY_KEY =
  /^(selling_cost|input_cost|input_cost_auto|input_cost_actual_alloc|revenue|profit|margin_pct|margin|cost|price|amount|cost_usd|cost_usd_est)$/i;

export function roleMaySeeMoney(roles: readonly string[]): boolean {
  return roles.some((r) => (MONEY_ROLES as readonly string[]).includes(r));
}

/** Hide money when any role in the audience is outside the interim allow-list. */
export function audienceMaySeeMoney(viewRoles: readonly string[]): boolean {
  return viewRoles.length > 0 && viewRoles.every((r) => (MONEY_ROLES as readonly string[]).includes(r));
}

export function maskMoney<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => walk(item));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = MONEY_KEY.test(key) ? MONEY_HIDDEN : walk(item);
  }
  return out;
}
