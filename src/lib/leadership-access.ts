import type { AppRole } from "@/lib/auth-context";

const LEADERSHIP_ALLOWED_PATH_PREFIXES = ["/dashboard", "/customers"] as const;

/**
 * Leadership-only users keep the leadership role but not super-admin override.
 * This is used by route guards and nav filtering to keep access behavior aligned.
 */
export function isLeadershipOnlyRoleSet(roles: readonly string[]): boolean {
  return roles.includes("leadership") && !roles.includes("admin");
}

export function isLeadershipAllowedPath(pathname: string): boolean {
  return LEADERSHIP_ALLOWED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function canLeadershipOpenRoute(pathname: string): boolean {
  return isLeadershipAllowedPath(pathname);
}

export function isLeadershipOnlyRole(role: AppRole): boolean {
  return role === "leadership";
}
