// SCRUM-96 (G-17): one way to report failures.
// - The full error (message, code, details, hint) is logged on the server with a short ref.
// - The browser gets a friendly message plus the ref, never table/constraint names.
// - Errors we raise on purpose for users (AppError, or plain literal messages) are unchanged.

/** An error whose message is written for end users and may be shown as-is. */
export class AppError extends Error {
  readonly userFacing = true;
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "AppError";
  }
}

type ErrLike = { message?: unknown; code?: unknown; details?: unknown; hint?: unknown; status?: unknown; name?: unknown };

const FRIENDLY_BY_CODE: Record<string, string> = {
  // Postgres
  "23505": "This record already exists.",
  "23503": "This record is linked to other data, so the change was not allowed.",
  "23502": "A required value is missing.",
  "23514": "Some values are not allowed.",
  "22P02": "Some values have the wrong format.",
  "22001": "A value is too long.",
  "42501": "You do not have permission to do that.",
  "57014": "The request took too long. Please try again.",
  // PostgREST
  PGRST116: "The record was not found.",
  PGRST301: "Your session has expired. Please sign in again.",
  // Supabase Auth (messages are safe to show, but we keep our own wording)
  email_exists: "A user with this email already exists.",
  user_already_exists: "A user with this email already exists.",
  weak_password: "The password is too weak.",
  user_not_found: "The user was not found.",
  over_request_rate_limit: "Too many requests. Please wait a moment and try again.",
};

export const GENERIC_MESSAGE = "Something went wrong.";

/** Short, human-readable reference to find the log line (not a secret). */
export function newErrorRef(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function friendlyMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  const e = (err ?? {}) as ErrLike;
  const code = typeof e.code === "string" ? e.code : undefined;
  if (code && FRIENDLY_BY_CODE[code]) return FRIENDLY_BY_CODE[code];
  const msg = typeof e.message === "string" ? e.message : "";
  if (/row-level security|permission denied/i.test(msg)) return FRIENDLY_BY_CODE["42501"];
  if (/JWT expired|invalid JWT/i.test(msg)) return FRIENDLY_BY_CODE.PGRST301;
  return GENERIC_MESSAGE;
}

type Logger = (line: string) => void;
let logger: Logger = (line) => console.error(line);
/** Tests only. */
export function setErrorLogger(l: Logger) {
  const prev = logger;
  logger = l;
  return prev;
}

/** Logs the full error server-side and returns the ref. Never throws. */
export function logError(err: unknown, where: string, extra?: Record<string, unknown>): string {
  const ref = newErrorRef();
  const e = (err ?? {}) as ErrLike;
  try {
    logger(
      JSON.stringify({
        level: "error",
        ref,
        where,
        name: typeof e.name === "string" ? e.name : undefined,
        code: e.code,
        status: e.status,
        message: typeof e.message === "string" ? e.message : String(err),
        details: e.details,
        hint: e.hint,
        ...extra,
      }),
    );
  } catch {
    // logging must never throw
  }
  return ref;
}

/** Structured server-side audit line for admin-sensitive actions. Never throws. */
export function logAudit(where: string, event: Record<string, unknown>): void {
  try {
    logger(
      JSON.stringify({
        level: "audit",
        where,
        ...event,
      }),
    );
  } catch {
    // logging must never throw
  }
}

/**
 * Use in server code instead of `throw new Error(error.message)`:
 *   if (error) throw dbError(error, "customers.update");
 * Logs everything, returns an Error safe to send to the browser.
 */
export function dbError(err: unknown, where: string): Error {
  if (err instanceof AppError) return err;
  const ref = logError(err, where);
  const out = new AppError(`${friendlyMessage(err)} (ref ${ref})`, typeof (err as ErrLike)?.code === "string" ? ((err as ErrLike).code as string) : undefined);
  return out;
}

/**
 * For writes whose failure must not stop the user's action (for example audit rows),
 * but must not be silent either. Returns the ref when something was logged.
 */
export function logIfError(result: { error: unknown } | null | undefined, where: string): string | null {
  if (result && result.error) return logError(result.error, where);
  return null;
}
