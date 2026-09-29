import type { AppRole } from "@/lib/auth-context";

/**
 * SCRUM-106: current rollout keeps only Super Admin and Leadership live.
 * Other personas stay in data for audit/history but are hidden from assignment UI.
 */
export const LIVE_ROLES: readonly AppRole[] = ["admin", "leadership"];
export const PARKED_ROLES: readonly AppRole[] = ["finance", "ops_lead", "ops_user", "viewer"];
export const ASSIGNABLE_ROLES: readonly AppRole[] = LIVE_ROLES;

export function isParkedRole(role: AppRole): boolean {
  return PARKED_ROLES.includes(role);
}
