// SCRUM-100 (G-23): one server-side role check instead of copies in every file.
// Always asks the database (has_any_role), fails closed, and never treats a failed
// permission lookup as "allowed".
import { AppError, logError } from "@/lib/app-error";

export const APP_ROLES = ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Anything with the RLS-scoped Supabase client and the caller's id (server-function context). */
export interface RoleContext {
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> } | any;
  userId: string;
}

export const PERMISSION_CHECK_FAILED = "Could not check your permissions. Please try again.";

/** True only if the database says the caller holds at least one of `roles`. */
export async function hasAnyRole(ctx: RoleContext, roles: readonly AppRole[]): Promise<boolean> {
  if (roles.length === 0) return false;
  const { data, error } = await ctx.supabase.rpc("has_any_role", { _user_id: ctx.userId, _roles: [...roles] });
  if (error) {
    const ref = logError(error, "requireRole", { roles });
    throw new AppError(`${PERMISSION_CHECK_FAILED} (ref ${ref})`, "permission_check_failed");
  }
  return data === true;
}

/** Throws `message` (shown to the user) unless the caller holds one of `roles`. */
export async function requireRole(ctx: RoleContext, roles: readonly AppRole[], message: string): Promise<void> {
  if (!(await hasAnyRole(ctx, roles))) throw new AppError(message, "forbidden");
}
