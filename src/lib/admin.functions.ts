import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "@/lib/app-error";

const ROLE_VALUES = ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"] as const;
const roleEnum = z.enum(ROLE_VALUES);

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw dbError(error, "admin.assertAdmin");
  if (!data) throw new Error("Forbidden: admin only");
}

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; password: string; fullName: string; roles: string[]; isActive?: boolean }) =>
    z.object({
      email: z.string().trim().toLowerCase().email().max(255),
      password: z.string().min(8).max(128),
      fullName: z.string().trim().min(1).max(120),
      roles: z.array(roleEnum).min(1),
      isActive: z.boolean().optional().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Friendly duplicate-email check
    const { data: existing } = await supabaseAdmin
      .from("profiles").select("id, email").ilike("email", data.email).maybeSingle();
    if (existing) throw new Error("A user with this email already exists.");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error) throw dbError(error, "admin.adminCreateUser");
    const newUserId = created.user!.id;

    // handle_new_user trigger inserts default viewer role + profile. Sync requested roles.
    const { error: clearErr } = await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
    if (clearErr) throw dbError(clearErr, "admin.adminCreateUser:clearDefaultRoles");
    const rows = Array.from(new Set(data.roles)).map((role) => ({ user_id: newUserId, role }));
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert(rows);
    if (rErr) throw dbError(rErr, "admin.adminCreateUser");

    // Optionally create the account disabled (profile flag + auth ban).
    if (data.isActive === false) {
      // SCRUM-96: these used to be unchecked, so a failure left the new account ACTIVE
      // although the admin asked for it to be disabled.
      const { error: deactErr } = await supabaseAdmin.from("profiles").update({ is_active: false }).eq("id", newUserId);
      if (deactErr) throw dbError(deactErr, "admin.adminCreateUser:deactivate");
      const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(newUserId, { ban_duration: "876000h" } as never);
      if (banErr) throw dbError(banErr, "admin.adminCreateUser:ban");
    }

    return { id: newUserId };
  });

export const adminSetUserRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; roles: string[] }) =>
    z.object({ userId: z.string().uuid(), roles: z.array(roleEnum) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const desired = Array.from(new Set(data.roles));

    // Prevent removing the last admin
    const { data: currentAdmins } = await supabaseAdmin
      .from("user_roles").select("user_id").eq("role", "admin");
    const adminIds = new Set((currentAdmins ?? []).map((r) => r.user_id));
    const wasAdmin = adminIds.has(data.userId);
    const willBeAdmin = desired.includes("admin");
    if (wasAdmin && !willBeAdmin && adminIds.size <= 1) {
      throw new Error("Cannot remove the last Super Admin.");
    }

    const { data: held } = await supabaseAdmin
      .from("user_roles").select("id, role").eq("user_id", data.userId);
    const heldRoles = new Set((held ?? []).map((r) => r.role));
    const toAdd = desired.filter((r) => !heldRoles.has(r));
    const toRemove = (held ?? []).filter((r) => !desired.includes(r.role));

    if (toRemove.length) {
      const { error } = await supabaseAdmin.from("user_roles").delete().in("id", toRemove.map((r) => r.id));
      if (error) throw dbError(error, "admin.adminSetUserRoles");
    }
    if (toAdd.length) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert(toAdd.map((role) => ({ user_id: data.userId, role })));
      if (error) {
        if (error.code === "23505") throw new Error("That role is already assigned to this user.");
        throw dbError(error, "admin.adminSetUserRoles");
      }
    }
    return { ok: true };
  });

export const adminSetUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; active: boolean }) =>
    z.object({ userId: z.string().uuid(), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!data.active && data.userId === context.userId) {
      throw new Error("You cannot disable your own account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Block last-admin disable
    if (!data.active) {
      const { data: admins } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
      const adminIds = new Set((admins ?? []).map((r) => r.user_id));
      if (adminIds.has(data.userId) && adminIds.size <= 1) {
        throw new Error("Cannot disable the last Super Admin.");
      }
    }

    const { error: pErr } = await supabaseAdmin
      .from("profiles").update({ is_active: data.active }).eq("id", data.userId);
    if (pErr) throw dbError(pErr, "admin.adminSetUserActive");

    const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.active ? "none" : "876000h",
    } as any);
    if (aErr) throw dbError(aErr, "admin.adminSetUserActive");
    return { ok: true };
  });

