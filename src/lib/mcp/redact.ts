// SCRUM-77: what goes into the MCP audit log's `arguments` column.
// Tool inputs today are filters (dates, ids, names), but a future tool could receive a token or
// an amount. Keys that look sensitive are replaced, token-looking strings are replaced wherever
// they appear, long strings are capped, and nesting is limited.

export const REDACTED = "[redacted]";
const MAX_STRING = 500;
const MAX_DEPTH = 4;
const MAX_KEYS = 50;

/** Credentials and finance values. Matched against the key name, case-insensitive. */
const SENSITIVE_KEY =
  /(pass(word)?|secret|token|api[_-]?key|authori[sz]ation|cookie|session|jwt|bearer|private|credential|cost|price|revenue|amount|salary|profit|margin|iban|account[_-]?number|card)/i;

/** A JWT, a bearer header, or a long opaque key. */
const TOKEN_VALUE = /^(bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+|(sk|pk|rk|sb)_[\w-]{16,}|[A-Za-z0-9+/_-]{40,}={0,2})$/i;

export function redactArguments(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return redactObject(input as Record<string, unknown>, 0);
}

function redactObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (++n > MAX_KEYS) {
      out["…"] = "more keys omitted";
      break;
    }
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactValue(v, depth + 1);
  }
  return out;
}

function redactValue(v: unknown, depth: number): unknown {
  if (typeof v === "string") {
    if (TOKEN_VALUE.test(v.trim())) return REDACTED;
    return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
  }
  if (v === null || typeof v !== "object") return v;
  if (depth >= MAX_DEPTH) return "[nested]";
  if (Array.isArray(v)) return v.slice(0, MAX_KEYS).map((x) => redactValue(x, depth + 1));
  return redactObject(v as Record<string, unknown>, depth);
}
