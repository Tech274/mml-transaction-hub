// SCRUM-89 (G-03): shared-secret check for the scheduled job endpoints
// under /api/public/hooks/*. Pure helpers only (safe to import anywhere);
// the database lookup lives in cron-auth.server.ts.
//
// Before this change the hooks accepted any request that carried the
// Supabase *publishable* key, which is public by design (it ships in the
// browser bundle). Anyone could trigger the jobs. Now pg_cron sends a
// dedicated secret in the `x-cron-secret` header. The secret is generated
// inside the database (Supabase Vault) and never appears in code or chat.

export const CRON_SECRET_HEADER = "x-cron-secret";

/** Vault secret is 32 random bytes hex-encoded (64 chars). Anything shorter is rejected early. */
export const CRON_SECRET_MIN_LENGTH = 32;
const CRON_SECRET_MAX_LENGTH = 512;

/** Fixed retention for the scheduled artifact cleanup. Callers can no longer choose it. */
export const CLEANUP_RETENTION_DAYS = 90;

/**
 * Returns the candidate token from the request headers, or null when it is
 * missing or obviously malformed. It does NOT decide whether the token is
 * correct; that is done by the database (verify_cron_secret).
 */
export function extractCronToken(headers: Headers): string | null {
  const raw = headers.get(CRON_SECRET_HEADER);
  if (raw == null) return null;
  const token = raw.trim();
  if (token.length < CRON_SECRET_MIN_LENGTH || token.length > CRON_SECRET_MAX_LENGTH) return null;
  if (/\s/.test(token)) return null;
  return token;
}
