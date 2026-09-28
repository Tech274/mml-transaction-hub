// SCRUM-100 (G-23): the admin user-management rules in one place, shared by every
// mutating admin function so the "last Super Admin" protection cannot be bypassed.
// `sb` is the service-role client (server only); callers must check admin first.
import { AppError, dbError, logError } from "@/lib/app-error";

type Sb = any;

/**
 * Ids of admins. With `activeOnly`, a disabled profile does not count (role
 * changes and disabling a user). Delete keeps the default and still counts
 * every admin row. Throws if a lookup fails (an empty list would make the
 * guard pass). A missing profile row is not an active admin.
 */
export async function adminUserIds(sb: Sb, opts?: { activeOnly?: boolean }): Promise<Set<string>> {
  const { data, error } = await sb.from("user_roles").select("user_id").eq("role", "admin");
  if (error) throw dbError(error, "admin.adminUserIds");
  const ids = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
  if (!opts?.activeOnly || ids.length === 0) return new Set(ids);
  const { data: profiles, error: pErr } = await sb.from("profiles").select("id, is_active").in("id", ids);
  if (pErr) throw dbError(pErr, "admin.adminUserIds");
  return new Set(
    ((profiles ?? []) as Array<{ id: string; is_active: boolean | null }>)
      .filter((p) => p.is_active === true)
      .map((p) => p.id),
  );
}

/** Pure rule: would this change leave no admin at all? */
export function removesLastAdmin(adminIds: Set<string>, userId: string, stillAdmin: boolean): boolean {
  return adminIds.has(userId) && !stillAdmin && adminIds.size <= 1;
}

export async function assertNotLastAdmin(
  sb: Sb,
  userId: string,
  stillAdmin: boolean,
  verb: "remove" | "disable" | "delete",
  opts?: { activeOnly?: boolean },
) {
  if (removesLastAdmin(await adminUserIds(sb, opts), userId, stillAdmin)) {
    throw new AppError(`Cannot ${verb} the last Super Admin.`, "last_admin");
  }
}

export async function syncRoles(sb: Sb, userId: string, roles: string[]) {
  const desired = Array.from(new Set(roles));
  await assertNotLastAdmin(sb, userId, desired.includes("admin"), "remove", { activeOnly: true });
  const { data: held, error: heldErr } = await sb.from("user_roles").select("id, role").eq("user_id", userId);
  if (heldErr) throw dbError(heldErr, "admin.syncRoles:read");
  const heldRows = (held ?? []) as Array<{ id: string; role: string }>;
  const heldRoles = new Set(heldRows.map((r) => r.role));
  const toAdd = desired.filter((r) => !heldRoles.has(r));
  const toRemove = heldRows.filter((r) => !desired.includes(r.role));
  // Insert before delete. A failed insert must leave the roles the user already
  // has (including a default viewer). Deleting first could leave them with none.
  if (toAdd.length) {
    const { error } = await sb.from("user_roles").insert(toAdd.map((role) => ({ user_id: userId, role })));
    if (error) {
      if (error.code === "23505") throw new AppError("That role is already assigned to this user.");
      throw dbError(error, "admin.syncRoles");
    }
  }
  if (toRemove.length) {
    const { error } = await sb.from("user_roles").delete().in("id", toRemove.map((r) => r.id));
    if (error) throw dbError(error, "admin.syncRoles");
  }
}

export const ACCOUNT_MAY_STILL_BE_ACTIVE =
  "The new account could not be fully disabled and may still be active.";

/**
 * Sets is_active false and bans sign-in. The ban always runs, even when the
 * profile update throws or returns an error. Does not apply the last-admin guard.
 */
export async function disableAccount(sb: Sb, userId: string): Promise<{ profileError: unknown; banError: unknown }> {
  let profileError: unknown = null;
  try {
    const updated = await sb.from("profiles").update({ is_active: false }).eq("id", userId);
    profileError = updated?.error ?? null;
  } catch (e) {
    profileError = e;
  }
  let banError: unknown = null;
  try {
    const banned = await sb.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    banError = banned?.error ?? null;
  } catch (e) {
    banError = e;
  }
  return { profileError, banError };
}

/**
 * Role setup for a user auth.admin.createUser just created. The trigger has
 * already inserted the profile (and, on older databases, a default viewer role).
 * Requested roles are inserted before any other role is removed. If that sync
 * fails, the new account is disabled and banned, then the role error is rethrown.
 * If the profile update or the ban fails, the admin gets an explicit error that
 * the account may still be active (with a ref). A last-admin refusal happens
 * before any write, so that account is left as the trigger created it.
 */
export async function assignCreatedUserRoles(sb: Sb, userId: string, roles: string[]): Promise<void> {
  try {
    await syncRoles(sb, userId, roles);
  } catch (err) {
    if (err instanceof AppError && err.code === "last_admin") throw err;
    const { profileError, banError } = await disableAccount(sb, userId);
    if (profileError || banError) {
      const ref = logError(err, "admin.assignCreatedUserRoles:disable", {
        profileError: errorBrief(profileError),
        banError: errorBrief(banError),
      });
      throw new AppError(`${ACCOUNT_MAY_STILL_BE_ACTIVE} (ref ${ref})`, "account_may_be_active");
    }
    throw err;
  }
}

function errorBrief(err: unknown): string | null {
  if (!err) return null;
  if (typeof err === "object" && err && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

export async function applyActive(sb: Sb, userId: string, active: boolean, callerId: string) {
  if (!active && userId === callerId) throw new AppError("You cannot disable your own account.");
  if (!active) await assertNotLastAdmin(sb, userId, false, "disable", { activeOnly: true });
  const { error: pErr } = await sb.from("profiles").update({ is_active: active }).eq("id", userId);
  if (pErr) throw dbError(pErr, "admin.applyActive");
  const { error: aErr } = await sb.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  if (aErr) throw dbError(aErr, "admin.applyActive");
}
