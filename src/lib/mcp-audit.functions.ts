import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "@/lib/app-error";
import { requireRole } from "@/lib/require-role";

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface McpAuditRow {
  id: string;
  user_id: string;
  user_email: string | null;
  client_id: string | null;
  tool_name: string;
  arguments: JsonValue;
  success: boolean;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface McpClientStatus {
  client_id: string;
  first_seen: string;
  last_seen: string;
  total_calls: number;
  success_calls: number;
  revoked: boolean;
  revoked_at: string | null;
}

const filterSchema = z
  .object({
    tool_name: z.string().optional(),
    success: z.boolean().optional(),
    client_id: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .optional();

/** Signed-in user's own MCP invocation history. */
export const listMyMcpAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => filterSchema.parse(data ?? {}) ?? {})
  .handler(async ({ data, context }): Promise<McpAuditRow[]> => {
    const filter = data ?? {};
    let q = context.supabase
      .from("mcp_tool_audit_log")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(filter.limit ?? 100);
    if (filter.tool_name) q = q.eq("tool_name", filter.tool_name);
    if (typeof filter.success === "boolean") q = q.eq("success", filter.success);
    if (filter.client_id) q = q.eq("client_id", filter.client_id);
    const { data: rows, error } = await q;
    if (error) throw dbError(error, "mcp-audit.listMyMcpAudit");
    return (rows ?? []) as unknown as McpAuditRow[];
  });

/** Admin-only: every user's MCP invocation history. */
export const listAllMcpAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => filterSchema.parse(data ?? {}) ?? {})
  .handler(async ({ data, context }): Promise<McpAuditRow[]> => {
    // SCRUM-61 (G-21): explicit server-side check (RLS also limits rows).
    await requireRole(context, ["admin"], "Forbidden: admin role required");
    const filter = data ?? {};
    let q = context.supabase
      .from("mcp_tool_audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(filter.limit ?? 200);
    if (filter.tool_name) q = q.eq("tool_name", filter.tool_name);
    if (typeof filter.success === "boolean") q = q.eq("success", filter.success);
    if (filter.client_id) q = q.eq("client_id", filter.client_id);
    const { data: rows, error } = await q;
    if (error) throw dbError(error, "mcp-audit.listAllMcpAudit");
    return (rows ?? []) as unknown as McpAuditRow[];
  });

/** Per-client connection status derived from the audit log + revocations. */
export const listMyMcpClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<McpClientStatus[]> => {
    const { data: rows, error } = await context.supabase
      .from("mcp_tool_audit_log")
      .select("client_id, created_at, success")
      .eq("user_id", context.userId);
    if (error) throw dbError(error, "mcp-audit.listMyMcpClients");

    // SCRUM-59: a failed lookup used to show every client as "connected".
    const { data: revoked, error: revokedErr } = await context.supabase
      .from("mcp_revoked_clients")
      .select("client_id, revoked_at")
      .eq("user_id", context.userId);
    if (revokedErr) throw dbError(revokedErr, "mcp-audit.listMyMcpClients");
    const revokedMap = new Map<string, string>();
    for (const r of revoked ?? []) revokedMap.set((r as { client_id: string }).client_id, (r as { revoked_at: string }).revoked_at);

    const byClient = new Map<string, McpClientStatus>();
    for (const r of rows ?? []) {
      const row = r as { client_id: string | null; created_at: string; success: boolean };
      const id = row.client_id ?? "unknown";
      const cur = byClient.get(id);
      if (!cur) {
        byClient.set(id, {
          client_id: id,
          first_seen: row.created_at,
          last_seen: row.created_at,
          total_calls: 1,
          success_calls: row.success ? 1 : 0,
          revoked: revokedMap.has(id),
          revoked_at: revokedMap.get(id) ?? null,
        });
      } else {
        cur.total_calls += 1;
        if (row.success) cur.success_calls += 1;
        if (row.created_at < cur.first_seen) cur.first_seen = row.created_at;
        if (row.created_at > cur.last_seen) cur.last_seen = row.created_at;
      }
    }
    // Include revoked clients that never called anything (edge case)
    for (const [id, revoked_at] of revokedMap) {
      if (!byClient.has(id)) {
        byClient.set(id, {
          client_id: id,
          first_seen: revoked_at,
          last_seen: revoked_at,
          total_calls: 0,
          success_calls: 0,
          revoked: true,
          revoked_at,
        });
      }
    }
    return [...byClient.values()].sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1));
  });

export const revokeMcpClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ client_id: z.string().min(1) }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("mcp_revoked_clients")
      .insert({ user_id: context.userId, client_id: data.client_id } as never);
    if (error && !/duplicate key/i.test(error.message)) throw dbError(error, "mcp-audit.revokeMcpClient");
    return { ok: true };
  });

export const unrevokeMcpClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ client_id: z.string().min(1) }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("mcp_revoked_clients")
      .delete()
      .eq("user_id", context.userId)
      .eq("client_id", data.client_id);
    if (error) throw dbError(error, "mcp-audit.unrevokeMcpClient");
    return { ok: true };
  });
