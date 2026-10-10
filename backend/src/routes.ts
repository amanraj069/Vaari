/**
 * HTTP routes. Each handler: authenticate, authorise with Cedar against the actual record,
 * validate input with Zod, then call the planner or a view builder.
 *
 * Three kinds of caller:
 * - signed-in users (facilitator, operator, officer): bearer token from the Next proxy;
 * - farmers: a phone session (bearer token typ "farmer-session") on /farmer/* only: they read their
 *   own fields and book new ones for their own phone, nothing else;
 * - anyone holding a slot link: /slot/:token, scoped to the one field (and link version) it names.
 * No response from a slot, officer or public route ever contains a phone number.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  bookingInputSchema,
  dateToDay,
  demoPersonaSchema,
  farmerAccountInputSchema,
  farmerOtpRequestSchema,
  farmerOtpVerifySchema,
  fieldRequestInputSchema,
  type FarmerVillageOption,
  waitingLimitInputSchema,
  localeSchema,
  moveInputSchema,
  onboardingInputSchema,
  proofResultsSchema,
  type ChcOption,
  type Locale,
  type Me,
  type ProofResults,
  type Why,
} from "./shared";
import type { AppDependencies } from "./app";
import { mintDemoToken, AuthError, type Principal } from "./auth/tokens";
import { exchangeFarmerLogin, mintFarmerLoginLink, verifyFarmerSession, type FarmerPhonePrincipal } from "./auth/farmer-session";
import { createFarmerAccount, createFarmerOtp, isRefusal } from "./auth/farmer-otp";
import { assertCurrentLink, mintSlotToken, verifySlotToken } from "./auth/slot-token";
import { authorize, fieldResource, type Action, type Resource } from "./authz/cedar";
import { DEMO_CHC_ID, DEMO_FARMER_PHONE, DEMO_USERS } from "./demo/seed";
import { NotFoundError } from "./domain/planner";
import { bookFieldForPhone } from "./domain/farmer-booking";
import type { FieldRecord } from "./store/types";
import { buildBoard, buildBookedFields, buildFarmerPhoneHome, buildOfficerOverview, buildOneFarmerField, buildPlanView, buildQueue } from "./domain/views";
import { loadDistrictOutlines } from "./data/boundaries";
import { explainField as explainFieldFor } from "./domain/why";
import { clientRateLimit } from "./http/client-ip";

export class ForbiddenError extends Error {
  constructor(readonly errors: string[] = []) {
    super("forbidden");
  }
}

// A farmer booking themselves may hold this many fields that are not yet sown.

type AuthedRequest = Request & { principal: Principal };
type FarmerRequest = Request & { farmer: FarmerPhonePrincipal };

const asyncHandler =
  <Incoming extends Request = AuthedRequest>(handler: (request: Incoming, response: Response) => Promise<void>): RequestHandler =>
  (request, response, next: NextFunction) => {
    handler(request as Incoming, response).catch(next);
  };

function requireCedar(principal: Principal | FarmerPhonePrincipal, action: Action, resource: Resource): void {
  const decision = authorize(principal, action, resource);
  if (!decision.allowed) throw new ForbiddenError(decision.errors);
}

function requireChc(principal: Principal): string {
  if (!principal.chcId) throw new ForbiddenError(["principal has no CHC"]);
  return principal.chcId;
}

const bearerOf = (request: Request): string => {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
};

/** ?date=YYYY-MM-DD: which plan day the lanes show (anything else is ignored). */
const dateOf = (request: Request): string | undefined => {
  const date = request.query.date;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
};

/** The language for server-phrased sentences (?lang=en|pa|hi; English if missing or unknown). */
const localeOf = (request: Request): Locale => localeSchema.catch("en").parse(request.query.lang);

