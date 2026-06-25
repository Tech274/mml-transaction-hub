import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLE_VALUES = ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"] as const;
const roleEnum = z.enum(ROLE_VALUES);

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; password: string; fullName: string; roles: string[] }) =>
    z.object({
      email: z.string().trim().toLowerCase().email().max(255),
      password: z.string().min(8).max(128),
      fullName: z.string().trim().min(1).max(120),
      roles: z.array(roleEnum).min(1),
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
    if (error) throw new Error(error.message);
    const newUserId = created.user!.id;

    // handle_new_user trigger inserts default viewer role + profile. Sync requested roles.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
    const rows = Array.from(new Set(data.roles)).map((role) => ({ user_id: newUserId, role }));
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert(rows);
    if (rErr) throw new Error(rErr.message);

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
      if (error) throw new Error(error.message);
    }
    if (toAdd.length) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert(toAdd.map((role) => ({ user_id: data.userId, role })));
      if (error) {
        if (error.code === "23505") throw new Error("That role is already assigned to this user.");
        throw new Error(error.message);
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
    if (pErr) throw new Error(pErr.message);

    const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.active ? "none" : "876000h",
    } as any);
    if (aErr) throw new Error(aErr.message);
    return { ok: true };
  });

export const adminUpdateUserProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; fullName: string }) =>
    z.object({ userId: z.string().uuid(), fullName: z.string().trim().min(1).max(120) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles").update({ full_name: data.fullName }).eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });