/**
 * HTTP routes. Each handler: authenticate, authorise with Cedar against the actual record,
 * validate input with Zod, then call the planner or a view builder.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  bookingInputSchema,
  dateToDay,
  waitingLimitInputSchema,
  localeSchema,
  moveInputSchema,
  onboardingInputSchema,
  proofResultsSchema,
  roleSchema,
  type ChcOption,
  type Locale,
  type Me,
  type ProofResults,
  type Why,
} from "./shared";
import type { AppDependencies } from "./app";
import { mintDemoToken, AuthError, type Principal } from "./auth/tokens";
import { authorize, type Action, type Resource } from "./authz/cedar";
import { DEMO_USERS } from "./demo/seed";
import { NotFoundError } from "./domain/planner";
import type { FieldRecord } from "./store/types";
import { buildBoard, buildBookedFields, buildFarmerHome, buildOneFarmerField, buildPlanView, buildQueue } from "./domain/views";
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

/** The language for server-phrased sentences (?lang=en|pa|hi; English if missing or unknown). */
const localeOf = (request: Request): Locale => localeSchema.catch("en").parse(request.query.lang);

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

  // The evidence page reads only the simulator's results file (written by `npm run simulate`).
  // Missing: 404 NOT_RUN, and the page shows an empty state. A file that fails the shared schema
  // is refused (500), never patched. Read again only when the file changes.
  let proofCache: { mtimeMs: number; body: ProofResults } | null = null;
  router.get(
    "/public/proof",
    asyncHandler(async (request, response) => {
      const file = path.join(config.DATA_DIR, "sim", "results.json");
      let mtimeMs: number;
      try {
        mtimeMs = (await stat(file)).mtimeMs;
      } catch {
        response.status(404).json({ error: "NOT_RUN" });
        return;
      }
      if (proofCache?.mtimeMs !== mtimeMs) {
        const parsed = proofResultsSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
        if (!parsed.success) {
          request.log.error({ issues: parsed.error.issues.slice(0, 5) }, "data/sim/results.json does not match the proof schema");
          response.status(500).json({ error: "RESULTS_INVALID" });
          return;
        }
        proofCache = { mtimeMs, body: parsed.data };
      }
      response.json(proofCache.body);
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
      const home = await buildFarmerHome(dependencies.planner, dependencies.store, principal.farmerId, requireChc(principal), localeOf(request));
      for (const field of home.fields) {
        requireCedar(principal, "ViewField", { type: "Field", id: field.id, chcId: requireChc(principal), farmerId: principal.farmerId, bookedBy: null });
      }
      response.json(home);
    }),
  );

  // A booking. A farmer books for themselves; a facilitator books for a farmer who may have no
  // account (a farmer record is created) and must give the farmer's name. The field is stored as a
  // request at once; it gets a date when the operator publishes a plan. The answer carries the
  // farmer's slot link either way.
  router.post(
    "/fields",
    authenticate,
    asyncHandler(async (request, response) => {
      const { principal } = request;
      const chcId = requireChc(principal);
      requireCedar(principal, "RequestField", { type: "Chc", id: chcId });
      const input = bookingInputSchema.parse(request.body);
      const today = dependencies.planner.today();
      const readyDay = dateToDay(config.SEASON_START_DATE, input.readyDate);
      if (readyDay < today - 7 || readyDay > today + 30) {
        response.status(400).json({ error: "READY_DATE_OUT_OF_RANGE" });
        return;
      }
      let farmer: { farmerId: string; farmerName: string; bookedBy: string | null };
      if (principal.role === "facilitator") {
        if (!input.farmerName) {
          response.status(400).json({ error: "FARMER_NAME_REQUIRED" });
          return;
        }
        const farmerId = `farmer-${randomUUID().slice(0, 8)}`;
        await dependencies.store.putFarmer({ id: farmerId, name: input.farmerName, phone: "", language: "pa", facilitatorId: principal.userId });
        farmer = { farmerId, farmerName: input.farmerName, bookedBy: principal.userId };
      } else if (principal.role === "farmer" && principal.farmerId) {
        const record = await dependencies.store.getFarmer(principal.farmerId);
        farmer = { farmerId: principal.farmerId, farmerName: record?.name ?? principal.name, bookedBy: null };
      } else {
        throw new ForbiddenError(["only farmers and facilitators book fields"]);
      }
      const field = await dependencies.planner.requestField(chcId, farmer, input);
      const token = await mintSlotToken(config, { chcId: field.chcId, fieldId: field.id });
      response.status(201).json({
        field: await buildOneFarmerField(dependencies.planner, dependencies.store, field, localeOf(request)),
        slot: { token, path: `/slot/${token}` },
      });
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
      const locale = localeOf(request);
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
      response.json(await buildOneFarmerField(dependencies.planner, dependencies.store, field, localeOf(request)));
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
      response.json(await explainField(field, localeOf(request)));
    }),
  );

  router.post(
    "/slot/:token/waiting-limit",
    slotLimiter,
    asyncHandler(async (request, response) => {
      const field = await fieldFromSlot(String(request.params.token));
      const { waitingLimitDays } = waitingLimitInputSchema.parse(request.body);
      const updated = await dependencies.planner.shortenWaitingLimit(field.chcId, field.id, waitingLimitDays);
      response.json(await buildOneFarmerField(dependencies.planner, dependencies.store, updated, localeOf(request)));
    }),
  );

  // --- Facilitator --------------------------------------------------------------------------

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

  // The planning workspace: the newest plan (usually a draft), what approving it does, the moves.
  router.get(
    "/operator/plan",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "ViewBoard", { type: "Chc", id: chcId });
      response.json(await buildPlanView(dependencies.planner, dependencies.store, chcId));
    }),
  );

  // Runs the engine and stores a DRAFT. Nothing a farmer sees changes until it is approved.
  router.post(
    "/operator/plan/generate",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "GeneratePlan", { type: "Chc", id: chcId });
      await dependencies.planner.generatePlan(chcId);
      response.json(await buildPlanView(dependencies.planner, dependencies.store, chcId));
    }),
  );

  // Moves one field to a machine and day; the engine re-plans everyone else around it (new draft).
  router.post(
    "/operator/plan/move",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "MovePlan", { type: "Chc", id: chcId });
      const input = moveInputSchema.parse(request.body);
      await dependencies.planner.moveField(chcId, input.fieldId, input.machineId, dependencies.planner.isoToDay(input.date));
      response.json(await buildPlanView(dependencies.planner, dependencies.store, chcId));
    }),
  );

  // Publishes the draft the operator reviewed: promises are created, firmed or (only in
  // minimal-break mode) broken now, and farmers see them on their slot links.
  router.post(
    "/operator/plan/approve",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "ApprovePlan", { type: "Chc", id: chcId });
      const { version } = z.object({ version: z.number().int() }).parse(request.body);
      await dependencies.planner.approvePlan(chcId, version, request.principal.name);
      response.json(await buildPlanView(dependencies.planner, dependencies.store, chcId));
    }),
  );

  // The machine has sown a field: its promise is kept (or, if late, broken).
  router.post(
    "/operator/fields/:fieldId/sown",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "MarkSown", { type: "Chc", id: chcId });
      const field = await dependencies.planner.markSown(chcId, String(request.params.fieldId));
      response.json(await buildOneFarmerField(dependencies.planner, dependencies.store, field, localeOf(request)));
    }),
  );

  // A breakdown (or a machine back) makes a new draft at once; the operator reviews and approves it.
  router.post(
    "/operator/machines/:machineId/down",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "ReportBreakdown", { type: "Chc", id: chcId });
      const { days } = z.object({ days: z.number().int().min(1).max(5).default(1) }).parse(request.body ?? {});
      await dependencies.planner.setMachineDown(chcId, String(request.params.machineId), days);
      response.json(await buildPlanView(dependencies.planner, dependencies.store, chcId));
    }),
  );

  router.post(
    "/operator/machines/:machineId/up",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "ReportBreakdown", { type: "Chc", id: chcId });
      await dependencies.planner.setMachineBack(chcId, String(request.params.machineId));
      response.json(await buildPlanView(dependencies.planner, dependencies.store, chcId));
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
