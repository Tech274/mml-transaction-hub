// SCRUM-89 (G-03): server-only verification of the scheduled-job secret.
// Top-level import of client.server is fine here because this is a .server.ts module.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { extractCronToken } from "./cron-auth";

/**
 * True only when the request carries the Vault-held cron secret.
 * Fails closed: a missing header, a malformed token, a database error or a
 * missing verify function all return false.
 */
export async function isAuthorizedCronRequest(request: Request): Promise<boolean> {
  const token = extractCronToken(request.headers);
  if (!token) return false;
  const { data, error } = await supabaseAdmin.rpc("verify_cron_secret", { _token: token });
  if (error) {
    // Log the reason server-side only; the caller just gets 401.
    console.error("[cron-auth] verify_cron_secret failed:", error.message);
    return false;
  }
  return data === true;
}

export function unauthorizedResponse(): Response {
  return new Response("Unauthorized", { status: 401 });
}
