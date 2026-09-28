// SCRUM-100 (G-23): one server-side role check instead of copies in every file.
// Always asks the database (has_any_role), fails closed, and never treats a failed
// permission lookup as "allowed".
// SCRUM-78: the caller must also have profiles.is_active = true. That row is read
// with the caller's own RLS client (users can read their own profile). The SQL
// helpers learn the same rule in supabase/migrations-pending/ (not applied yet).
import { AppError, logError } from "@/lib/app-error";

export const APP_ROLES = ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Anything with the RLS-scoped Supabase client and the caller's id (server-function context). */
export interface RoleContext {
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> } | any;
  userId: string;
}

export const PERMISSION_CHECK_FAILED = "Could not check your permissions. Please try again.";
export const ACCOUNT_DISABLED_MESSAGE = "Your account is disabled. Contact an admin.";

function permissionCheckFailed(err: unknown, extra?: Record<string, unknown>): AppError {
  const ref = logError(err, "requireRole", extra);
  return new AppError(`${PERMISSION_CHECK_FAILED} (ref ${ref})`, "permission_check_failed");
}

/**
 * True only when the caller's profile is active. Missing profile → false.
 * is_active false throws a user-facing error. A lookup error throws the
 * permission-check error (fail closed).
 */
async function callerIsActive(ctx: RoleContext): Promise<boolean> {
  // Call from() on the client itself. supabase-js's from() is a class method that uses
  // `this`; a detached reference throws a TypeError on every real request.
  const sb = ctx.supabase;
  if (typeof sb?.from !== "function") {
    throw permissionCheckFailed(new Error("role client cannot read profiles"), { check: "is_active" });
  }
  const { data, error } = await sb.from("profiles").select("is_active").eq("id", ctx.userId).maybeSingle();
  if (error) throw permissionCheckFailed(error, { check: "is_active" });
  if (!data) return false;
  if (data.is_active !== true) throw new AppError(ACCOUNT_DISABLED_MESSAGE, "account_disabled");
  return true;
}

/** True only if the database says the caller holds at least one of `roles` and the account is active. */
export async function hasAnyRole(ctx: RoleContext, roles: readonly AppRole[]): Promise<boolean> {
  if (roles.length === 0) return false;
  if (!(await callerIsActive(ctx))) return false;
  const { data, error } = await ctx.supabase.rpc("has_any_role", { _user_id: ctx.userId, _roles: [...roles] });
  if (error) throw permissionCheckFailed(error, { roles: [...roles] });
  return data === true;
}

/** Throws `message` (shown to the user) unless the caller holds one of `roles` and is active. */
export async function requireRole(ctx: RoleContext, roles: readonly AppRole[], message: string): Promise<void> {
  if (!(await hasAnyRole(ctx, roles))) throw new AppError(message, "forbidden");
}