export function buildRoutes(dependencies: AppDependencies): Router {
  // Read store and planner through `dependencies` on every request: a demo reset swaps them.
  const { config, engine } = dependencies;
  const router = Router();

  // Per-client limits (the Next proxy vouches for the browser's address; see http/client-ip.ts).
  const slotLimiter = clientRateLimit(config, config.SLOT_RATE_LIMIT_PER_MINUTE);
  const demoLimiter = clientRateLimit(config, 20);
  const farmerLoginLimiter = clientRateLimit(config, 20);
  const farmerCodeLimiter = clientRateLimit(config, 10);
  const farmerOtp = createFarmerOtp(() => ({ config, store: dependencies.store, sender: dependencies.whatsapp.sender }));

  const authenticate: RequestHandler = (request, _response, next) => {
    const token = bearerOf(request);
    if (!token) return next(new AuthError("missing bearer token"));
    dependencies.verifier
      .verify(token)
      .then((principal) => {
        (request as AuthedRequest).principal = principal;
        next();
      })
      .catch(next);
  };

  // A farmer's phone session: accepted on /farmer/* only, and nothing else accepts it.
  const authenticateFarmer: RequestHandler = (request, _response, next) => {
    const token = bearerOf(request);
    if (!token) return next(new AuthError("missing farmer session"));
    verifyFarmerSession(config, token)
      .then((farmer) => {
        (request as FarmerRequest).farmer = farmer;
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
        today: config.DATE_TODAY,
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

  // Demo accounts, for anyone who wants to try Vaari (rate-limited; the data they see is simulated).
  // Facilitator, operator and officer get a session for their seeded user. The farmer has no
  // account: they get a one-time phone login link, minted by the same function the WhatsApp bot
  // calls, and the web follows it like a farmer would.
  router.post(
    "/auth/demo",
    demoLimiter,
    asyncHandler(async (request, response) => {
      const { role: persona } = z.object({ role: demoPersonaSchema }).parse(request.body);
      if (persona === "farmer") {
        const link = await mintFarmerLoginLink(config, dependencies.store, DEMO_FARMER_PHONE);
        response.json({ persona, loginPath: link.path });
        return;
      }
      const user = await dependencies.store.getUser(DEMO_USERS[persona]);
      if (!user) throw new NotFoundError("demo user not seeded");
      const minted = await mintDemoToken(config, user);
      response.json({ persona, accessToken: minted.token, expiresIn: minted.expiresIn, role: persona });
    }),
  );

  // --- Session ------------------------------------------------------------------------------

  // Onboarding is needed until the user has a role and the CHC that role works with.
  const needsOnboarding = (principal: Principal) => !principal.role || (principal.role !== "officer" && !principal.chcId);

  const meFor = async (principal: Principal): Promise<Me> => {
    const [user, chc] = await Promise.all([
      dependencies.store.getUser(principal.userId),
      principal.chcId ? dependencies.store.getChc(principal.chcId) : Promise.resolve(null),
    ]);
    return {
      userId: principal.userId,
      name: principal.name,
      role: principal.role,
      chcId: principal.chcId,
      chcName: chc?.name ?? null,
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
      // Operator access comes only from the Cognito "operator" group (team decision, 2026-10-10).
      if (input.role === "operator" && principal.role !== "operator") {
        throw new ForbiddenError(["operator access needs the Cognito operator group"]);
      }
      const chc = await dependencies.store.getChc(input.chcId);
      if (!chc) throw new NotFoundError("CHC not found");
      await dependencies.store.putUser({ userId: principal.userId, name: input.name, role: input.role, chcId: chc.id, language: input.language });
      const updated = await dependencies.verifier.verify(bearerOf(request));
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

  // --- Farmer (phone session) -----------------------------------------------------------------

  // The web exchanges a one-time login link (GET /farmer/login/:token on the web) for a 7-day phone
  // session. The token travels in the body, so it never appears in a URL the API logs.
  router.post(
    "/farmer/login",
    farmerLoginLimiter,
    asyncHandler<Request>(async (request, response) => {
      const { token } = z.object({ token: z.string().min(1).max(2048) }).parse(request.body);
      response.json(await exchangeFarmerLogin(config, dependencies.store, token));
    }),
  );

  // Sign-in with a one-time code (auth/farmer-otp.ts): ask for a code with the phone alone, then
  // trade it for the same 7-day phone session (and whether Vaari knows the phone). The web's own
  // route handler keeps the session in an httpOnly cookie.
  router.post(
    "/farmer/otp/request",
    farmerCodeLimiter,
    asyncHandler<Request>(async (request, response) => {
      const result = await farmerOtp.request(farmerOtpRequestSchema.parse(request.body));
      if (isRefusal(result)) {
        const { status, ...body } = result;
        response.status(status).json(body);
        return;
      }
      response.json(result);
    }),
  );

  router.post(
    "/farmer/otp/verify",
    farmerCodeLimiter,
    asyncHandler<Request>(async (request, response) => {
      const { phone, code } = farmerOtpVerifySchema.parse(request.body);
      const result = await farmerOtp.verify(phone, code);
      if (isRefusal(result)) {
        const { status, ...body } = result;
        response.status(status).json(body);
        return;
      }
      response.json(result);
    }),
  );

  // Every field booked with this phone, in any CHC: status, promise and history.
  router.get(
    "/farmer/home",
    authenticateFarmer,
    asyncHandler<FarmerRequest>(async (request, response) => {
      const [fields, account] = await Promise.all([dependencies.store.listFieldsByPhone(request.farmer.phone), dependencies.store.getFarmerAccount(request.farmer.phone)]);
      for (const field of fields) requireCedar(request.farmer, "ViewField", fieldResource(field));
      const home = await buildFarmerPhoneHome(dependencies.planner, dependencies.store, fields, localeOf(request));
      response.json(account ? { ...home, registered: true, farmerName: account.name } : home);
    }),
  );

  // Who this phone session belongs to, for the dashboard's frame: a name once there is one. Never
  // the phone number (the browser never needs it back).
  router.get(
    "/farmer/me",
    authenticateFarmer,
    asyncHandler<FarmerRequest>(async (request, response) => {
      const account = await dependencies.store.getFarmerAccount(request.farmer.phone);
      if (account) {
        response.json({ name: account.name, registered: true });
        return;
      }
      // A phone a helper booked for is known by that booking's name until it registers.
      const booked = await dependencies.store.listFieldsByPhone(request.farmer.phone);
      response.json({ name: booked[0]?.farmerName ?? null, registered: booked.length > 0 });
    }),
  );

  // A new farmer finishes signing up after their code: their name and their own consent. A phone
  // that already has an account (or a helper's booking) keeps it as it is: 200, nothing renamed.
  router.post(
    "/farmer/account",
    authenticateFarmer,
    asyncHandler<FarmerRequest>(async (request, response) => {
      const input = farmerAccountInputSchema.parse(request.body);
      if (input.consent !== true) {
        response.status(400).json({ error: "CONSENT_REQUIRED" });
        return;
      }
      const { account, created } = await createFarmerAccount(dependencies.store, request.farmer.phone, input.name, input.language);
      response.status(created ? 201 : 200).json({ name: account.name });
    }),
  );

  // What a farmer may book themselves: every village a machine centre serves, and today's date.
  router.get(
    "/farmer/booking-options",
    authenticateFarmer,
    asyncHandler<FarmerRequest>(async (_request, response) => {
      const villagesById = new Map(dependencies.planner.villages().map((village) => [village.id, village]));
      const options = new Map<string, FarmerVillageOption>();
      for (const chc of await dependencies.store.listChcs()) {
        for (const villageId of chc.villageIds) {
          const village = villagesById.get(villageId);
          if (village && !options.has(villageId)) options.set(villageId, { id: village.id, name: village.name, namePa: village.namePa, chcId: chc.id, chcName: chc.name });
        }
      }
      response.json({
        today: dependencies.planner.dayToIso(dependencies.planner.today()),
        villages: [...options.values()].sort((left, right) => left.name.localeCompare(right.name)),
      });
    }),
  );

  // A farmer books a field for their own phone (the "new booking" on /farmer). The phone comes from
  // the session, the name and consent from their account; the centre is the one that serves the
  // village. Like a helper's booking, it gets a date when the operator publishes a plan.
  router.post(
    "/farmer/fields",
    authenticateFarmer,
    asyncHandler<FarmerRequest>(async (request, response) => {
      const input = fieldRequestInputSchema.parse(request.body);
      const booked = await bookFieldForPhone(dependencies, request.farmer, input, localeOf(request));
      if (!booked.ok) {
        if (booked.error === "NO_CENTRE") throw new NotFoundError("no machine centre serves this village");
        if (booked.error === "FORBIDDEN") throw new ForbiddenError(booked.reasons);
        const status = { NOT_REGISTERED: 403, TOO_MANY_FIELDS: 409, READY_DATE_OUT_OF_RANGE: 400 }[booked.error];
        response.status(status).json({ error: booked.error });
        return;
      }
      const { field } = booked;
      const token = await mintSlotToken(config, field);
      response.status(201).json({
        field: await buildOneFarmerField(dependencies.planner, dependencies.store, field, localeOf(request)),
        slot: { token, path: `/slot/${token}` },
      });
    }),
  );

  router.get(
    "/farmer/fields/:chcId/:fieldId/why",
    authenticateFarmer,
    asyncHandler<FarmerRequest>(async (request, response) => {
      const field = await dependencies.store.getField(String(request.params.chcId), String(request.params.fieldId));
      if (!field) throw new NotFoundError("field not found");
      requireCedar(request.farmer, "AskWhy", fieldResource(field));
      response.json(await explainField(field, localeOf(request)));
    }),
  );

  // --- Booking ------------------------------------------------------------------------------

  // A facilitator books for a farmer, who has no account: name, phone (stored as E.164) and the
  // farmer's consent to be contacted on it, which the facilitator records. The field is stored as a
  // request at once; it gets a date when the operator publishes a plan. The answer carries the
  // farmer's slot link (no phone in it).
  router.post(
    "/fields",
    authenticate,
    asyncHandler(async (request, response) => {
      const { principal } = request;
      const chcId = requireChc(principal);
      requireCedar(principal, "RequestField", { type: "Chc", id: chcId });
      const input = bookingInputSchema.parse(request.body);
      if (input.consent !== true) {
        response.status(400).json({ error: "CONSENT_REQUIRED" });
        return;
      }
      const today = dependencies.planner.today();
      const readyDay = dateToDay(config.SEASON_START_DATE, input.readyDate);
      if (readyDay < today - 7 || readyDay > today + 30) {
        response.status(400).json({ error: "READY_DATE_OUT_OF_RANGE" });
        return;
      }
      const farmerId = `farmer-${randomUUID().slice(0, 8)}`;
      await dependencies.store.putFarmer({ id: farmerId, name: input.farmerName, phone: input.farmerPhone, language: "pa", facilitatorId: principal.userId });
      const field = await dependencies.planner.requestField(
        chcId,
        {
          farmerId,
          farmerName: input.farmerName,
          bookedBy: principal.userId,
          farmerPhone: input.farmerPhone,
          consentAt: new Date().toISOString(),
          consentBy: principal.userId,
        },
        input,
      );
      const token = await mintSlotToken(config, field);
      response.status(201).json({
        field: await buildOneFarmerField(dependencies.planner, dependencies.store, field, localeOf(request)),
        slot: { token, path: `/slot/${token}` },
      });
    }),
  );

  // "Why this date?" from the solver's own reasons (domain/why.ts), shared with the WhatsApp agent.
  const explainField = (field: FieldRecord, locale: Locale): Promise<Why> =>
    explainFieldFor({ planner: dependencies.planner, store: dependencies.store, engine }, field, locale);

  /** A field in the caller's CHC (fields are keyed by chcId + fieldId: a direct GetItem). */
  const callerField = async (principal: Principal, fieldId: string): Promise<FieldRecord> => {
    const field = await dependencies.store.getField(requireChc(principal), fieldId);
    if (!field) throw new NotFoundError("field not found");
    return field;
  };

  router.get(
    "/fields/:fieldId/why",
    authenticate,
    asyncHandler(async (request, response) => {
      const field = await callerField(request.principal, String(request.params.fieldId));
      requireCedar(request.principal, "AskWhy", fieldResource(field));
      response.json(await explainField(field, localeOf(request)));
    }),
  );

  // The field's current slot link (copy it again from the booked list).
  router.get(
    "/fields/:fieldId/slot-link",
    authenticate,
    asyncHandler(async (request, response) => {
      const field = await callerField(request.principal, String(request.params.fieldId));
      requireCedar(request.principal, "ViewField", fieldResource(field));
      const token = await mintSlotToken(config, field);
      response.json({ token, path: `/slot/${token}` });
    }),
  );

  // A new slot link for a field (lost or shared too widely): every older link stops working.
  router.post(
    "/fields/:fieldId/slot-link/reissue",
    authenticate,
    asyncHandler(async (request, response) => {
      const field = await callerField(request.principal, String(request.params.fieldId));
      requireCedar(request.principal, "ReissueLink", fieldResource(field));
      const reissued = await dependencies.planner.reissueLink(field.chcId, field.id);
      const token = await mintSlotToken(config, reissued);
      response.json({ token, path: `/slot/${token}` });
    }),
  );

  // --- Slot link (no sign-in) ------------------------------------------------------------------

  // The slot token is the permission: it names exactly one field (chcId + fieldId, from the token
  // only; nothing in the path, query or body can point elsewhere) and its current link version.
  const fieldFromSlot = async (token: string): Promise<FieldRecord> => {
    const claims = await verifySlotToken(config, token);
    const field = await dependencies.store.getField(claims.chcId, claims.fieldId);
    if (!field) throw new NotFoundError("field not found");
    assertCurrentLink(claims, field);
    return field;
  };

  router.get(
    "/slot/:token",
    slotLimiter,
    asyncHandler(async (request, response) => {
      const field = await fieldFromSlot(String(request.params.token));
      response.json(await buildOneFarmerField(dependencies.planner, dependencies.store, field, localeOf(request)));
    }),
  );

  router.get(
    "/slot/:token/why",
    slotLimiter,
    asyncHandler(async (request, response) => {
      const field = await fieldFromSlot(String(request.params.token));
      response.json(await explainField(field, localeOf(request)));
    }),
  );

  // "I cannot wait longer": the one change a slot link can make. Only shortens the wait; marks the
  // field for the operator and re-plans the draft with the operator's moves kept.
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
      const visible = booked.filter((field) => authorize(principal, "ViewField", fieldResource(field)).allowed);
      response.json({ today: dependencies.planner.dayToIso(dependencies.planner.today()), items: await buildBookedFields(dependencies.planner, dependencies.store, visible) });
    }),
  );

  // --- Officer ------------------------------------------------------------------------------

  // The district at a glance: counts per centre, per village and per day ahead. Cedar is asked for
  // every centre (ViewAggregates); a centre the officer may not see is left out, never half shown.
  router.get(
    "/officer/overview",
    authenticate,
    asyncHandler(async (request, response) => {
      const { principal } = request;
      if (principal.role !== "officer") throw new ForbiddenError(["not an officer"]);
      const chcs = (await dependencies.store.listChcs()).filter((chc) => authorize(principal, "ViewAggregates", { type: "Chc", id: chc.id }).allowed);
      response.json(
        await buildOfficerOverview(dependencies.planner, dependencies.store, chcs, {
          optimumLastDate: config.OPTIMUM_LAST_DATE,
          districts: loadDistrictOutlines(config.DATA_DIR),
        }),
      );
    }),
  );

  // --- Operator -----------------------------------------------------------------------------

  router.get(
    "/operator/board",
    authenticate,
    asyncHandler(async (request, response) => {
      const chcId = requireChc(request.principal);
      requireCedar(request.principal, "ViewBoard", { type: "Chc", id: chcId });
      response.json(await buildBoard(dependencies.planner, dependencies.store, chcId, dateOf(request)));
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
      response.json(await buildPlanView(dependencies.planner, dependencies.store, chcId, dateOf(request)));
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
      const { changes } = await dependencies.planner.approvePlan(chcId, version, request.principal.name);
      // Farmers whose promise changed hear about it on WhatsApp (consented numbers only; in the background).
      dependencies.whatsapp.notifier.planPublished(chcId, changes);
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
      // Only the demo centre has a demo season to reset; a real centre's records are never wiped.
      if (chcId !== DEMO_CHC_ID) throw new ForbiddenError(["only the demo centre can be reset"]);
      await dependencies.resetDemo();
      response.json(await buildBoard(dependencies.planner, dependencies.store, chcId));
    }),
  );

  return router;
}
