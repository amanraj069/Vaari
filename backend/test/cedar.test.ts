/**
 * Cedar allow/deny per principal. Signed-in Users have a role; a farmer is a FarmerPhone principal
 * (a phone session) that may only read fields booked with that phone.
 */
import { describe, expect, it } from "vitest";
import { authorize, type Action } from "../src/authz/cedar";
import type { Principal } from "../src/auth/tokens";
import type { FarmerPhonePrincipal } from "../src/auth/farmer-session";

const operator: Principal = { userId: "u-op", name: "O", role: "operator", chcId: "chc-a", demo: true };
const foreignOperator: Principal = { ...operator, userId: "u-op-b", chcId: "chc-b" };
const officer: Principal = { userId: "u-off", name: "D", role: "officer", chcId: null, demo: true };
const facilitator: Principal = { userId: "u-fac", name: "G", role: "facilitator", chcId: "chc-a", demo: true };
const pending: Principal = { userId: "u-new", name: "N", role: null, chcId: null, demo: false };
const farmerPhone: FarmerPhonePrincipal = { kind: "farmerPhone", phone: "+447700900017" };
const otherPhone: FarmerPhonePrincipal = { kind: "farmerPhone", phone: "+447700900018" };

const field = { type: "Field" as const, id: "f1", chcId: "chc-a", farmerPhone: "+447700900017", bookedBy: "u-fac" };
const phonelessField = { ...field, id: "f2", farmerPhone: null };
const chcA = { type: "Chc" as const, id: "chc-a" };

const OPERATOR_ACTIONS: Action[] = ["ViewBoard", "ViewQueue", "GeneratePlan", "MovePlan", "ApprovePlan", "ReportBreakdown", "MarkSown", "ResetDemo"];

describe("Cedar policies", () => {
  it("a farmer's phone session sees and asks about fields with that phone, and nothing else", () => {
    expect(authorize(farmerPhone, "ViewField", field)).toMatchObject({ allowed: true, policyIds: ["farmer-phone-own-fields"] });
    expect(authorize(farmerPhone, "AskWhy", field).allowed).toBe(true);
    expect(authorize(otherPhone, "ViewField", field).allowed).toBe(false);
    expect(authorize(farmerPhone, "ViewField", phonelessField).allowed).toBe(false);
  });

  it("a farmer's phone may ask for an earlier date (WhatsApp, after Confirm) on its own fields only", () => {
    expect(authorize(farmerPhone, "RequestSooner", field).allowed).toBe(true);
    expect(authorize(otherPhone, "RequestSooner", field).allowed).toBe(false);
    expect(authorize(farmerPhone, "RequestSooner", phonelessField).allowed).toBe(false);
    for (const user of [operator, facilitator, officer]) expect(authorize(user, "RequestSooner", field).allowed).toBe(false);
  });

  it("a farmer's phone may book for itself (the route supplies the phone) but never reissue, see contacts or run a centre", () => {
    expect(authorize(farmerPhone, "RequestField", chcA)).toMatchObject({ allowed: true });
    for (const action of ["ReissueLink", "ViewFarmerContact"] as Action[]) expect(authorize(farmerPhone, action, field).allowed).toBe(false);
    for (const action of ["ViewAggregates", ...OPERATOR_ACTIONS] as Action[]) {
      const decision = authorize(farmerPhone, action, chcA);
      expect(decision.allowed).toBe(false);
      expect(decision.errors).toEqual([]); // the User policies skip a FarmerPhone cleanly
    }
  });

  it("only facilitators book; a facilitator sees and reissues only fields they booked", () => {
    expect(authorize(facilitator, "RequestField", chcA).allowed).toBe(true);
    expect(authorize(operator, "RequestField", chcA).allowed).toBe(false);
    expect(authorize(officer, "RequestField", chcA).allowed).toBe(false);
    expect(authorize(facilitator, "AskWhy", field).allowed).toBe(true);
    expect(authorize(facilitator, "ReissueLink", field).allowed).toBe(true);
    expect(authorize(facilitator, "AskWhy", { ...field, bookedBy: "someone-else" }).allowed).toBe(false);
    expect(authorize(facilitator, "ReissueLink", { ...field, bookedBy: "someone-else" }).allowed).toBe(false);
    expect(authorize(facilitator, "ApprovePlan", chcA).allowed).toBe(false);
  });

  it("operator acts only on own CHC", () => {
    for (const action of OPERATOR_ACTIONS) expect(authorize(operator, action, chcA).allowed).toBe(true);
    expect(authorize(operator, "ReissueLink", field).allowed).toBe(true);
    expect(authorize(foreignOperator, "ApprovePlan", chcA).allowed).toBe(false);
    expect(authorize(foreignOperator, "ViewField", field).allowed).toBe(false);
    expect(authorize(foreignOperator, "ReissueLink", field).allowed).toBe(false);
  });

  it("officer sees aggregates but never farmer contact details or a field", () => {
    expect(authorize(officer, "ViewAggregates", chcA).allowed).toBe(true);
    expect(authorize(officer, "ViewFarmerContact", field).allowed).toBe(false);
    expect(authorize(officer, "ViewField", field).allowed).toBe(false);
    expect(authorize(officer, "ReissueLink", field).allowed).toBe(false);
  });

  it("a user with no role yet is refused everything", () => {
    expect(authorize(pending, "ViewBoard", chcA).allowed).toBe(false);
    expect(authorize(pending, "ViewField", field).allowed).toBe(false);
  });

  it("names the policy that allowed a request", () => {
    expect(authorize(operator, "ViewBoard", chcA).policyIds).toContain("operator-own-chc");
  });
});
