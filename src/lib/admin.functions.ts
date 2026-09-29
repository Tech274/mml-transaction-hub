import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError, logAudit, logIfError } from "@/lib/app-error";
import { APP_ROLES, requireRole, type RoleContext } from "@/lib/require-role";
import { applyActive, assertNotLastAdmin, assignCreatedUserRoles, syncRoles } from "@/lib/admin-guards";

const roleEnum = z.enum(APP_ROLES);

const assertAdmin = (context: RoleContext) => requireRole(context, ["admin"], "Forbidden: admin only");

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

    // Trigger inserts the profile (admin only for the very first account; older
    // databases also inserted viewer). Add the requested roles before removing
    // any role that was not requested. A failure disables this new account.
    await assignCreatedUserRoles(supabaseAdmin, newUserId, data.roles);

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

export const adminSetUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; active: boolean }) =>
    z.object({ userId: z.string().uuid(), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await applyActive(supabaseAdmin, data.userId, data.active, context.userId);
    return { ok: true };
  });

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
      // SCRUM-96: the profile name is the source of truth; a failed Auth metadata
      // copy is logged instead of being ignored.
      logIfError(
        await supabaseAdmin.auth.admin.updateUserById(data.userId, {
          user_metadata: { full_name: data.fullName },
        } as never),
        "admin.adminUpdateUserProfile:auth_metadata",
      );
    }

    if (data.email) {
      const { data: clash, error: clashErr } = await supabaseAdmin
        .from("profiles").select("id").ilike("email", data.email).maybeSingle();
      if (clashErr) throw dbError(clashErr, "admin.adminUpdateUserProfile:email_check");
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

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("You cannot disable your own account.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // SCRUM-105 (G-11): keep history and foreign-key references intact by disabling
    // the account instead of hard deleting auth.users rows.
    await assertNotLastAdmin(supabaseAdmin, data.userId, false, "disable", { activeOnly: true });
    await applyActive(supabaseAdmin, data.userId, false, context.userId);
    logAudit("admin.user.deactivate", {
      actor_user_id: context.userId,
      target_user_id: data.userId,
      action: "deactivate",
    });
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

    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles").select("full_name").eq("id", data.userId).maybeSingle();
    // Only used to keep full_name in the Auth metadata; log, don't block the reset.
    logIfError({ error: profErr }, "admin.adminResetPassword:profile_read");

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
