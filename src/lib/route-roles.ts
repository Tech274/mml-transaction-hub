// SCRUM-61 (G-21): one place that says which roles may open which page.
// Used by route guards (beforeLoad). Server functions and RLS still enforce
// the same rules on the data; the guard just stops the page from loading.
import type { AppRole } from "@/lib/auth-context";

export const ROUTE_ROLES = {
  "/admin": ["admin"],
  "/mcp-audit": ["admin"],
  // Master ADR Entry: ops roles enter data; leadership may view import history.
  "/entry": ["admin", "ops_lead", "ops_user", "leadership"],
  "/mml-lab/lab-catalog": ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"],
  "/mml-lab/cost-catalog": ["admin", "leadership", "finance", "ops_lead", "ops_user"],
  "/mml-lab/batches": ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"],
} as const satisfies Record<string, readonly AppRole[]>;

export type GuardedRoute = keyof typeof ROUTE_ROLES;

export function rolesFor(route: GuardedRoute): AppRole[] {
  return [...ROUTE_ROLES[route]];
}

/** Pure check used in tests and anywhere a role list is already loaded. */
export function hasAnyOf(userRoles: readonly string[], required: readonly AppRole[]): boolean {
  return required.some((r) => userRoles.includes(r));
}
