/**
 * Approval survives a crash. A store wrapper throws partway through publishing's writes, the way a
 * process dies mid-approval; a second Planner (a restarted server: its own lock, the same tables)
 * then serves the next request. The publish must complete, with every promise record written
 * exactly once and every farmer seeing the published date; approving again must be refused.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildRuntime } from "../src/server";
import { DEMO_CHC_ID } from "../src/demo/seed";
import { ConflictError, Planner } from "../src/domain/planner";
import { buildBoard, buildOneFarmerField } from "../src/domain/views";
import type { FieldRecord, VaariStore } from "../src/store/types";

/** The real store, except that write number `n` (counting promise and field writes) throws once. */
function crashingStore(inner: VaariStore) {
  let crashAt: number | null = null;
  let writes = 0;
  const store = new Proxy(inner, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      if (property !== "putPromise" && property !== "setFieldPlan") return value.bind(target);
      return async (...args: unknown[]) => {
        if (crashAt !== null && writes++ === crashAt) {
          crashAt = null;
          throw new Error("simulated crash");
        }
        return value.apply(target, args);
      };
    },
  });
  return {
    store,
    crashAtWrite(index: number) {
      crashAt = index;
      writes = 0;
    },
  };
}

let runtime: Awaited<ReturnType<typeof buildRuntime>>;
let crashing: ReturnType<typeof crashingStore>;
let doomed: Planner; // the server that dies mid-approval
let restarted: Planner; // the server that answers the next request
let booked: FieldRecord[];

beforeEach(async () => {
  runtime = await buildRuntime({ freshDemo: true });
  const { store, engine, config } = runtime.dependencies;
  crashing = crashingStore(store);
  doomed = new Planner(crashing.store, engine, config);
  restarted = new Planner(store, engine, config);
  const chc = (await store.getChc(DEMO_CHC_ID))!;
  booked = [];
  for (const [index, name] of ["Paramjit Kaur", "Baldev Singh", "Manjit Kaur"].entries()) {
    booked.push(
      await doomed.requestField(DEMO_CHC_ID, { farmerId: `farmer-crash-${index}`, farmerName: name, bookedBy: null, farmerPhone: null, consentAt: null, consentBy: null }, {
        villageId: chc.villageIds[index]!,
        acres: 1,
        readyDate: "2026-10-31",
        waitingLimitDays: 6,
      }),
    );
  }
});

async function crashApproval(crashAt: (writes: { promises: number; fields: number }) => number) {
  const { store } = runtime.dependencies;
  const draft = await doomed.generatePlan(DEMO_CHC_ID);
  // Size the crash point from the writes this approval will make (decided before any is written).
  const before = (await store.listPromises(DEMO_CHC_ID)).length;
  const promisedCount = draft.changes.promised.length + 2 * (draft.changes.firmed.length + draft.changes.rePromised.length);
  crashing.crashAtWrite(crashAt({ promises: promisedCount, fields: 0 }));
  await expect(doomed.approvePlan(DEMO_CHC_ID, draft.version, "Harpal Singh")).rejects.toThrow("simulated crash");
  const stuck = (await store.latestPlan(DEMO_CHC_ID))!;
  expect(stuck.status).toBe("publishing");
  return { draft, stuck, before };
}

async function expectFullyPublished(version: number) {
  const { store } = runtime.dependencies;
  const plan = (await store.latestApprovedPlan(DEMO_CHC_ID))!;
  expect(plan.version).toBe(version);
  // Every decided record is in the store exactly as decided (a repeat wrote the same record).
  const stored = new Map((await store.listPromises(DEMO_CHC_ID)).map((record) => [`${record.fieldId}#${record.version}`, record]));
  for (const record of plan.publish!.promises) expect(stored.get(`${record.fieldId}#${record.version}`)).toEqual(record);
  // No field holds two promises at once.
  for (const field of booked) {
    const held = [...stored.values()].filter((record) => record.fieldId === field.id && record.state === "held");
    expect(held).toHaveLength(1);
  }
  // Every field the plan covers is on its planned day.
  for (const update of plan.publish!.fields) {
    const field = (await store.getField(DEMO_CHC_ID, update.fieldId))!;
    expect({ plannedDay: field.plannedDay, plannedMachineId: field.plannedMachineId, state: field.state }).toEqual({
      plannedDay: update.plannedDay,
      plannedMachineId: update.plannedMachineId,
      state: update.state,
    });
  }
}

describe("approval after a crash", () => {
  it("a crash among the promise writes is finished by the next read; nothing is written twice", async () => {
    const { draft, before } = await crashApproval(() => 1); // dies on the second write
    const { store } = runtime.dependencies;
    expect((await store.listPromises(DEMO_CHC_ID)).length).toBe(before + 1); // half done

    // The restarted server's next read (the operator's board) finishes the publish first.
    const board = await buildBoard(restarted, store, DEMO_CHC_ID);
    expect(board.published?.version).toBe(draft.version);
    await expectFullyPublished(draft.version);
    // The farmer's link shows the date.
    const field = await buildOneFarmerField(restarted, store, (await store.getField(DEMO_CHC_ID, booked[0]!.id))!, "en");
    expect(["firm", "window"]).toContain(field.status);
    // Finishing again changes nothing, and the plan cannot be approved twice.
    await restarted.finishPendingPublish(DEMO_CHC_ID);
    await expectFullyPublished(draft.version);
    await expect(restarted.approvePlan(DEMO_CHC_ID, draft.version, "Harpal Singh")).rejects.toBeInstanceOf(ConflictError);
  });

  it("a crash among the field writes is finished before the next change is made", async () => {
    const { draft } = await crashApproval(({ promises }) => promises); // dies on the first field write
    // The next change (a fresh plan) first completes the interrupted publish, then drafts on top of it.
    const next = await restarted.generatePlan(DEMO_CHC_ID);
    expect(next.version).toBe(draft.version + 1);
    expect(next.status).toBe("draft");
    await expectFullyPublished(draft.version);
    // The new draft started from the published promises: none of the booked fields is new again.
    for (const field of booked) expect(next.changes.promised.map((item) => item.fieldId)).not.toContain(field.id);
  });
});