// Shared role-sync used by adminSetUserRoles and the expanded update fn so the
// last-admin protection can never be bypassed on any mutating path.
async function syncRoles(sb: any, userId: string, roles: string[]) {
  const desired = Array.from(new Set(roles));
  const { data: currentAdmins } = await sb.from("user_roles").select("user_id").eq("role", "admin");
  const adminIds = new Set<string>((currentAdmins ?? []).map((r: { user_id: string }) => r.user_id));
  const wasAdmin = adminIds.has(userId);
  const willBeAdmin = desired.includes("admin");
  if (wasAdmin && !willBeAdmin && adminIds.size <= 1) {
    throw new Error("Cannot remove the last Super Admin.");
  }
  const { data: held } = await sb.from("user_roles").select("id, role").eq("user_id", userId);
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
      if (error.code === "23505") throw new Error("That role is already assigned to this user.");
      throw dbError(error, "admin.syncRoles");
    }
  }
}

async function applyActive(sb: any, userId: string, active: boolean, callerId: string) {
  if (!active && userId === callerId) throw new Error("You cannot disable your own account.");
  if (!active) {
    const { data: admins } = await sb.from("user_roles").select("user_id").eq("role", "admin");
    const adminIds = new Set<string>((admins ?? []).map((r: { user_id: string }) => r.user_id));
    if (adminIds.has(userId) && adminIds.size <= 1) {
      throw new Error("Cannot disable the last Super Admin.");
    }
  }
  const { error: pErr } = await sb.from("profiles").update({ is_active: active }).eq("id", userId);
  if (pErr) throw dbError(pErr, "admin.applyActive");
  const { error: aErr } = await sb.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  } as any);
  if (aErr) throw dbError(aErr, "admin.applyActive");
}

// Expanded update: full name, email, active status and roles in one call.
// Every field is optional; unspecified fields are left untouched.
export const adminUpdateUserProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; fullName?: string; email?: string; isActive?: boolean; roles?: string[] }) =>
    z.object({
      userId: z.string().uuid(),
      fullName: z.string().trim().min(1).max(120).optional(),
      email: z.string().trim().toLowerCase().email().max(255).optional(),
      isActive: z.boolean().optional(),
      roles: z.array(roleEnum).min(1).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.fullName) {
      const { error } = await supabaseAdmin
        .from("profiles").update({ full_name: data.fullName }).eq("id", data.userId);
      if (error) throw dbError(error, "admin.adminUpdateUserProfile");
      await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        user_metadata: { full_name: data.fullName },
      } as never);
    }

    if (data.email) {
      const { data: clash } = await supabaseAdmin
        .from("profiles").select("id").ilike("email", data.email).maybeSingle();
      if (clash && clash.id !== data.userId) throw new Error("A user with this email already exists.");
      const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        email: data.email,
        email_confirm: true,
      } as never);
      if (aErr) throw dbError(aErr, "admin.adminUpdateUserProfile");
      const { error: pErr } = await supabaseAdmin
        .from("profiles").update({ email: data.email }).eq("id", data.userId);
      if (pErr) throw dbError(pErr, "admin.adminUpdateUserProfile");
    }

    if (data.roles) await syncRoles(supabaseAdmin, data.userId, data.roles);
    if (typeof data.isActive === "boolean") {
      await applyActive(supabaseAdmin, data.userId, data.isActive, context.userId);
    }

    return { ok: true };
  });

// Alias with a clearer name; same behaviour as the expanded update above.
export const adminUpdateUser = adminUpdateUserProfile;

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("You cannot delete your own account.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: admins } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
    const adminIds = new Set((admins ?? []).map((r) => r.user_id));
    if (adminIds.has(data.userId) && adminIds.size <= 1) {
      throw new Error("Cannot delete the last Super Admin.");
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw dbError(error, "admin.adminDeleteUser");
    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; tempPassword: string }) =>
    z.object({
      userId: z.string().uuid(),
      tempPassword: z.string().min(8).max(128),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: prof } = await supabaseAdmin
      .from("profiles").select("full_name").eq("id", data.userId).maybeSingle();

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.tempPassword,
      user_metadata: {
        must_change_password: true,
        ...(prof?.full_name ? { full_name: prof.full_name } : {}),
      },
    } as never);
    if (error) throw dbError(error, "admin.adminResetPassword");
    // The temporary password is never emailed or logged — the UI shows it once.
    return { ok: true };
  });
