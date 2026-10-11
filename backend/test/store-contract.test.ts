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
    farmerPhone: null, consentAt: null, consentBy: null, linkVersion: 1, soonerRequestedAt: null, ...overrides,
  };
}

function plan(chcId: string, version: number, planDate = "2026-11-01"): PlanRecord {
  return {
    chcId, planDay: 31, planDate, version, status: "draft", createdAt: new Date().toISOString(), approvedAt: null, approvedBy: null,
    solve: emptySolve, cause: "generate", causeMachineId: null, pins: [{ fieldId: "f1", machineId: "m1", day: 31 }],
    changes: { promised: [{ fieldId: "f1", promise: { kind: "firm", day: 31 } }], firmed: [], moved: [], broken: [], rePromised: [], unplaced: [] },
    publish: null, executionArn: null,
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

    it("keeps one season clock, never listed as a centre, and deletes a machine", async () => {
      const before = await store.getSeasonDayOffset();
      await store.setSeasonDayOffset(before + 3);
      expect(await store.getSeasonDayOffset()).toBe(before + 3);
      expect((await store.listChcs()).every((chc) => chc.id.startsWith("chc-"))).toBe(true);
      await store.setSeasonDayOffset(before);
      await store.putMachine({ chcId, id: "m-gone", name: "Gone", kind: "happy_seeder", hoursPerDay: 8, downDays: [] });
      await store.deleteMachine(chcId, "m-gone");
      expect((await store.listMachines(chcId)).map((machine) => machine.id)).not.toContain("m-gone");
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

    it("finds every field booked with one phone through phone-index, in any CHC, oldest first", async () => {
      // A per-run phone (E.164) from Ofcom's range reserved for fiction (+44 7700 900000-900999),
      // so DynamoDB runs rarely share one and no test number can belong to a real person.
      const phone = `+447700900${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
      const otherChc = `${chcId}-other`;
      await store.putField(field(chcId, "ph2", { farmerPhone: phone, createdAt: "2026-10-09T10:00:00.000Z" }));
      await store.putField(field(otherChc, "ph1", { farmerPhone: phone, createdAt: "2025-10-20T10:00:00.000Z" }));
      await store.putField(field(chcId, "ph3", { farmerPhone: phone === "+447700900999" ? "+447700900998" : "+447700900999" }));
      const found = await store.listFieldsByPhone(phone);
      expect(found.map((item) => `${item.chcId}/${item.id}`)).toEqual([`${otherChc}/ph1`, `${chcId}/ph2`]);
      // A field without a phone round-trips with null (absent from the index in DynamoDB).
      expect((await store.getField(chcId, "f1"))?.farmerPhone).toBeNull();
      await store.clearChcData(otherChc);
    });

    it("bumps a field's link version, and not for a missing field", async () => {
      await store.putField(field(chcId, "lv1"));
      expect((await store.bumpLinkVersion(chcId, "lv1"))?.linkVersion).toBe(2);
      expect((await store.bumpLinkVersion(chcId, "lv1"))?.linkVersion).toBe(3);
      expect((await store.getField(chcId, "lv1"))?.linkVersion).toBe(3);
      expect(await store.bumpLinkVersion(chcId, "missing")).toBeNull();
    });

    it("uses a login token once, and never an unknown one", async () => {
      const jti = `jti-${run}`;
      await store.putLoginToken({ jti, phone: "+447700900017", expiresAt: "2026-10-31T00:15:00.000Z", usedAt: null });
      expect(await store.useLoginToken(jti, "2026-10-31T00:01:00.000Z")).toMatchObject({ jti, phone: "+447700900017", usedAt: "2026-10-31T00:01:00.000Z" });
      expect(await store.useLoginToken(jti, "2026-10-31T00:02:00.000Z")).toBeNull();
      expect(await store.useLoginToken(`never-${run}`, "2026-10-31T00:02:00.000Z")).toBeNull();
    });

    it("creates a farmer account once per phone and keeps the first", async () => {
      const phone = `+447700900${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
      const account = { phone, farmerId: `farmer-${run}`, name: "Paramjit Kaur", language: "pa" as const, consentAt: "2026-10-31T10:00:00.000Z", consentBy: "farmer", createdAt: "2026-10-31T10:00:00.000Z" };
      expect(await store.getFarmerAccount(phone)).toBeNull();
      expect(await store.createFarmerAccount(account)).toEqual(account);
      expect(await store.createFarmerAccount({ ...account, farmerId: "someone-else", name: "Other" })).toEqual(account);
      expect(await store.getFarmerAccount(phone)).toEqual(account);
    });

    it("keeps one sign-in code per phone: counts each try once, and deletes only the right code", async () => {
      const phone = `+447700900${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
      const challenge = { phone, codeHash: `hash-${run}`, language: "en" as const, sentAt: "2026-10-31T10:00:00.000Z", expiresAt: "2099-10-31T10:10:00.000Z", attempts: 0 };
      await store.putOtpChallenge({ ...challenge, codeHash: "an-older-code" });
      await store.putOtpChallenge(challenge);
      expect(await store.getOtpChallenge(phone)).toEqual(challenge);
      expect(await store.countOtpAttempt(phone, 0)).toBe(true);
      // A second try that read the same count loses the race.
      expect(await store.countOtpAttempt(phone, 0)).toBe(false);
      expect((await store.getOtpChallenge(phone))?.attempts).toBe(1);
      expect(await store.deleteOtpChallenge(phone, "an-older-code")).toBe(false);
      expect(await store.deleteOtpChallenge(phone, challenge.codeHash)).toBe(true);
      expect(await store.deleteOtpChallenge(phone, challenge.codeHash)).toBe(false);
      expect(await store.getOtpChallenge(phone)).toBeNull();
      expect(await store.countOtpAttempt(phone, 1)).toBe(false);
    });

    it("claims a WhatsApp message id once, until its claim expires", async () => {
      const id = `wamid.contract-${run}`;
      expect(await store.claimInboundMessage(id, "2026-10-31T10:00:00.000Z", "2026-11-03T10:00:00.000Z")).toBe(true);
      expect(await store.claimInboundMessage(id, "2026-10-31T10:05:00.000Z", "2026-11-03T10:05:00.000Z")).toBe(false);
      // After the TTL (DynamoDB may not have deleted it yet), the id counts as new.
      expect(await store.claimInboundMessage(id, "2026-11-04T10:00:00.000Z", "2026-11-07T10:00:00.000Z")).toBe(true);
    });

    it("uses a WhatsApp draft once, only from its phone, only before it expires", async () => {
      const draft = { draftId: `draft-${run}`, phone: "+447700900017", chcId, fieldId: "f1", waitingLimitDays: 3, createdAt: "2026-10-31T10:00:00.000Z", expiresAt: "2026-10-31T10:15:00.000Z", usedAt: null };
      await store.putWhatsAppDraft(draft);
      expect(await store.useWhatsAppDraft(draft.draftId, "+447700900018", "2026-10-31T10:01:00.000Z")).toBeNull();
      expect(await store.useWhatsAppDraft(draft.draftId, draft.phone, "2026-10-31T10:16:00.000Z")).toBeNull();
      expect(await store.useWhatsAppDraft(draft.draftId, draft.phone, "2026-10-31T10:02:00.000Z")).toMatchObject({ draftId: draft.draftId, waitingLimitDays: 3, usedAt: "2026-10-31T10:02:00.000Z" });
      expect(await store.useWhatsAppDraft(draft.draftId, draft.phone, "2026-10-31T10:03:00.000Z")).toBeNull();
      expect(await store.useWhatsAppDraft(`missing-${run}`, draft.phone, "2026-10-31T10:03:00.000Z")).toBeNull();
    });

    it("records an outbound notice and moves its delivery status forward only", async () => {
      const messageId = `wamid.out-${run}`;
      await store.putOutboundNotice({ messageId, phoneLast4: "0017", kind: "new_date", chcId, fieldId: "f1", sentAt: "2026-10-31T10:00:00.000Z", status: "accepted", statusAt: "2026-10-31T10:00:00.000Z", error: null });
      expect(await store.setNoticeStatus(messageId, "delivered", "2026-10-31T10:01:00.000Z", null)).toBe(true);
      expect(await store.setNoticeStatus(messageId, "sent", "2026-10-31T10:00:30.000Z", null)).toBe(false);
      expect(await store.setNoticeStatus(`wamid.unknown-${run}`, "read", "2026-10-31T10:02:00.000Z", null)).toBe(false);
      expect(await store.getOutboundNotice(messageId)).toMatchObject({ status: "delivered", statusAt: "2026-10-31T10:01:00.000Z" });
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

    it("publishes a draft in two steps: begins exactly once, completes safely more than once", async () => {
      const writes = { promises: [{ chcId, fieldId: "f1", version: 1, promise: { kind: "firm" as const, day: 31 }, state: "held" as const, at: "x", reason: "first_promise" as const }], fields: [] };
      const approval = { approvedBy: "Harpal", approvedAt: "2026-10-31T12:00:00.000Z", changes: plan(chcId, 3).changes, publish: writes };
      expect(await store.latestApprovedPlan(chcId)).toBeNull();
      // Completing a draft that never began publishing is refused.
      await expect(store.completePublish(chcId, "2026-11-02", 3)).rejects.toBeInstanceOf(StoreConflictError);

      const publishing = await store.beginPublish(chcId, "2026-11-02", 3, approval);
      expect(publishing).toMatchObject({ status: "publishing", approvedBy: "Harpal", publish: writes, pins: plan(chcId, 3).pins });
      // Only one approval ever starts, and a missing version cannot start one.
      await expect(store.beginPublish(chcId, "2026-11-02", 3, approval)).rejects.toBeInstanceOf(StoreConflictError);
      await expect(store.beginPublish(chcId, "2026-11-02", 99, approval)).rejects.toBeInstanceOf(StoreConflictError);
      // Publishing is not published yet.
      expect(await store.latestApprovedPlan(chcId)).toBeNull();
      expect((await store.latestPlan(chcId))?.status).toBe("publishing");

      expect((await store.completePublish(chcId, "2026-11-02", 3)).status).toBe("approved");
      // A crash-recovery run may complete it again: nothing changes, nothing fails.
      expect(await store.completePublish(chcId, "2026-11-02", 3)).toMatchObject({ status: "approved", version: 3, publish: writes });

      // A newer draft does not hide the published plan.
      await store.createPlan(plan(chcId, 4, "2026-11-02"));
      expect((await store.latestPlan(chcId))?.status).toBe("draft");
      expect((await store.latestApprovedPlan(chcId))?.version).toBe(3);
    });

    it("sets a field's place in the plan, safely repeated, and leaves sown or missing fields alone", async () => {
      await store.putField(field(chcId, "p1", { soonerRequestedAt: "2026-10-31T08:00:00.000Z" }));
      const update = { fieldId: "p1", plannedDay: 33, plannedMachineId: "m1", state: "promised" as const };
      await store.setFieldPlan(chcId, update);
      await store.setFieldPlan(chcId, update);
      expect(await store.getField(chcId, "p1")).toEqual(field(chcId, "p1", { plannedDay: 33, plannedMachineId: "m1", state: "promised", soonerRequestedAt: null }));

      await store.putField(field(chcId, "p2", { state: "done", plannedDay: 31 }));
      await store.setFieldPlan(chcId, { ...update, fieldId: "p2" });
      expect((await store.getField(chcId, "p2"))?.state).toBe("done");
      await store.setFieldPlan(chcId, { ...update, fieldId: "missing" });
      expect(await store.getField(chcId, "missing")).toBeNull();
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
      const facilitator = `user-facilitator-${run}`;
      const officer = `user-officer-${run}`;
      userIds.push(operator, facilitator, officer);
      await store.putUser({ userId: operator, name: "O", role: "operator", chcId, language: "en" });
      await store.putUser({ userId: facilitator, name: "G", role: "facilitator", chcId, language: "pa" });
      await store.putUser({ userId: officer, name: "D", role: "officer", chcId: null, language: "en" });
      expect(await store.getUser(officer)).toEqual({ userId: officer, name: "D", role: "officer", chcId: null, language: "en" });
      expect((await store.listUsersByChc(chcId)).map((user) => user.role)).toEqual(["facilitator", "operator"]);
      await store.putFarmer({ id: `farmer-${run}`, name: "F", phone: "+447700900017", language: "pa", facilitatorId: facilitator });
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
