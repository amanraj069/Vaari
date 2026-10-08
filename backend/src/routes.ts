/**
 * HTTP routes. Each handler: authenticate, authorise with Cedar against the actual record,
 * validate input with Zod, then call the planner or a view builder.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { dateToDay, fieldRequestInputSchema, localeSchema, roleSchema, type Locale, type Me, type Why } from "./shared";
import type { AppDependencies } from "./app";
import { mintDemoToken, AuthError, type Principal } from "./auth/tokens";
import { authorize, type Action, type Resource } from "./authz/cedar";
import { DEMO_USERS } from "./demo/seed";
import { NotFoundError } from "./domain/planner";
import { buildBoard, buildFarmerField, buildFarmerHome, buildQueue } from "./domain/views";
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
      if (!config.DEMO_MODE || config.AUTH_MODE !== "demo") {
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

  router.get(
    "/me",
    authenticate,
    asyncHandler(async (request, response) => {
      const user = await dependencies.store.getUser(request.principal.userId);
      const me: Me = {
        userId: request.principal.userId,
        name: request.principal.name,
        role: request.principal.role,
        chcId: request.principal.chcId,
        farmerId: request.principal.farmerId,
        language: user?.language ?? "en",
        demo: request.principal.demo,
      };
      response.json(me);
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
      const villages = (await dependencies.store.listVillages()).filter((village) => chc.villageIds.includes(village.id));
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
      const notifications = await dependencies.store.listNotifications(principal.farmerId);
      response.status(201).json(await buildFarmerField(dependencies.planner, dependencies.store, field, allFields, notifications));
    }),
  );

  router.get(
    "/fields/:fieldId/why",
    authenticate,
    asyncHandler(async (request, response) => {
      const { principal } = request;
      const locale: Locale = localeSchema.catch("en").parse(request.query.lang);
      const field = await dependencies.store.getField(String(request.params.fieldId));
      if (!field) throw new NotFoundError("field not found");
      requireCedar(principal, "AskWhy", { type: "Field", id: field.id, chcId: field.chcId, farmerId: field.farmerId, bookedBy: field.bookedBy });
      const { request: solveRequest } = await dependencies.planner.buildSolveRequest(field.chcId);
      // Unplanned: ask whether any day inside the horizon could work.
      const currentDay = field.plannedDay ?? dependencies.planner.today() + 1 + (solveRequest.horizonDays ?? 10);
      const explained = await engine.explain({ ...solveRequest, fieldId: field.id, currentDay });
      const machines = await dependencies.store.listMachines(field.chcId);
      const machineName = new Map(machines.map((machine) => [machine.id, machine.name]));
      const why: Why = {
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
      response.json(why);
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
