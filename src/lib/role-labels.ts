// SCRUM-128 (plan §3.3 footer, N8, C3): one label per role, shared by the sidebar footer, the
// Dashboard and Admin settings. Moved from dashboard-super-admin-summary.tsx (values unchanged).
// Before this, the sidebar printed roles[0] with "_" replaced and CSS capitalising ("Admin"),
// while the Dashboard said "Super Admin" for the same role.
import type { AppRole } from "@/lib/auth-context";

export const ROLE_LABEL: Readonly<Record<AppRole, string>> = {
  admin: "Super Admin",
  leadership: "Leadership",
  finance: "Finance",
  ops_lead: "Ops Lead",
  ops_user: "Ops User",
  viewer: "Viewer",
};

/** Highest role first: the order the Dashboard already used to pick the role it shows. */
export const ROLE_ORDER: readonly AppRole[] = [
  "admin",
  "leadership",
  "finance",
  "ops_lead",
  "ops_user",
  "viewer",
];

export const NO_ROLE_LABEL = "No role";

function isAppRole(value: string): value is AppRole {
  return Object.prototype.hasOwnProperty.call(ROLE_LABEL, value);
}

/** The role a user is shown as: the highest of their roles, or null when they have none. */
export function primaryRole(roles: readonly string[]): AppRole | null {
  return ROLE_ORDER.find((r) => roles.includes(r)) ?? null;
}

/** Label for one role; unknown values are returned as is rather than hidden. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return NO_ROLE_LABEL;
  return isAppRole(role) ? ROLE_LABEL[role] : role;
}

/** Label for a user's role list, as shown in the sidebar footer. */
export function primaryRoleLabel(roles: readonly string[]): string {
  return roleLabel(primaryRole(roles));
}
