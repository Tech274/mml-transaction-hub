// SCRUM-100 (G-23): the admin user-management rules in one place, shared by every
// mutating admin function so the "last Super Admin" protection cannot be bypassed.
// `sb` is the service-role client (server only); callers must check admin first.
import { AppError, dbError } from "@/lib/app-error";

type Sb = any;

/** Ids of all admins. Throws if the lookup fails (an empty list would make the guard pass). */
export async function adminUserIds(sb: Sb): Promise<Set<string>> {
  const { data, error } = await sb.from("user_roles").select("user_id").eq("role", "admin");
  if (error) throw dbError(error, "admin.adminUserIds");
  return new Set<string>(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
}

/** Pure rule: would this change leave no admin at all? */
export function removesLastAdmin(adminIds: Set<string>, userId: string, stillAdmin: boolean): boolean {
  return adminIds.has(userId) && !stillAdmin && adminIds.size <= 1;
}

export async function assertNotLastAdmin(sb: Sb, userId: string, stillAdmin: boolean, verb: "remove" | "disable" | "delete") {
  if (removesLastAdmin(await adminUserIds(sb), userId, stillAdmin)) {
    throw new AppError(`Cannot ${verb} the last Super Admin.`, "last_admin");
  }
}

export async function syncRoles(sb: Sb, userId: string, roles: string[]) {
  const desired = Array.from(new Set(roles));
  await assertNotLastAdmin(sb, userId, desired.includes("admin"), "remove");
  const { data: held, error: heldErr } = await sb.from("user_roles").select("id, role").eq("user_id", userId);
  if (heldErr) throw dbError(heldErr, "admin.syncRoles:read");
  const heldRows = (held ?? []) as Array<{ id: string; role: string }>;
  const heldRoles = new Set(heldRows.map((r) => r.role));
  const toAdd = desired.filter((r) => !heldRoles.has(r));
  const toRemove = heldRows.filter((r) => !desired.includes(r.role));
  if (toRemove.length) {
    const { error } = await sb.from("user_roles").delete().in("id", toRemove.map((r) => r.id));
    if (error) throw dbError(error, "admin.syncRoles");
  }
  if (toAdd.length) {
    const { error } = await sb.from("user_roles").insert(toAdd.map((role) => ({ user_id: userId, role })));
    if (error) {
      if (error.code === "23505") throw new AppError("That role is already assigned to this user.");
      throw dbError(error, "admin.syncRoles");
    }
  }
}

export async function applyActive(sb: Sb, userId: string, active: boolean, callerId: string) {
  if (!active && userId === callerId) throw new AppError("You cannot disable your own account.");
  if (!active) await assertNotLastAdmin(sb, userId, false, "disable");
  const { error: pErr } = await sb.from("profiles").update({ is_active: active }).eq("id", userId);
  if (pErr) throw dbError(pErr, "admin.applyActive");
  const { error: aErr } = await sb.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  if (aErr) throw dbError(aErr, "admin.applyActive");
}
