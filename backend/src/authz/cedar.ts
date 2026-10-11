/**
 * Resource-level authorisation with Cedar, evaluated in-process (cedar-wasm). The principal is a
 * signed-in User (the JWT identity) or a FarmerPhone (a farmer's phone session); the stored record
 * is the resource. A denial names no internals to the caller, but the matching policy ids are logged.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import type { Principal } from "../auth/tokens";
import type { FarmerPhonePrincipal } from "../auth/farmer-session";

export type Action =
  | "ViewField"
  | "AskWhy"
  | "RequestField"
  | "ViewBoard"
  | "ViewQueue"
  | "GeneratePlan"
  | "MovePlan"
  | "ApprovePlan"
  | "ReportBreakdown"
  | "MarkSown"
  | "ResetDemo"
  | "ManageMachines"
  | "AdvanceDay"
  | "ChangeBooking"
  | "ArrangeLoan"
  | "ViewFarmerContact"
  | "ViewAggregates"
  | "ReissueLink"
  | "RequestSooner";

export type Resource =
  | { type: "Field"; id: string; chcId: string; farmerPhone: string | null; bookedBy: string | null }
  | { type: "Chc"; id: string };

/** The Cedar view of a stored field. */
export const fieldResource = (field: { id: string; chcId: string; farmerPhone: string | null; bookedBy: string | null }): Resource => ({
  type: "Field",
  id: field.id,
  chcId: field.chcId,
  farmerPhone: field.farmerPhone,
  bookedBy: field.bookedBy,
});

// From src/authz in development, from dist/ after a build.
const here = path.dirname(fileURLToPath(import.meta.url));
const policyPath =
  [path.resolve(here, "../../policies/vaari.cedar"), path.resolve(here, "../policies/vaari.cedar")].find((candidate) => existsSync(candidate)) ??
  path.resolve(here, "../../policies/vaari.cedar");
// Cedar numbers policies given as one string (policy0, policy1, ...). Splitting on the @id
// annotations keeps readable ids, so a decision can be traced to "operator-own-chc".
const policiesById: Record<string, string> = {};
for (const chunk of readFileSync(policyPath, "utf8").split(/(?=@id\(")/)) {
  const match = chunk.match(/^@id\("([^"]+)"\)/);
  if (match?.[1]) policiesById[match[1]] = chunk.replace(/\/\/[^\n]*\n/g, "\n").trim();
}

export type Decision = { allowed: boolean; policyIds: string[]; errors: string[] };

export function authorize(principal: Principal | FarmerPhonePrincipal, action: Action, resource: Resource): Decision {
  const resourceAttributes: Record<string, string> =
    resource.type === "Field"
      ? { chcId: resource.chcId, farmerPhone: resource.farmerPhone ?? "", bookedBy: resource.bookedBy ?? "" }
      : { chcId: resource.id };
  // A phone session's entity id is a fixed word, so the number never appears in a Cedar diagnostic.
  const principalEntity: { uid: { type: string; id: string }; attrs: Record<string, string>; parents: [] } =
    "kind" in principal
      ? { uid: { type: "FarmerPhone", id: "session" }, attrs: { phone: principal.phone }, parents: [] }
      : {
          uid: { type: "User", id: principal.userId },
          attrs: { role: principal.role ?? "", userId: principal.userId, chcId: principal.chcId ?? "" },
          parents: [],
        };
  const answer = cedar.isAuthorized({
    principal: principalEntity.uid,
    action: { type: "Action", id: action },
    resource: { type: resource.type, id: resource.id },
    context: {},
    policies: { staticPolicies: policiesById },
    entities: [principalEntity, { uid: { type: resource.type, id: resource.id }, attrs: resourceAttributes, parents: [] }],
  });
  if (answer.type === "failure") {
    return { allowed: false, policyIds: [], errors: answer.errors.map((error) => error.message) };
  }
  return {
    allowed: answer.response.decision === "allow",
    policyIds: answer.response.diagnostics.reason,
    errors: answer.response.diagnostics.errors.map((error) => error.error.message),
  };
}
