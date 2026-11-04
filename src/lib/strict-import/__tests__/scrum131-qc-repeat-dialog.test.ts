// SCRUM-131 Eng QC S4: the approver (leadership, not admin) sees who acknowledged a repeat file, when, and which
// earlier batch/upload it repeats, on the sign-off screen and in the approve dialog. PGlite; synthetic data only.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createApprovalDb, submitAs, USERS } from "@/test-support/scrum131-db";
import { pgUntypedDb } from "@/test-support/pg-untyped-db";
import { syntheticCsv, syntheticRows } from "@/test-support/scrum129-fixture";
import { getApprovalStageDetail, listApprovalQueue } from "../approval-queries";
import { repeatLine } from "../approval-view";

describe("SCRUM-131 QC S4: repeat acknowledgement shown to the approver", () => {
  let db: PGlite;
  let firstId: string;
  let repeatId: string;
  beforeAll(async () => {
    db = await createApprovalDb();
    await db.query(
      "insert into public.profiles (id, email, full_name) values ($1, 'ops@example.test', 'Synthetic Uploader') on conflict (id) do update set full_name = excluded.full_name",
      [USERS.OPS],
    );
    const csv = syntheticCsv(
      syntheticRows(["AWS", "SAP"]).map((r, i) => ({ ...r, potentialId: `SYN131-S4-${i}` })),
    );
    firstId = (await submitAs(db, USERS.OPS, csv, "s4.csv")).stageId;
    repeatId = (await submitAs(db, USERS.OPS, csv, "s4-again.csv", { acknowledgeRepeatFile: true }))
      .stageId;
  }, 120_000);

  it("the detail gives the uploader's name; the dialog line says who, when and which upload it repeats", async () => {
    const d = await getApprovalStageDetail(pgUntypedDb(db, as(USERS.CHIEF)), USERS.CHIEF, repeatId);
    if (!d.ok) throw new Error(d.message);
    expect(d.uploaderName).toBe("Synthetic Uploader");
    const line = repeatLine(
      d.stage,
      d.uploaderName ? { [d.stage.uploaded_by]: d.uploaderName } : {},
    );
    expect(line).toContain(
      `Repeat of an upload already waiting for sign-off (${firstId.slice(0, 8)})`,
    );
    expect(line).toMatch(
      /acknowledged by the uploader \(Synthetic Uploader\) on \d{4}-\d{2}-\d{2} \d{2}:\d{2}\. Approving imports its rows again\.$/,
    );
  });

  it("the queue names come from import_stage_people (a leadership approver can read them)", async () => {
    const q = await listApprovalQueue(pgUntypedDb(db, as(USERS.CHIEF)), USERS.CHIEF, "pending");
    expect(q.names[USERS.OPS]).toBe("Synthetic Uploader");
  });

  it("import_stage_people shows names only for the caller's own stages unless they are an approver", async () => {
    const people = async (uid: string) =>
      (
        await pgUntypedDb(db, as(uid)).rpc<Record<string, string>>("import_stage_people", {
          p_stage_ids: [repeatId],
        })
      ).data;
    expect(await people(USERS.CHIEF)).toEqual({ [USERS.OPS]: "Synthetic Uploader" });
    expect(await people(USERS.OPS)).toEqual({ [USERS.OPS]: "Synthetic Uploader" });
    expect(await people(USERS.LEAD)).toEqual({});
    expect(
      (
        await pgUntypedDb(db, { role: "anon" }).rpc("import_stage_people", {
          p_stage_ids: [repeatId],
        })
      ).error?.code,
    ).toBe("42501");
  });
  it("a blank full name shows as 'Unknown user', never the email or id (Eng QC R2-N1)", async () => {
    await db.query("update public.profiles set full_name = '  ' where id = $1", [USERS.OPS]);
    try {
      const names = (
        await pgUntypedDb(db, as(USERS.CHIEF)).rpc<Record<string, string>>("import_stage_people", {
          p_stage_ids: [repeatId],
        })
      ).data;
      expect(names).toEqual({ [USERS.OPS]: "Unknown user" });
      expect(JSON.stringify(names)).not.toContain("@");
      await db.query("update public.profiles set full_name = null where id = $1", [USERS.OPS]);
      const again = (
        await pgUntypedDb(db, as(USERS.CHIEF)).rpc<Record<string, string>>("import_stage_people", {
          p_stage_ids: [repeatId],
        })
      ).data;
      expect(again).toEqual({ [USERS.OPS]: "Unknown user" });
    } finally {
      await db.query("update public.profiles set full_name = 'Synthetic Uploader' where id = $1", [
        USERS.OPS,
      ]);
    }
  });
});
