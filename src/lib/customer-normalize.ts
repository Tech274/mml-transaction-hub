/**
 * Pure helpers for normalizing customer contact fields.
 * Mirrors the Postgres trigger `normalize_customer_contact` so that
 * server-side duplicate checks and client-side previews agree.
 */

export function normalizeName(v: string): string {
  return v.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeEmail(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase();
  return s ? s : null;
}

export function normalizePhone(v: string | null | undefined): string | null {
  const digits = (v ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 7 ? digits : null;
}
