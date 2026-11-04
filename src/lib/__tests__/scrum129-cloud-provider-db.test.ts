// SCRUM-129: DB-level tests for 20261006061000_scrum129_cloud_provider_rules.sql and
// 20261006061100_scrum129_settings_provider_list.sql, on the in-process PGlite database with
// every migration applied. Synthetic data only; never touches sandbox or live.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asActor, createLocalDb, outcome } from "@/test-support/local-db";
import { ownerShapedProviders, syntheticRows, syntheticRpcRows } from "@/test-support/scrum129-fixture";
import { ACTIVE_ALIAS_ENTRIES, CANONICAL_PROVIDERS, NEVER_ALIASES, normalizeProvider } from "@/lib/cloud-provider";

const U = {
  admin: "00000000-0000-4000-8000-000000000001",
  ops: "00000000-0000-4000-8000-000000000003",
  viewer: "00000000-0000-4000-8000-000000000007",
} as const;
const as = (userId: string) => ({ role: "authenticated" as const, userId });
const sha = (c: string) => c.repeat(64);

const PRIVATE = ["MakeMyLabs Private Cloud", "Oracle", "SAP"];
const PUBLIC = ["AWS", "Azure", "GCP"];

/** Approved spellings -> [canonical, cloud type]. Owner rule 4 + Eng lead canonical decision 06:07. */
const ACCEPTED: Array<[string, string, "private_cloud" | "public_cloud"]> = [
  ["MakeMyLabs Private Cloud", "MakeMyLabs Private Cloud", "private_cloud"],
  ["makemylabs private cloud", "MakeMyLabs Private Cloud", "private_cloud"],
  ["  MAKEMYLABS   PRIVATE\u00a0CLOUD ", "MakeMyLabs Private Cloud", "private_cloud"],
  ["MakeMyLabs", "MakeMyLabs Private Cloud", "private_cloud"],
  [" makemylabs ", "MakeMyLabs Private Cloud", "private_cloud"],
  ["Oracle", "Oracle", "private_cloud"],
  ["ORACLE", "Oracle", "private_cloud"],
  ["Oracle Cloud", "Oracle", "private_cloud"],
  ["oracle  cloud", "Oracle", "private_cloud"],
  ["OCI", "Oracle", "private_cloud"],
  ["oci ", "Oracle", "private_cloud"],
  ["SAP", "SAP", "private_cloud"],
  ["sap", "SAP", "private_cloud"],
  ["AWS", "AWS", "public_cloud"],
  ["aws", "AWS", "public_cloud"],
  ["Amazon Web Services", "AWS", "public_cloud"],
  ["Azure", "Azure", "public_cloud"],
  ["Microsoft Azure", "Azure", "public_cloud"],
  ["GCP", "GCP", "public_cloud"],
  ["Google Cloud", "GCP", "public_cloud"],
  ["google cloud platform", "GCP", "public_cloud"],
];
/** Not providers: must find no rule (callers then block). */
const REJECTED: Array<string | null> = [
  null, "", "   ", "\u00a0", "IBM", "Hybrid", "OpenAI", "Private", "Private cloud", "public_cloud",
  "Alibaba Cloud", "Amazon", "Google", "Microsoft", "On-prem", "N/A", "SAP Ariba", "Oracle Fusion",
];

let db: PGlite;

beforeAll(async () => {
  db = await createLocalDb();
  await db.query("insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'o@example.test'), ($3, 'v@example.test')", [
    U.admin,
    U.ops,
    U.viewer,
  ]);
  await db.exec("delete from public.user_roles");
  await db.query(
    "insert into public.user_roles (user_id, role) values ($1, 'admin'::app_role), ($2, 'ops_user'::app_role), ($3, 'viewer'::app_role)",
    [U.admin, U.ops, U.viewer],
  );
}, 120_000);

async function rule(q: PGlite, v: string | null) {
  const r = await q.query<{ provider: string; cloud_type: string }>("select provider, cloud_type from public.cloud_provider_rule($1)", [v]);
  return r.rows[0] ?? null;
}

