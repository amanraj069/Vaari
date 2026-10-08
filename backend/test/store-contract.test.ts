/**
 * One behaviour contract for every VaariStore. It always runs on the in-memory store, and also on
 * DynamoDB when REPO=dynamo and TABLE_PREFIX ends in "-test" (vitest.config.ts enforces the gate;
 * the global setup creates the tables). Each run uses its own CHC id and cleans up after itself.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDynamoClients } from "../src/store/dynamo/client";
import { DynamoStore } from "../src/store/dynamo/store";
import { MemoryStore } from "../src/store/memory";
import { StoreConflictError, type FieldRecord, type PlanRecord, type VaariStore } from "../src/store/types";
import type { SolveResponse } from "../src/shared";

const useDynamo = process.env.REPO === "dynamo" && (process.env.TABLE_PREFIX ?? "").endsWith("-test");

const stores: { name: string; make: () => VaariStore }[] = [{ name: "memory", make: () => new MemoryStore() }];
if (useDynamo) {
  stores.push({
    name: "dynamo",
    make: () => {
      const { documents } = createDynamoClients({ region: process.env.AWS_REGION!, endpoint: process.env.DYNAMODB_ENDPOINT });
      return new DynamoStore(documents, process.env.TABLE_PREFIX!);
    },
  });
}

const emptySolve = {
  planStartDay: 31,
  fieldDays: {},
  unservedFieldIds: [],
  assignments: [],
  routes: [],
  promises: [],
  queueDays: {},
  metrics: { fieldsTotal: 0, fieldsPlanned: 0, fieldsUnserved: 0, fieldsPastBurnDeadline: 0, promisesHeld: 0, promisesBroken: 0, wheatLossKg: 0, travelKm: 0, maxDelayVsQueueDays: 0, fieldsBeyondFairnessK: 0 },
  solver: { status: "optimal", mode: "normal", wallSeconds: 0, burnPassObjective: 0, costPassObjective: 0 },
} satisfies SolveResponse;

function field(chcId: string, id: string, overrides: Partial<FieldRecord> = {}): FieldRecord {
  return {
    chcId, id, token: 1, farmerId: "farmer-a", farmerName: "A", villageId: "v1", acres: 2, readyDay: 30, waitingLimitDays: 5,
    requestOrder: 0, createdAt: "2026-10-08T00:00:00.000Z", state: "waiting", plannedDay: null, plannedMachineId: null, bookedBy: null,
    ...overrides,
  };
}

function plan(chcId: string, version: number, planDate = "2026-11-01"): PlanRecord {
  return {
    chcId, planDay: 31, planDate, version, status: "proposed", createdAt: new Date().toISOString(), approvedAt: null, approvedBy: null,
    solve: emptySolve, firmingFieldIds: ["f1"], executionArn: null, lastReplan: null,
  };
}

for (const { name, make } of stores) {
  describe(`${name} store`, () => {
    const store = make();
    const run = randomUUID().slice(0, 8);
    const chcId = `chc-contract-${run}`;
    const userIds: string[] = [];

    afterAll(async () => {
      await store.clearChcData(chcId);
    });

    it("stores and reads a CHC, machines and fields by key", async () => {
      await store.putChc({ id: chcId, name: "Test CHC", baseVillageId: "v1", base: { lat: 30, lon: 75 }, villageIds: ["v1"], operatorPhone: "", settings: { fairnessKDays: 2 }, rainDays: [] });
      await store.putMachine({ chcId, id: "m1", name: "M1", kind: "super_seeder", hoursPerDay: 8, downDays: [32] });
      await store.putField(field(chcId, "f1"));
      await store.putField(field(chcId, "f2", { farmerId: "farmer-b" }));
      expect((await store.getChc(chcId))?.name).toBe("Test CHC");
      expect(await store.listMachines(chcId)).toEqual([{ chcId, id: "m1", name: "M1", kind: "super_seeder", hoursPerDay: 8, downDays: [32] }]);
      expect(await store.getField(chcId, "f1")).toEqual(field(chcId, "f1"));
      expect(await store.getField(chcId, "missing")).toBeNull();
      expect((await store.listFields(chcId)).map((item) => item.id)).toEqual(["f1", "f2"]);
      expect((await store.listFieldsByFarmer(chcId, "farmer-b")).map((item) => item.id)).toEqual(["f2"]);
    });

    it("lists a facilitator's bookings through booked-by-index, oldest first, and nobody else's", async () => {
      const facilitator = `facilitator-${run}`;
      await store.putField(field(chcId, "b2", { bookedBy: facilitator, createdAt: "2026-10-08T10:00:00.000Z" }));
      await store.putField(field(chcId, "b1", { bookedBy: facilitator, createdAt: "2026-10-08T09:00:00.000Z" }));
      await store.putField(field(chcId, "b3", { bookedBy: `someone-else-${run}` }));
      expect((await store.listFieldsBookedBy(facilitator)).map((item) => item.id)).toEqual(["b1", "b2"]);
      // A field with no booker round-trips with bookedBy null (the attribute is simply absent in DynamoDB).
      expect((await store.getField(chcId, "f1"))?.bookedBy).toBeNull();
    });

    it("keeps promise history in version order, including past version 9", async () => {
      for (const version of [10, 2, 1, 9]) {
        await store.putPromise({ chcId, fieldId: "f1", version, promise: { kind: "firm", day: 30 + version }, state: "replaced", at: "x", reason: "replan" });
      }
      await store.putPromise({ chcId, fieldId: "f2", version: 1, promise: null, state: "held", at: "x", reason: "first_promise" });
      expect((await store.promiseHistory(chcId, "f1")).map((record) => record.version)).toEqual([1, 2, 9, 10]);
      expect(await store.listPromises(chcId)).toHaveLength(5);
    });

    it("creates each plan version once and returns the latest", async () => {
      await store.createPlan(plan(chcId, 1));
      await store.createPlan(plan(chcId, 2));
      await expect(store.createPlan(plan(chcId, 2))).rejects.toBeInstanceOf(StoreConflictError);
      expect((await store.latestPlan(chcId))?.version).toBe(2);
      await store.createPlan(plan(chcId, 3, "2026-11-02"));
      expect((await store.latestPlan(chcId))?.planDate).toBe("2026-11-02");
    });

    it("approves a plan version exactly once (conditional write)", async () => {
      const approved = await store.approvePlan(chcId, "2026-11-02", 3, "Harpal", "2026-10-31T12:00:00.000Z");
      expect(approved).toMatchObject({ status: "approved", approvedBy: "Harpal", firmingFieldIds: [] });
      await expect(store.approvePlan(chcId, "2026-11-02", 3, "Harpal", "2026-10-31T12:01:00.000Z")).rejects.toBeInstanceOf(StoreConflictError);
      // A version that does not exist cannot be approved either.
      await expect(store.approvePlan(chcId, "2026-11-02", 99, "Harpal", "x")).rejects.toBeInstanceOf(StoreConflictError);
    });

    it("stores work logs and fire checks", async () => {
      await store.putWorkLog({ chcId, date: "2026-11-01", machineId: "m1", fieldId: "f1", acres: 5, hours: 7, loggedAt: "x" });
      expect(await store.listWorkLogs(chcId)).toEqual([{ chcId, date: "2026-11-01", machineId: "m1", fieldId: "f1", acres: 5, hours: 7, loggedAt: "x" }]);
      const fieldId = `field-${run}`;
      await store.putFireCheck({ fieldId, checkDate: "2026-11-05", chcId, result: "no_fire_seen", detections: 0, source: "VIIRS_NOAA20_NRT" });
      expect((await store.listFireChecks(fieldId)).map((check) => check.result)).toEqual(["no_fire_seen"]);
    });

    it("stores users (with and without a CHC) and lists a CHC's users by role", async () => {
      const operator = `user-op-${run}`;
      const farmer = `user-farmer-${run}`;
      const officer = `user-officer-${run}`;
      userIds.push(operator, farmer, officer);
      await store.putUser({ userId: operator, name: "O", role: "operator", chcId, farmerId: null, language: "en" });
      await store.putUser({ userId: farmer, name: "F", role: "farmer", chcId, farmerId: `farmer-${run}`, language: "pa" });
      await store.putUser({ userId: officer, name: "D", role: "officer", chcId: null, farmerId: null, language: "en" });
      expect(await store.getUser(officer)).toEqual({ userId: officer, name: "D", role: "officer", chcId: null, farmerId: null, language: "en" });
      expect((await store.listUsersByChc(chcId)).map((user) => user.role)).toEqual(["farmer", "operator"]);
      await store.putFarmer({ id: `farmer-${run}`, name: "F", phone: "", language: "pa", facilitatorId: null });
      expect((await store.getFarmer(`farmer-${run}`))?.name).toBe("F");
    });

    it("clearing a CHC removes its season data but keeps users", async () => {
      await store.clearChcData(chcId);
      expect(await store.listFields(chcId)).toEqual([]);
      expect(await store.listPromises(chcId)).toEqual([]);
      expect(await store.latestPlan(chcId)).toBeNull();
      expect(await store.listMachines(chcId)).toEqual([]);
      expect(await store.listWorkLogs(chcId)).toEqual([]);
      expect(await store.getUser(userIds[0]!)).not.toBeNull();
    });
  });
}
