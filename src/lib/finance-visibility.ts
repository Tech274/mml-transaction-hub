import { dbError } from "@/lib/app-error";
import { APP_ROLES, type AppRole } from "@/lib/require-role";

/**
 * Single source of truth for who can view finance totals (revenue/cost/profit/margin)
 * in server-returned aggregates. Keep this in sync with the approved role matrix.
 */
export const FINANCE_TOTAL_ROLES: readonly AppRole[] = ["admin", "leadership", "finance"];

const APP_ROLE_SET = new Set<string>(APP_ROLES);
const FINANCE_TOTAL_ROLE_SET = new Set<string>(FINANCE_TOTAL_ROLES);

export interface FinanceVisibility {
  roles: AppRole[];
  canViewFinanceTotals: boolean;
}

export function normalizeAppRoles(input: readonly string[]): AppRole[] {
  const unique = new Set<AppRole>();
  for (const role of input) {
    if (APP_ROLE_SET.has(role)) unique.add(role as AppRole);
  }
  return [...unique];
}

export function canViewFinanceTotalsForRoles(roles: readonly string[]): boolean {
  return roles.some((role) => FINANCE_TOTAL_ROLE_SET.has(role));
}

export async function loadFinanceVisibilityForUser(userId: string): Promise<FinanceVisibility> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw dbError(error, "finance-visibility.roles");
  const roles = normalizeAppRoles((data ?? []).map((row) => String(row.role)));
  return {
    roles,
    canViewFinanceTotals: canViewFinanceTotalsForRoles(roles),
  };
}
