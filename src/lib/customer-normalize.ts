/**
 * Pure helpers for normalizing customer contact fields.
 * Mirrors the Postgres trigger `normalize_customer_contact` so that
 * server-side duplicate checks and client-side previews agree.
 */

/**
 * Unicode spaces that JavaScript's \s matches and Postgres [[:space:]] does not.
 * Keep this list in step with public.clean_customer_name in
 * supabase/migrations/20260928040000_scrum103_customer_name_normalize.sql (a test compares them).
 */
const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/g;

/** Trim, turn NBSP and other unicode spaces into regular spaces, collapse runs. Case is kept. */
export function cleanCustomerName(v: string): string {
  return v.replace(UNICODE_SPACES, " ").replace(/\s+/g, " ").trim();
}

/** Same cleaning, then lowercase. This is the customers.normalized_name key. */
export function normalizeName(v: string): string {
  return cleanCustomerName(v).toLowerCase();
}

export function normalizeEmail(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase();
  return s ? s : null;
}

export function normalizePhone(v: string | null | undefined): string | null {
  const digits = (v ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 7 ? digits : null;
}
