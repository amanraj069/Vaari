/**
 * The fleet and the officer's loans, end to end across roles. An operator adds and removes the
 * centre's own machines (each makes a draft to approve; never the last machine, never one on loan).
 * The officer lends a machine from one centre to another for the plan's days: the lender's draft
 * never uses it on those days, the borrower's uses it only on them, the simulated centre's
 * simulated operator approves a draft that breaks no promise while the real operator approves their
 * own, "back from the workshop" never cancels a loan, ending it sends the machine home, and a demo
 * reset unwinds the demo centre's loans. Only officers arrange loans; only the operator manages
 * their own fleet.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { districtChcId } from "../src/demo/district";
import { DEMO_CHC_ID } from "../src/demo/seed";
import { borrowedMachineId } from "../src/domain/planner";
import { buildRuntime } from "../src/server";
import { officerOverviewSchema, operatorMachinesSchema } from "../src/shared";

let app: ReturnType<typeof createApp>;
let runtime: Awaited<ReturnType<typeof buildRuntime>>;
const tokens: Record<string, string> = {};
const as = (role: string) => ({ authorization: `Bearer ${tokens[role]}` });
const BORROWER = districtChcId(5);

beforeAll(async () => {
  runtime = await buildRuntime({ freshDemo: true, district: true });
  app = createApp(runtime.dependencies);
  for (const role of ["facilitator", "operator", "officer"]) tokens[role] = (await request(app).post("/auth/demo").send({ role }).expect(200)).body.accessToken;
}, 180_000);

describe("an operator's fleet", () => {
  it("adds a machine: it is listed, and a draft that can use it waits for approval", async () => {
    const before = operatorMachinesSchema.parse((await request(app).get("/operator/machines").set(as("operator")).expect(200)).body);
    const added = operatorMachinesSchema.parse((await request(app).post("/operator/machines").set(as("operator")).send({ name: "Rented Super Seeder", kind: "super_seeder" }).expect(201)).body);
    expect(added.machines).toHaveLength(before.machines.length + 1);
    const machine = added.machines.find((item) => item.name === "Rented Super Seeder")!;
    expect(machine.status).toBe("working");
    expect(machine.loan).toBeNull();
    expect(added.draftWaiting).toBe(true);
    const draft = await runtime.dependencies.planner.latestPlan(DEMO_CHC_ID);
    expect(draft).toMatchObject({ status: "draft", cause: "machine_added", causeMachineId: machine.id });
  });

  it("removes a machine of its own, but never the last one, and only the operator may", async () => {
    const list = operatorMachinesSchema.parse((await request(app).get("/operator/machines").set(as("operator")).expect(200)).body);
    const added = list.machines.find((item) => item.name === "Rented Super Seeder")!;
    for (const role of ["facilitator", "officer"]) expect((await request(app).delete(`/operator/machines/${added.id}`).set(as(role))).status).toBe(403);
    const after = operatorMachinesSchema.parse((await request(app).delete(`/operator/machines/${added.id}`).set(as("operator")).expect(200)).body);
    expect(after.machines.map((item) => item.id)).not.toContain(added.id);
    expect((await runtime.dependencies.planner.latestPlan(DEMO_CHC_ID))?.cause).toBe("machine_removed");
    expect((await request(app).post("/operator/machines").set(as("operator")).send({ name: "", kind: "super_seeder" })).status).toBe(400);
    // Approve the latest draft so the loans below start from a published plan.
    const draft = (await runtime.dependencies.planner.latestPlan(DEMO_CHC_ID))!;
    await request(app).post("/operator/plan/approve").set(as("operator")).send({ version: draft.version }).expect(200);
  });
});

describe("the officer's machine loans", () => {
  let loanId = "";

  it("is for officers only", async () => {
    for (const role of ["operator", "facilitator"]) expect((await request(app).post("/officer/loans").set(as(role)).send({ fromChcId: DEMO_CHC_ID, toChcId: BORROWER })).status).toBe(403);
    expect((await request(app).post("/officer/loans").set(as("officer")).send({ fromChcId: DEMO_CHC_ID, toChcId: DEMO_CHC_ID })).status).toBe(409);
  });

  it("lends a machine: the lender plans without it, the borrower with it only on the loan's days", async () => {
    const answer = await request(app).post("/officer/loans").set(as("officer")).send({ fromChcId: DEMO_CHC_ID, toChcId: BORROWER }).expect(201);
    loanId = answer.body.loanId;
    const { planner, store } = runtime.dependencies;
    const planDays = planner.planDays();
    const lent = (await store.listMachines(DEMO_CHC_ID)).find((machine) => machine.loan?.loanId === loanId)!;
    expect(lent.loan).toMatchObject({ direction: "out", otherChcId: BORROWER, startDay: planDays[0], endDay: planDays[planDays.length - 1] });

    // The demo centre has a real operator: its draft waits, and it never routes the lent machine.
    const lenderDraft = (await planner.latestPlan(DEMO_CHC_ID))!;
    expect(lenderDraft).toMatchObject({ status: "draft", cause: "loan_out", causeMachineId: lent.id });
    expect(lenderDraft.solve.routes.filter((route) => route.machineId === lent.id && planDays.includes(route.day) && route.stops.length > 0)).toEqual([]);

    // The simulated borrower's simulated operator approved a draft that breaks no promise.
    const borrowedId = borrowedMachineId(DEMO_CHC_ID, lent.id);
    const borrowed = (await store.listMachines(BORROWER)).find((machine) => machine.id === borrowedId)!;
    expect(borrowed.loan).toMatchObject({ direction: "in", otherChcId: DEMO_CHC_ID });
    const borrowerPlan = (await planner.latestPlan(BORROWER))!;
    expect(borrowerPlan.cause).toBe("loan_in");
    if (borrowerPlan.changes.broken.length === 0) expect(borrowerPlan.status).toBe("approved");
    for (const route of borrowerPlan.solve.routes.filter((item) => item.machineId === borrowedId && item.stops.length > 0)) expect(planDays).toContain(route.day);

    // The operator sees where the machine went; the officer sees the loan.
    const machines = operatorMachinesSchema.parse((await request(app).get("/operator/machines").set(as("operator")).expect(200)).body);
    expect(machines.machines.find((item) => item.id === lent.id)).toMatchObject({ status: "away", removable: false, loan: { direction: "out", centreName: (await store.getChc(BORROWER))!.name } });
    const overview = officerOverviewSchema.parse((await request(app).get("/officer/overview").set(as("officer")).expect(200)).body);
    expect(overview.outlook.loans).toEqual([expect.objectContaining({ id: loanId, fromChcId: DEMO_CHC_ID, toChcId: BORROWER, machineName: lent.name })]);
  });

  it("is not undone by 'back from the workshop', and a lent machine cannot be removed", async () => {
    const lentId = loanId.split("~")[1]!;
    await request(app).post(`/operator/machines/${lentId}/up`).set(as("operator")).send({}).expect(200);
    expect((await runtime.dependencies.store.listMachines(DEMO_CHC_ID)).find((machine) => machine.id === lentId)?.loan?.loanId).toBe(loanId);
    expect((await request(app).delete(`/operator/machines/${lentId}`).set(as("operator"))).status).toBe(409);
  });

  it("ends: the machine goes home, the borrower's copy is gone, both centres re-plan", async () => {
    for (const role of ["operator", "facilitator"]) expect((await request(app).delete(`/officer/loans/${encodeURIComponent(loanId)}`).set(as(role))).status).toBe(403);
    await request(app).delete(`/officer/loans/${encodeURIComponent(loanId)}`).set(as("officer")).expect(200);
    const { store, planner } = runtime.dependencies;
    expect((await store.listMachines(DEMO_CHC_ID)).some((machine) => machine.loan)).toBe(false);
    expect((await store.listMachines(BORROWER)).some((machine) => machine.loan)).toBe(false);
    expect((await planner.latestPlan(DEMO_CHC_ID))?.cause).toBe("loan_ended");
    expect((await request(app).delete(`/officer/loans/${encodeURIComponent(loanId)}`).set(as("officer"))).status).toBe(404);
  });

  it("lasts the days the officer chose, and the machine works at home again after them", async () => {
    const { planner, store } = runtime.dependencies;
    expect((await request(app).post("/officer/loans").set(as("officer")).send({ fromChcId: DEMO_CHC_ID, toChcId: BORROWER, days: 11 })).status).toBe(400);
    const answer = await request(app).post("/officer/loans").set(as("officer")).send({ fromChcId: DEMO_CHC_ID, toChcId: BORROWER, days: 3 }).expect(201);
    const lent = (await store.listMachines(DEMO_CHC_ID)).find((machine) => machine.loan?.loanId === answer.body.loanId)!;
    const tomorrow = planner.today() + 1;
    expect(lent.loan).toMatchObject({ startDay: tomorrow, endDay: tomorrow + 2 });
    // After the loan the lender's draft may use the machine again; during it, never.
    const draft = (await planner.latestPlan(DEMO_CHC_ID))!;
    expect(draft.solve.routes.filter((route) => route.machineId === lent.id && route.day <= tomorrow + 2 && route.stops.length > 0)).toEqual([]);
    const borrowedPlan = (await planner.latestPlan(BORROWER))!;
    for (const route of borrowedPlan.solve.routes.filter((item) => item.machineId === borrowedMachineId(DEMO_CHC_ID, lent.id) && item.stops.length > 0)) expect(route.day).toBeLessThanOrEqual(tomorrow + 2);
    await request(app).delete(`/officer/loans/${encodeURIComponent(answer.body.loanId)}`).set(as("officer")).expect(200);
  });

  it("is unwound by a demo reset, so no centre lends to a season that was wiped", async () => {
    await request(app).post("/officer/loans").set(as("officer")).send({ fromChcId: BORROWER, toChcId: DEMO_CHC_ID }).expect(201);
    await request(app).post("/operator/demo/reset").set(as("operator")).expect(200);
    const { store } = runtime.dependencies;
    expect((await store.listMachines(BORROWER)).some((machine) => machine.loan)).toBe(false);
    expect((await store.listMachines(DEMO_CHC_ID)).some((machine) => machine.loan)).toBe(false);
  });
});