let sp = 0;
/** Runs one statement inside a savepoint so a failure does not abort the surrounding test transaction. */
async function errorOf(q: PGlite, run: () => Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  const name = `sp_${++sp}`;
  await q.exec(`savepoint ${name}`);
  try {
    await run();
    await q.exec(`release savepoint ${name}`);
    return null;
  } catch (e) {
    await q.exec(`rollback to savepoint ${name}`);
    return { code: (e as { code?: string }).code, message: (e as Error).message };
  }
}
async function codeOf(q: PGlite, run: () => Promise<unknown>): Promise<string> {
  const e = await errorOf(q, run);
  return e === null ? "ok" : (e.code ?? e.message);
}

function importAs(q: PGlite, kind: string | null, rows: unknown[], hash: string) {
  return q.query<{ r: Record<string, unknown> }>(
    "select public.import_transactions_batch($1, 'synthetic.csv', $2, '2.0.0-proposed', $3::jsonb, '[]'::jsonb) r",
    [kind, hash, JSON.stringify(rows)],
  );
}

describe("lookup tables and rule function", () => {
  it("holds exactly the six canonical providers: three private, three public", async () => {
    const r = await db.query<{ provider: string; cloud_type: string }>("select provider, cloud_type from public.cloud_providers order by sort_order");
    expect(r.rows).toEqual([
      ...PRIVATE.map((provider) => ({ provider, cloud_type: "private_cloud" })),
      ...PUBLIC.map((provider) => ({ provider, cloud_type: "public_cloud" })),
    ]);
  });

  it.each(ACCEPTED)("maps %j to %s (%s)", async (input, provider, cloudType) => {
    expect(await rule(db, input)).toEqual({ provider, cloud_type: cloudType });
  });

  it.each(REJECTED)("finds no rule for %j (blocking, never defaulted)", async (input) => {
    expect(await rule(db, input)).toBeNull();
    const t = await db.query<{ t: string | null }>("select public.cloud_type_for_provider($1) t", [input]);
    expect(t.rows[0].t).toBeNull();
  });

  it("public_cloud only ever comes from AWS, Azure or GCP (every key in both tables)", async () => {
    const r = await db.query<{ key: string; provider: string; cloud_type: string }>(
      `select k.key, r.provider, r.cloud_type
         from (select provider as key from public.cloud_providers union all select alias_key from public.cloud_provider_aliases) k,
              lateral public.cloud_provider_rule(k.key) r`,
    );
    const aliasCount = (await db.query<{ n: number }>("select count(*)::int n from public.cloud_provider_aliases")).rows[0].n;
    expect(r.rows.length).toBe(6 + aliasCount);
    for (const row of r.rows) {
      expect(row.cloud_type === "public_cloud").toBe(PUBLIC.includes(row.provider));
    }
  });

  it("parity: the DB rule gives the same answer as the shared TS module (normalizeProvider)", async () => {
    const probes = new Set<string>([...CANONICAL_PROVIDERS, ...NEVER_ALIASES, ...REJECTED.filter((x): x is string => x !== null)]);
    for (const [alias] of ACTIVE_ALIAS_ENTRIES) {
      probes.add(alias);
      probes.add(alias.toUpperCase());
      probes.add(`  ${alias.toLowerCase().replace(/ /g, "   ")}\u00a0`);
    }
    const mismatches: string[] = [];
    for (const p of probes) {
      const ts = normalizeProvider(p);
      const dbr = await rule(db, p);
      const tsView = ts.ok ? { provider: ts.provider, cloud_type: ts.cloudType } : null;
      if (JSON.stringify(tsView) !== JSON.stringify(dbr)) mismatches.push(`${JSON.stringify(p)}: ts=${JSON.stringify(tsView)} db=${JSON.stringify(dbr)}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("parity: every DB alias is an active TS alias for the same provider, and vice versa", async () => {
    const r = await db.query<{ alias_key: string; provider: string }>(
      "select a.alias_key, p.provider from public.cloud_provider_aliases a join public.cloud_providers p using (code) order by 1",
    );
    const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
    const canon = new Set(CANONICAL_PROVIDERS.map(key));
    const ts = new Map<string, string>();
    for (const [alias, provider] of ACTIVE_ALIAS_ENTRIES) if (!canon.has(key(alias))) ts.set(key(alias), provider);
    expect(Object.fromEntries(r.rows.map((x) => [x.alias_key, x.provider]))).toEqual(Object.fromEntries([...ts].sort()));
  });

  it("SAP and Oracle are private", async () => {
    expect((await rule(db, "SAP"))?.cloud_type).toBe("private_cloud");
    expect((await rule(db, "Oracle"))?.cloud_type).toBe("private_cloud");
  });

  it("the normaliser is IMMUTABLE and the lookup is STABLE (it reads the tables)", async () => {
    const r = await db.query<{ proname: string; provolatile: string }>(
      "select proname, provolatile from pg_proc where proname in ('cloud_provider_key', 'cloud_provider_rule') order by proname",
    );
    expect(r.rows).toEqual([
      { proname: "cloud_provider_key", provolatile: "i" },
      { proname: "cloud_provider_rule", provolatile: "s" },
    ]);
  });

  it("anon cannot read the tables or run the rule; a viewer can read the provider list", async () => {
    expect(await asActor(db, { role: "anon" }, (q) => outcome(q.query("select * from public.cloud_providers")))).toBe("42501");
    expect(await asActor(db, { role: "anon" }, (q) => outcome(q.query("select public.cloud_provider_rule('AWS')")))).toBe("42501");
    const n = await asActor(db, as(U.viewer), async (q) => (await q.query<{ n: number }>("select count(*)::int n from public.cloud_providers")).rows[0].n);
    expect(n).toBe(6);
    expect(await asActor(db, as(U.admin), (q) => outcome(q.query("insert into public.cloud_provider_aliases (alias_key, code, approved_note) values ('ibm', 'aws', 'x')")))).toBe("42501");
  });

  it("no cloud-type column has a DEFAULT", async () => {
    const r = await db.query<{ c: string }>(
      `select table_name || '.' || column_name c from information_schema.columns
        where table_schema = 'public' and column_default is not null
          and column_name in ('lab_type', 'repository_type', 'cloud_provider', 'kind', 'cloud_type')
          and table_name in ('transactions', 'import_batches', 'bulk_import_runs', 'lab_batches', 'lab_catalog', 'cloud_providers')`,
    );
    expect(r.rows).toEqual([]);
  });
});

describe("settings provider list (config_master)", () => {
  it("offers exactly the six canonical providers, in order", async () => {
    const r = await db.query<{ key: string }>(
      "select key from public.config_master where category = 'cloud_provider' and is_active order by sort_order",
    );
    expect(r.rows.map((x) => x.key)).toEqual([...PRIVATE, ...PUBLIC]);
  });
  it("uses the agreed cloud-type labels", async () => {
    const r = await db.query<{ key: string; label: string }>("select key, label from public.config_master where category = 'lab_type' order by sort_order");
    expect(r.rows).toEqual([
      { key: "public_cloud", label: "Public cloud" },
      { key: "private_cloud", label: "Private cloud" },
    ]);
  });
});

// SCRUM-131: clients can no longer EXECUTE import_transactions_batch; approve_import (SECURITY DEFINER)
// calls it after sign-off. These tests exercise its body the way that internal caller does: the owner
// role with the user's JWT claims (so auth.uid() and the in-function role check still apply). Rolled back.
async function asInternal<T>(db: PGlite, userId: string, fn: (q: PGlite) => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    return await fn(db);
  } finally {
    await db.exec("rollback");
  }
}

describe("import_transactions_batch", () => {
  it("imports the owner-shaped synthetic file in one go: 336 private, 6 public, 0 blanked", async () => {
    const got = await asInternal(db, U.ops, async (q) => {
      const res = await importAs(q, "mixed", syntheticRpcRows(), sha("1"));
      const split = await q.query<{ lab_type: string; repository_type: string; cloud_provider: string | null; n: number }>(
        `select lab_type, repository_type, cloud_provider, count(*)::int n from public.transactions t
          join public.import_batches b on b.id = t.import_batch_id where b.file_sha256 = $1
          group by 1, 2, 3 order by 1, 3`,
        [sha("1")],
      );
      const batch = await q.query<{ kind: string; row_count: number }>("select kind, row_count from public.import_batches where file_sha256 = $1", [sha("1")]);
      return { res: res.rows[0].r, split: split.rows, batch: batch.rows[0] };
    });
    expect(got.res).toMatchObject({ kind: "mixed", inserted: 342, private_rows: 336, public_rows: 6 });
    expect(got.batch).toEqual({ kind: "mixed", row_count: 342 });
    expect(got.split).toEqual([
      { lab_type: "private_cloud", repository_type: "private_cloud", cloud_provider: "MakeMyLabs Private Cloud", n: 334 },
      { lab_type: "private_cloud", repository_type: "private_cloud", cloud_provider: "Oracle", n: 2 },
      { lab_type: "public_cloud", repository_type: "public_cloud", cloud_provider: "Azure", n: 6 },
    ]);
  });

  it("stores aliases canonically and SAP as private", async () => {
    const rows = syntheticRpcRows(syntheticRows(["makemylabs", "OCI", "Oracle Cloud", "SAP", "sap "]));
    const got = await asInternal(db, U.ops, async (q) => {
      const res = await importAs(q, "private_cloud", rows, sha("2"));
      const t = await q.query<{ cloud_provider: string; lab_type: string }>(
        "select cloud_provider, lab_type from public.transactions where import_batch_id = $1 order by source_line",
        [res.rows[0].r.batch_id],
      );
      return t.rows;
    });
    expect(got).toEqual([
      { cloud_provider: "MakeMyLabs Private Cloud", lab_type: "private_cloud" },
      { cloud_provider: "Oracle", lab_type: "private_cloud" },
      { cloud_provider: "Oracle", lab_type: "private_cloud" },
      { cloud_provider: "SAP", lab_type: "private_cloud" },
      { cloud_provider: "SAP", lab_type: "private_cloud" },
    ]);
  });

  it.each([
    ["blank", ""],
    ["missing", null],
    ["unknown", "IBM"],
    ["hybrid", "Hybrid"],
  ])("a %s provider blocks the whole file with its line number, and writes nothing", async (_label, bad) => {
    const providers = [...ownerShapedProviders().slice(0, 10)];
    const rows = syntheticRpcRows(syntheticRows(providers)) as Array<Record<string, unknown>>;
    rows[4].cloud_provider = bad;
    const got = await asInternal(db, U.ops, async (q) => {
      const err = await errorOf(q, () => importAs(q, "private_cloud", rows, sha("3")));
      const n = await q.query<{ n: number }>("select count(*)::int n from public.import_batches where file_sha256 = $1", [sha("3")]);
      return { err, batches: n.rows[0].n };
    });
    expect(got.err?.code).toBe("22023");
    expect(got.err?.message).toContain("Line 6:");
    expect(got.batches).toBe(0);
  });

  it("refuses a file summary that does not match the rows, and never accepts NULL or 'hybrid'", async () => {
    const owner = syntheticRpcRows();
    const pub = syntheticRpcRows(syntheticRows(["AWS", "Azure"]));
    const codes = await asInternal(db, U.ops, async (q) => {
      const out: string[] = [];
      for (const [kind, rows] of [
        ["public_cloud", owner],
        ["private_cloud", owner],
        ["mixed", pub],
        [null, pub],
        ["hybrid", pub],
      ] as const) {
        out.push(await codeOf(q, () => importAs(q, kind, [...rows], sha("4"))));
      }
      return out;
    });
    expect(codes).toEqual(["22023", "22023", "22023", "22023", "22023"]);
  });

  it("refuses a row whose sent lab_type disagrees with its provider", async () => {
    const rows = syntheticRpcRows(syntheticRows(["Azure", "Azure"])).map((r, i) => ({ ...r, lab_type: i === 1 ? "private_cloud" : "public_cloud" }));
    const err = await asInternal(db, U.ops, (q) => errorOf(q, () => importAs(q, "public_cloud", rows, sha("5"))));
    expect(err?.code).toBe("22023");
    expect(err?.message).toContain("Line 3:");
  });

  it("stores system_config on private rows only", async () => {
    const rows = syntheticRpcRows(syntheticRows(["SAP", "AWS"])).map((r) => ({ ...r, system_config: "8GB 2vCPUs" }));
    const got = await asInternal(db, U.ops, async (q) => {
      const res = await importAs(q, "mixed", rows, sha("6"));
      return (
        await q.query<{ cloud_provider: string; system_config: string | null }>(
          "select cloud_provider, system_config from public.transactions where import_batch_id = $1 order by source_line",
          [res.rows[0].r.batch_id],
        )
      ).rows;
    });
    expect(got).toEqual([
      { cloud_provider: "SAP", system_config: "8GB 2vCPUs" },
      { cloud_provider: "AWS", system_config: null },
    ]);
  });

  it("a viewer still cannot import", async () => {
    expect(await asInternal(db, U.viewer, (q) => outcome(importAs(q, "public_cloud", syntheticRpcRows(syntheticRows(["AWS"])), sha("7"))))).toBe("42501");
  });

  it("SCRUM-131: no client can call it directly any more (only approve_import does, after sign-off)", async () => {
    for (const u of [U.ops, U.admin, U.viewer]) {
      expect(await asActor(db, as(u), (q) => outcome(importAs(q, "public_cloud", syntheticRpcRows(syntheticRows(["AWS"])), sha("8"))))).toBe("42501");
    }
  });
});

describe("classify_transaction guard (every write path)", () => {
  const LEGACY_NULL = "00000000-0000-4000-8000-0000000129a1";
  const LEGACY_OLD_SPELLING = "00000000-0000-4000-8000-0000000129a2";

  beforeAll(async () => {
    // Rows as they exist on live today: written before the guard (NULL provider, older spelling).
    await db.exec("alter table public.transactions disable trigger transactions_classify");
    await db.query(
      `insert into public.transactions (id, lab_name, lab_type, repository_type, cloud_provider, selling_cost, created_by)
       values ($1, 'Legacy Lab', 'public_cloud', 'public_cloud', NULL, 100, $3),
              ($2, 'Legacy Lab', 'private_cloud', 'private_cloud', 'MakeMyLabs', 100, $3)`,
      [LEGACY_NULL, LEGACY_OLD_SPELLING, U.admin],
    );
    await db.exec("alter table public.transactions enable trigger transactions_classify");
  });

  const insert = (q: PGlite, labType: string, provider: string | null) =>
    q.query<{ cloud_provider: string; repository_type: string }>(
      `insert into public.transactions (lab_name, lab_type, repository_type, cloud_provider, created_by)
       values ('Guard Lab', $1, $1, $2, $3) returning cloud_provider, repository_type`,
      [labType, provider, U.ops],
    );

  it("stores the canonical name on insert (Single Entry / AI CC / MCP path)", async () => {
    const got = await asActor(db, as(U.ops), async (q) => [
      (await insert(q, "private_cloud", "oci")).rows[0],
      (await insert(q, "private_cloud", "SAP")).rows[0],
      (await insert(q, "private_cloud", "MakeMyLabs")).rows[0],
      (await insert(q, "public_cloud", "Amazon Web Services")).rows[0],
    ]);
    expect(got).toEqual([
      { cloud_provider: "Oracle", repository_type: "private_cloud" },
      { cloud_provider: "SAP", repository_type: "private_cloud" },
      { cloud_provider: "MakeMyLabs Private Cloud", repository_type: "private_cloud" },
      { cloud_provider: "AWS", repository_type: "public_cloud" },
    ]);
  });

  it.each([
    ["public_cloud", "Oracle"],
    ["public_cloud", "SAP"],
    ["public_cloud", "MakeMyLabs Private Cloud"],
    ["private_cloud", "AWS"],
    ["private_cloud", null],
    ["public_cloud", null],
    ["public_cloud", "  "],
    ["public_cloud", "IBM"],
  ])("refuses %s with provider %j", async (labType, provider) => {
    expect(await asActor(db, as(U.ops), (q) => outcome(insert(q, labType, provider)))).toBe("22023");
  });

  it("keeps edits working on existing rows when neither provider nor type changes", async () => {
    const got = await asActor(db, as(U.admin), async (q) => {
      await q.query("update public.transactions set lab_name = 'Renamed Lab', is_deleted = false where id in ($1, $2)", [LEGACY_NULL, LEGACY_OLD_SPELLING]);
      return (
        await q.query<{ id: string; cloud_provider: string | null; lab_name: string }>(
          "select id, cloud_provider, lab_name from public.transactions where id in ($1, $2) order by id",
          [LEGACY_NULL, LEGACY_OLD_SPELLING],
        )
      ).rows;
    });
    expect(got).toEqual([
      { id: LEGACY_NULL, cloud_provider: null, lab_name: "Renamed Lab" },
      { id: LEGACY_OLD_SPELLING, cloud_provider: "MakeMyLabs", lab_name: "Renamed Lab" },
    ]);
  });

  it("checks updates that change provider or type (cleanup must set both together)", async () => {
    const results = await asActor(db, as(U.admin), async (q) => ({
      typeOnly: await codeOf(q, () => q.query("update public.transactions set lab_type = 'private_cloud' where id = $1", [LEGACY_NULL])),
      badProvider: await codeOf(q, () => q.query("update public.transactions set cloud_provider = 'IBM' where id = $1", [LEGACY_NULL])),
      both: (
        await q.query<{ cloud_provider: string; repository_type: string }>(
          "update public.transactions set lab_type = 'private_cloud', cloud_provider = 'MakeMyLabs Private Cloud' where id = $1 returning cloud_provider, repository_type",
          [LEGACY_NULL],
        )
      ).rows[0],
    }));
    expect(results).toEqual({
      typeOnly: "22023",
      badProvider: "22023",
      both: { cloud_provider: "MakeMyLabs Private Cloud", repository_type: "private_cloud" },
    });
  });
  it("re-checks a row restored from soft-delete (Eng QC B1)", async () => {
    const DELETED_NULL = "00000000-0000-4000-8000-0000000129a3";
    const DELETED_OK = "00000000-0000-4000-8000-0000000129a4";
    await db.exec("alter table public.transactions disable trigger transactions_classify");
    await db.query(
      `insert into public.transactions (id, lab_name, lab_type, repository_type, cloud_provider, selling_cost, is_deleted, created_by)
       values ($1, 'Deleted Lab', 'public_cloud', 'public_cloud', NULL, 100, true, $3),
              ($2, 'Deleted Lab', 'public_cloud', 'public_cloud', 'azure', 100, true, $3)`,
      [DELETED_NULL, DELETED_OK, U.admin],
    );
    await db.exec("alter table public.transactions enable trigger transactions_classify");
    const results = await asActor(db, as(U.admin), async (q) => ({
      restoreBlank: await codeOf(q, () => q.query("update public.transactions set is_deleted = false where id = $1", [DELETED_NULL])),
      restoreValid: (
        await q.query<{ cloud_provider: string; repository_type: string }>(
          "update public.transactions set is_deleted = false where id = $1 returning cloud_provider, repository_type",
          [DELETED_OK],
        )
      ).rows[0],
    }));
    expect(results).toEqual({
      restoreBlank: "22023",
      restoreValid: { cloud_provider: "Azure", repository_type: "public_cloud" },
    });
  });
});
