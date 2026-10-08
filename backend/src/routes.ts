/**
 * HTTP routes. Each handler: authenticate, authorise with Cedar against the actual record,
 * validate input with Zod, then call the planner or a view builder.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  dateToDay,
  facilitatorBookingInputSchema,
  waitingLimitInputSchema,
  fieldRequestInputSchema,
  localeSchema,
  onboardingInputSchema,
  roleSchema,
  type ChcOption,
  type Locale,
  type Me,
  type Why,
} from "./shared";
import type { AppDependencies } from "./app";
import { mintDemoToken, AuthError, type Principal } from "./auth/tokens";
import { authorize, type Action, type Resource } from "./authz/cedar";
import { DEMO_USERS } from "./demo/seed";
import { NotFoundError } from "./domain/planner";
import type { FieldRecord } from "./store/types";
import { buildBoard, buildBookedFields, buildFarmerField, buildFarmerHome, buildQueue } from "./domain/views";
import { mintSlotToken, verifySlotToken } from "./auth/slot-token";
import { reasonText } from "./explain/templates";

export class ForbiddenError extends Error {
  constructor(readonly errors: string[] = []) {
    super("forbidden");
  }
}

type AuthedRequest = Request & { principal: Principal };

const asyncHandler =
  (handler: (request: AuthedRequest, response: Response) => Promise<void>): RequestHandler =>
  (request, response, next: NextFunction) => {
    handler(request as AuthedRequest, response).catch(next);
  };

function requireCedar(principal: Principal, action: Action, resource: Resource): void {
  const decision = authorize(principal, action, resource);
  if (!decision.allowed) throw new ForbiddenError(decision.errors);
}

function requireChc(principal: Principal): string {
  if (!principal.chcId) throw new ForbiddenError(["principal has no CHC"]);
  return principal.chcId;
}

export function buildRoutes(dependencies: AppDependencies): Router {
  // Read store and planner through `dependencies` on every request: a demo reset swaps them.
  const { config, engine } = dependencies;
  const router = Router();

  const authenticate: RequestHandler = (request, _response, next) => {
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!token) return next(new AuthError("missing bearer token"));
    dependencies.verifier
      .verify(token)
      .then((principal) => {
        (request as AuthedRequest).principal = principal;
        next();
      })
      .catch(next);
  };

  // --- Public -------------------------------------------------------------------------------

  router.get(
    "/public/summary",
    asyncHandler(async (_request, response) => {
      const chcs = await dependencies.store.listChcs();
      let machineCount = 0;
      let fieldCount = 0;
      const villageIds = new Set<string>();
      for (const chc of chcs) {
        machineCount += (await dependencies.store.listMachines(chc.id)).length;
        fieldCount += (await dependencies.store.listFields(chc.id)).length;
        chc.villageIds.forEach((id) => villageIds.add(id));
      }
      response.json({
        today: config.DEMO_TODAY,
        seasonStartDate: config.SEASON_START_DATE,
        optimumLastDate: config.OPTIMUM_LAST_DATE,
        chcCount: chcs.length,
        machineCount,
        fieldCount,
        villageCount: villageIds.size,
      });
    }),
  );

  // Demo personas: real sessions for seeded users only, only when DEMO_MODE is on.
  const demoLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
  router.post(
    "/auth/demo",
    demoLimiter,
    asyncHandler(async (request, response) => {
      if (!config.DEMO_MODE) {
        response.status(404).json({ error: "NOT_FOUND" });
        return;
      }
      const { role } = z.object({ role: roleSchema }).parse(request.body);
      const userId = DEMO_USERS[role];
      const user = await dependencies.store.getUser(userId);
      if (!user) throw new NotFoundError("demo user not seeded");
      const minted = await mintDemoToken(config, user);
      response.json({ accessToken: minted.token, expiresIn: minted.expiresIn, role });
    }),
  );

  // --- Session ------------------------------------------------------------------------------

  // Onboarding is needed until the user has a role and the records that role works with.
  const needsOnboarding = (principal: Principal) =>
    !principal.role || (principal.role !== "officer" && !principal.chcId) || (principal.role === "farmer" && !principal.farmerId);

  const meFor = async (principal: Principal): Promise<Me> => {
    const user = await dependencies.store.getUser(principal.userId);
    return {
      userId: principal.userId,
      name: principal.name,
      role: principal.role,
      chcId: principal.chcId,
      farmerId: principal.farmerId,
      language: user?.language ?? "en",
      demo: principal.demo,
      needsOnboarding: needsOnboarding(principal),
    };
  };

  router.get(
    "/me",
    authenticate,
    asyncHandler(async (request, response) => {
      response.json(await meFor(request.principal));
    }),
  );

  router.get(
    "/chcs",
    authenticate,
    asyncHandler(async (_request, response) => {
      const options: ChcOption[] = [];
      for (const chc of await dependencies.store.listChcs()) {
        const machines = await dependencies.store.listMachines(chc.id);
        options.push({ id: chc.id, name: chc.name, villageCount: chc.villageIds.length, machineCount: machines.length });
      }
      response.json(options);
    }),
  );

  // A new Google user picks a role and CHC on /welcome. Demo personas are seeded and never change.
  // Operator access can be self-picked only in demo mode; otherwise it must come from the
  // Cognito "operator" group, or any Google account could approve plans.
  router.post(
    "/me/profile",
    authenticate,
    asyncHandler(async (request, response) => {
      const { principal } = request;
      if (principal.demo) throw new ForbiddenError(["demo personas cannot change their profile"]);
      const input = onboardingInputSchema.parse(request.body);
      if (input.role === "operator" && !config.DEMO_MODE && principal.role !== "operator") {
        throw new ForbiddenError(["operator access needs the Cognito operator group"]);
      }
      const chc = await dependencies.store.getChc(input.chcId);
      if (!chc) throw new NotFoundError("CHC not found");
      const existing = await dependencies.store.getUser(principal.userId);
      const farmerId = input.role === "farmer" ? (existing?.farmerId ?? `farmer-${principal.userId}`) : null;
      if (farmerId) {
        await dependencies.store.putFarmer({ id: farmerId, name: input.name, phone: "", language: input.language, facilitatorId: null });
      }
      await dependencies.store.putUser({
        userId: principal.userId,
        name: input.name,
        role: input.role,
        chcId: chc.id,
        farmerId,
        language: input.language,
      });
      const updated = await dependencies.verifier.verify(String(request.headers.authorization).slice("Bearer ".length));
      response.json(await meFor(updated));
    }),
  );

  router.post(
    "/me/language",
    authenticate,
    asyncHandler(async (request, response) => {
      const { language } = z.object({ language: localeSchema }).parse(request.body);
      const user = await dependencies.store.getUser(request.principal.userId);
      if (user) await dependencies.store.putUser({ ...user, language });
      response.json({ language });
    }),
  );

  // --- Farmer -------------------------------------------------------------------------------

  router.get(
    "/villages",
    authenticate,
    asyncHandler(async (request, response) => {
      const chc = await dependencies.store.getChc(requireChc(request.principal));
      if (!chc) throw new NotFoundError("CHC not found");
      const villages = dependencies.planner.villages().filter((village) => chc.villageIds.includes(village.id));
      response.json(villages.map(({ id, name, namePa }) => ({ id, name, namePa })));
    }),
  );

  router.get(
    "/farmer/home",
    authenticate,
    asyncHandler(async (request, response) => {
      const { principal } = request;
      if (principal.role !== "farmer" || !principal.farmerId) throw new ForbiddenError(["not a farmer"]);
      const home = await buildFarmerHome(dependencies.planner, dependencies.store, principal.farmerId, requireChc(principal));
      for (const field of home.fields) {
        requireCedar(principal, "ViewField", { type: "Field", id: field.id, chcId: requireChc(principal), farmerId: principal.farmerId, bookedBy: null });
      }
      response.json(home);
    }),
  );

  router.post(
    "/farmer/requests",
    authenticate,
    asyncHandler(async (request, response) => {
      const { principal } = request;
      const chcId = requireChc(principal);
      requireCedar(principal, "RequestField", { type: "Chc", id: chcId });
      if (principal.role !== "farmer" || !principal.farmerId) throw new ForbiddenError(["only farmers book for themselves here"]);
      const input = fieldRequestInputSchema.parse(request.body);
      const today = dependencies.planner.today();
      const readyDay = dateToDay(config.SEASON_START_DATE, input.readyDate);
      if (readyDay < today - 7 || readyDay > today + 30) {
        response.status(400).json({ error: "READY_DATE_OUT_OF_RANGE" });
        return;
      }
      const farmer = await dependencies.store.getFarmer(principal.farmerId);
      const field = await dependencies.planner.requestField(
        chcId,
        { farmerId: principal.farmerId, farmerName: farmer?.name ?? principal.name, bookedBy: null },
        input,
      );
      const allFields = await dependencies.store.listFields(chcId);
      response.status(201).json(await buildFarmerField(dependencies.planner, dependencies.store, field, allFields));
    }),
  );

  // "Why this date?" from the solver's own reasons, phrased by templates. Shared by the signed-in
  // route and the slot-link route so both say exactly the same thing.
  const explainField = async (field: FieldRecord, locale: Locale): Promise<Why> => {
    const { request: solveRequest } = await dependencies.planner.buildSolveRequest(field.chcId);
    // Unplanned: ask whether any day inside the horizon could work.
    const currentDay = field.plannedDay ?? dependencies.planner.today() + 1 + (solveRequest.horizonDays ?? 10);
    const explained = await engine.explain({ ...solveRequest, fieldId: field.id, currentDay });
    const machines = await dependencies.store.listMachines(field.chcId);
    const machineName = new Map(machines.map((machine) => [machine.id, machine.name]));
    return {
      fieldId: field.id,
      plannedDate: field.plannedDay === null ? null : dependencies.planner.dayToIso(field.plannedDay),
      earlierPossible: explained.earlierPossible,
      reasons: explained.reasons.map((reason) => {
        const dates = reason.days.map((day) => dependencies.planner.dayToIso(day));
        const machineNames = reason.machineIds.map((id) => machineName.get(id) ?? id);
        return {
          code: reason.code,
          dates,
          machineNames,
          count: reason.count,
          text: reasonText(reason.code, { dates, machines: machineNames, count: reason.count }, locale),
        };
      }),
      source: "template",
    };
  };

  router.get(
    "/fields/:fieldId/why",
    authenticate,
    asyncHandler(async (request, response) => {
      const { principal } = request;
      const locale: Locale = localeSchema.catch("en").parse(request.query.lang);
      // Fields are keyed by (chcId, fieldId): the caller's CHC makes this a direct GetItem.
      const field = await dependencies.store.getField(requireChc(principal), String(request.params.fieldId));
      if (!field) throw new NotFoundError("field not found");
      requireCedar(principal, "AskWhy", { type: "Field", id: field.id, chcId: field.chcId, farmerId: field.farmerId, bookedBy: field.bookedBy });
      response.json(await explainField(field, locale));
    }),
  );

  // A shareable, read-only link to one field's turn (for a farmer without an account).
  router.get(
    "/fields/:fieldId/slot-link",
    authenticate,
    asyncHandler(async (request, response) => {
      const { principal } = request;
      const field = await dependencies.store.getField(requireChc(principal), String(request.params.fieldId));
      if (!field) throw new NotFoundError("field not found");
      requireCedar(principal, "ViewField", { type: "Field", id: field.id, chcId: field.chcId, farmerId: field.farmerId, bookedBy: field.bookedBy });
      const token = await mintSlotToken(config, { chcId: field.chcId, fieldId: field.id });
      response.json({ token, path: `/slot/${token}` });
    }),
  );

  const slotLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
  router.get(
    "/slot/:token",
    slotLimiter,
    asyncHandler(async (request, response) => {
      const { chcId, fieldId } = await verifySlotToken(config, String(request.params.token));
      const field = await dependencies.store.getField(chcId, fieldId);
      if (!field) throw new NotFoundError("field not found");
      const allFields = await dependencies.store.listFields(chcId);
      response.json(await buildFarmerField(dependencies.planner, dependencies.store, field, allFields));
    }),
  );

  // The slot token is the permission: it names exactly one field (chcId + fieldId).
  const fieldFromSlot = async (token: string): Promise<FieldRecord> => {
    const { chcId, fieldId } = await verifySlotToken(config, token);
    const field = await dependencies.store.getField(chcId, fieldId);
    if (!field) throw new NotFoundError("field not found");
    return field;
  };

  router.get(
    "/slot/:token/why",
    slotLimiter,
    asyncHandler(async (request, response) => {
      const field = await fieldFromSlot(String(request.params.token));
      response.json(await explainField(field, localeSchema.catch("en").parse(request.query.lang)));
    }),
  );

  router.post(
    "/slot/:token/waiting-limit",
    slotLimiter,
    asyncHandler(async (request, response) => {
      const field = await fieldFromSlot(String(request.params.token));
      const { waitingLimitDays } = waitingLimitInputSchema.parse(request.body);
      const updated = await dependencies.planner.shortenWaitingLimit(field.chcId, field.id, waitingLimitDays);
      const allFields = await dependencies.store.listFields(field.chcId);
      response.json(await buildFarmerField(dependencies.planner, dependencies.store, updated, allFields));
    }),
  );

  // --- Facilitator --------------------------------------------------------------------------

  // A facilitator books for a farmer without an account; the answer includes the farmer's slot link.
  router.post(
    "/facilitator/fields",
    authenticate,
    asyncHandler(async (request, response) => {
      const { principal } = request;
      if (principal.role !== "facilitator") throw new ForbiddenError(["not a facilitator"]);
      const chcId = requireChc(principal);
      requireCedar(principal, "RequestField", { type: "Chc", id: chcId });
      const input = facilitatorBookingInputSchema.parse(request.body);
      const today = dependencies.planner.today();
      const readyDay = dateToDay(config.SEASON_START_DATE, input.readyDate);
      if (readyDay < today - 7 || readyDay > today + 30) {
        response.status(400).json({ error: "READY_DATE_OUT_OF_RANGE" });
        return;
      }
      const farmerId = `farmer-${randomUUID().slice(0, 8)}`;
      await dependencies.store.putFarmer({ id: farmerId, name: input.farmerName, phone: "", language: "pa", facilitatorId: principal.userId });
      const field = await dependencies.planner.requestField(
        chcId,
        { farmerId, farmerName: input.farmerName, bookedBy: principal.userId },
        { villageId: input.villageId, acres: input.acres, readyDate: input.readyDate, waitingLimitDays: input.waitingLimitDays },
      );
      const token = await mintSlotToken(config, { chcId: field.chcId, fieldId: field.id });
      const allFields = await dependencies.store.listFields(chcId);
      response.status(201).json({ field: await buildFarmerField(dependencies.planner, dependencies.store, field, allFields), slot: { token, path: `/slot/${token}` } });
    }),
  );

  // Fields this facilitator booked for farmers, via the booked-by-index; Cedar re-checks each one.
  router.get(
    "/facilitator/fields",
    authenticate,
    asyncHandler(async (request, response) => {
      const { principal } = request;
      if (principal.role !== "facilitator") throw new ForbiddenError(["not a facilitator"]);
      const booked = await dependencies.store.listFieldsBookedBy(principal.userId);
      const visible = booked.filter(
        (field) =>
          authorize(principal, "ViewField", { type: "Field", id: field.id, chcId: field.chcId, farmerId: field.farmerId, bookedBy: field.bookedBy })
            .allowed,
      );
      response.json({ today: dependencies.planner.dayToIso(dependencies.planner.today()), items: await buildBookedFields(dependencies.planner, dependencies.store, visible) });
    }),
  );

  // --- Operator -----------------------------------------------------------------------------

  router.get(
    "/operator/board",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "ViewBoard", { type: "Chc", id: chcId });
      response.json(await buildBoard(dependencies.planner, dependencies.store, chcId));
    }),
  );

  router.get(
    "/operator/queue",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "ViewQueue", { type: "Chc", id: chcId });
      response.json({ today: dependencies.planner.dayToIso(dependencies.planner.today()), items: await buildQueue(dependencies.planner, dependencies.store, chcId) });
    }),
  );

  router.post(
    "/operator/plan/approve",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "ApprovePlan", { type: "Chc", id: chcId });
      const { version } = z.object({ version: z.number().int() }).parse(request.body);
      const plan = await dependencies.planner.approvePlan(chcId, version, request.principal.name);
      response.json({ status: plan.status, version: plan.version, approvedAt: plan.approvedAt });
    }),
  );

  router.post(
    "/operator/machines/:machineId/down",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "ReportBreakdown", { type: "Chc", id: chcId });
      const { days } = z.object({ days: z.number().int().min(1).max(5).default(1) }).parse(request.body ?? {});
      await dependencies.planner.setMachineDown(chcId, String(request.params.machineId), days);
      response.json(await buildBoard(dependencies.planner, dependencies.store, chcId));
    }),
  );

  router.post(
    "/operator/machines/:machineId/up",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "ReportBreakdown", { type: "Chc", id: chcId });
      await dependencies.planner.setMachineBack(chcId, String(request.params.machineId));
      response.json(await buildBoard(dependencies.planner, dependencies.store, chcId));
    }),
  );

  router.post(
    "/operator/demo/reset",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "ResetDemo", { type: "Chc", id: chcId });
      if (!config.DEMO_MODE) throw new ForbiddenError(["demo mode off"]);
      await dependencies.resetDemo();
      response.json(await buildBoard(dependencies.planner, dependencies.store, chcId));
    }),
  );

  return router;
}
