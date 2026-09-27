import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppError, dbError, friendlyMessage, logIfError, setErrorLogger, GENERIC_MESSAGE } from "../app-error";

let lines: string[] = [];
let prev: (l: string) => void;
beforeEach(() => {
  lines = [];
  prev = setErrorLogger((l) => lines.push(l));
});
afterEach(() => {
  setErrorLogger(prev);
});

const pgUnique = { code: "23505", message: 'duplicate key value violates unique constraint "customers_customer_name_key"', details: "Key (customer_name)=(Synthetic Co) already exists.", hint: null };

describe("dbError", () => {
  it("hides table/constraint names from the user and logs them with a ref", () => {
    const e = dbError(pgUnique, "customers.create");
    expect(e.message).toMatch(/^This record already exists\. \(ref [0-9A-F]{8}\)$/);
    expect(e.message).not.toContain("customers_customer_name_key");
    expect(lines).toHaveLength(1);
    const log = JSON.parse(lines[0]);
    expect(log).toMatchObject({ level: "error", where: "customers.create", code: "23505", details: "Key (customer_name)=(Synthetic Co) already exists." });
    expect(log.message).toContain("customers_customer_name_key");
    expect(e.message).toContain(log.ref);
  });

  it("unknown errors get a generic message, never the raw text", () => {
    const e = dbError({ message: 'relation "public.secret_table" does not exist', code: "42P01" }, "x");
    expect(e.message.startsWith(GENERIC_MESSAGE)).toBe(true);
    expect(e.message).not.toContain("secret_table");
  });

  it("RLS / permission errors map to a permission message", () => {
    expect(friendlyMessage({ message: 'new row violates row-level security policy for table "transactions"' })).toBe("You do not have permission to do that.");
    expect(friendlyMessage({ code: "42501", message: "permission denied for table x" })).toBe("You do not have permission to do that.");
  });

  it("Supabase Auth codes map to readable messages", () => {
    expect(friendlyMessage({ name: "AuthApiError", code: "email_exists", status: 422, message: "A user with this email address has already been registered" })).toBe("A user with this email already exists.");
  });

  it("AppError passes through unchanged and is not logged", () => {
    const mine = new AppError("That role is already assigned to this user.");
    expect(dbError(mine, "x")).toBe(mine);
    expect(lines).toHaveLength(0);
  });

  it("handles non-object errors", () => {
    expect(dbError("boom", "x").message.startsWith(GENERIC_MESSAGE)).toBe(true);
    expect(JSON.parse(lines[0]).message).toBe("boom");
  });
});

describe("logIfError", () => {
  it("logs failed writes without throwing", () => {
    expect(logIfError({ error: { message: "insert failed", code: "23502" } }, "mcp.audit")).toMatch(/^[0-9A-F]{8}$/);
    expect(JSON.parse(lines[0]).where).toBe("mcp.audit");
  });
  it("does nothing on success", () => {
    expect(logIfError({ error: null }, "x")).toBeNull();
    expect(logIfError(undefined, "x")).toBeNull();
    expect(lines).toHaveLength(0);
  });
});
