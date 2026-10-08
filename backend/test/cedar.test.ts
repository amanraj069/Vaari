import { describe, expect, it } from "vitest";
import { authorize } from "../src/authz/cedar";
import type { Principal } from "../src/auth/tokens";

const farmer: Principal = { userId: "u-farmer", name: "F", role: "farmer", chcId: null, farmerId: "farmer-1", demo: true };
const otherFarmer: Principal = { ...farmer, userId: "u-other", farmerId: "farmer-2" };
const operator: Principal = { userId: "u-op", name: "O", role: "operator", chcId: "chc-a", farmerId: null, demo: true };
const foreignOperator: Principal = { ...operator, userId: "u-op-b", chcId: "chc-b" };
const officer: Principal = { userId: "u-off", name: "D", role: "officer", chcId: null, farmerId: null, demo: true };
const facilitator: Principal = { userId: "u-fac", name: "G", role: "facilitator", chcId: null, farmerId: null, demo: true };

const field = { type: "Field" as const, id: "f1", chcId: "chc-a", farmerId: "farmer-1", bookedBy: "u-fac" };
const chcA = { type: "Chc" as const, id: "chc-a" };

describe("Cedar policies", () => {
  it("farmer sees own field, not another farmer's", () => {
    expect(authorize(farmer, "ViewField", field).allowed).toBe(true);
    expect(authorize(otherFarmer, "ViewField", field).allowed).toBe(false);
  });
  it("facilitator sees only fields they booked", () => {
    expect(authorize(facilitator, "AskWhy", field).allowed).toBe(true);
    expect(authorize(facilitator, "AskWhy", { ...field, bookedBy: "someone-else" }).allowed).toBe(false);
  });
  it("operator acts only on own CHC", () => {
    expect(authorize(operator, "ApprovePlan", chcA).allowed).toBe(true);
    expect(authorize(foreignOperator, "ApprovePlan", chcA).allowed).toBe(false);
    expect(authorize(foreignOperator, "ViewField", field).allowed).toBe(false);
  });
  it("farmer cannot approve a plan or report a breakdown", () => {
    expect(authorize(farmer, "ApprovePlan", chcA).allowed).toBe(false);
    expect(authorize(farmer, "ReportBreakdown", chcA).allowed).toBe(false);
  });
  it("officer sees aggregates but never farmer contact details", () => {
    expect(authorize(officer, "ViewAggregates", chcA).allowed).toBe(true);
    expect(authorize(officer, "ViewFarmerContact", field).allowed).toBe(false);
    expect(authorize(officer, "ViewField", field).allowed).toBe(false);
  });
  it("names the policy that allowed a request", () => {
    expect(authorize(operator, "ViewBoard", chcA).policyIds).toContain("operator-own-chc");
  });
});
