/**
 * Entry point. Wires config, store (REPO=memory|dynamo), engine client, token verifier and
 * planner; seeds the demo centre (its season and demo accounts) and the simulated district around
 * it if they are not there yet; then listens.
 */
import { createApp, logger } from "./app";
import { loadConfig } from "./config";
import { createTokenVerifier } from "./auth/tokens";
import { createEngineClient } from "./engine/client";
import { approveForSimulatedOperator, bookDistrictDay, districtCentreIds, lastDistrictChcId, seedDistrict } from "./demo/district";
import { DEMO_CHC_ID, DEMO_OFFICER_DISTRICT, DEMO_OPERATOR_NAME, DEMO_USERS, seedDemo } from "./demo/seed";
import { Planner } from "./domain/planner";
import { createStore } from "./store";
import { logProcessFailures } from "./logger";
import { buildWhatsApp, whatsappSetupProblems } from "./whatsapp";

export async function buildRuntime(options: { freshDemo?: boolean; district?: boolean; whatsapp?: Parameters<typeof buildWhatsApp>[1]; config?: Partial<ReturnType<typeof loadConfig>> } = {}) {
  const config = { ...loadConfig(), ...options.config };
  const store = createStore(config);
  const engine = createEngineClient(config);
  const planner = new Planner(store, engine, config);

  const dependencies = {
    config,
    store,
    engine,
    planner,
    verifier: createTokenVerifier(config, store),
    whatsapp: buildWhatsApp({ config, store, planner, engine }, options.whatsapp),
    /**
     * "Reset demo season": back to DATE_TODAY. Re-seeds the demo CHC (its machines, fields, promises,
     * plans, work logs); if the season had moved on, or the officer had lent machines between the
     * simulated centres, the district is re-seeded and re-planned too, so every centre is on the same
     * day again. Users and farmers are not deleted: real (Google) users keep their profiles.
     */
    async resetDemo() {
      // End the demo centre's loans first, so no other centre is left lending to (or holding a
      // machine of) a season that is about to be wiped.
      if (await store.getChc(DEMO_CHC_ID)) {
        const loanIds = new Set((await store.listMachines(DEMO_CHC_ID)).flatMap((machine) => (machine.loan ? [machine.loan.loanId] : [])));
        for (const loanId of loanIds) {
          const ended = await planner.endLoan(loanId);
          for (const plan of [ended.lenderPlan, ended.borrowerPlan]) await approveForSimulatedOperator(planner, plan);
        }
      }
      const seasonMoved = (await store.getSeasonDayOffset()) > 0;
      await planner.resetClock();
      await store.clearChcData(DEMO_CHC_ID);
      await seedDemo(store, config, config.DATE_TODAY);
      // The season is already running: start as if the operator published a plan last evening.
      await planner.publishInitialPlan(DEMO_CHC_ID, DEMO_OPERATOR_NAME);
      const districtIds = await districtCentreIds(store);
      const districtLoans = (await Promise.all(districtIds.map((id) => store.listMachines(id)))).some((machines) => machines.some((machine) => machine.loan));
      if (districtIds.length > 0 && (seasonMoved || districtLoans)) {
        const demoCentre = await store.getChc(DEMO_CHC_ID);
        await seedDistrict(store, config, config.DATE_TODAY, new Set(demoCentre?.villageIds ?? []), { rewrite: true });
        await planDistrict(districtIds);
      }
    },
    /**
     * "Start tomorrow" (the demo centre's operator, once today is recorded and tomorrow's plan is
     * approved). Each simulated centre's simulated operator records its day (every field planned
     * today sown) and approves its plan for tomorrow; then the site's today moves on one day for
     * everyone; then the farmers who asked on the new day in the simulator's season book.
     */
    async startNextDay() {
      const simulated = new Planner(store, engine, { ...config, ENGINE_METHOD: "search" });
      await simulated.refreshClock();
      for (const chcId of await districtCentreIds(store)) {
        const work = await simulated.todaysWork(chcId);
        const plan = await simulated.recordDay(chcId, work.stops.map((stop) => ({ fieldId: stop.field.id, sown: true })));
        await approveForSimulatedOperator(simulated, plan);
      }
      await planner.advanceDay();
      await bookDistrictDay(store, config, planner.dayToIso(planner.today()));
    },
  };
  // The district's plans: the search planner (seeded, about a second per centre), since CP-SAT's
  // time limit times 24 centres would hold the API back for minutes.
  async function planDistrict(centreIds: string[]) {
    const seedPlanner = new Planner(store, engine, { ...config, ENGINE_METHOD: "search" });
    await seedPlanner.refreshClock();
    for (const chcId of centreIds) {
      if (!(await store.latestApprovedPlan(chcId))) await seedPlanner.publishInitialPlan(chcId, "Simulated operator");
    }
  }
  await planner.refreshClock();
  // With DynamoDB the season survives restarts: seed only when the demo CHC does not exist yet.
  if (options.freshDemo || !(await store.getChc(DEMO_CHC_ID))) await dependencies.resetDemo();
  // A season seeded before officers had a district keeps its demo officer: give it its district,
  // or Cedar (deny by default) would show that officer no centre at all.
  const demoOfficer = await store.getUser(DEMO_USERS.officer);
  if (demoOfficer && demoOfficer.district !== DEMO_OFFICER_DISTRICT) await store.putUser({ ...demoOfficer, district: DEMO_OFFICER_DISTRICT });
  // The other 24 simulated centres, for the officer's district. Tests skip them unless they ask
  // (each centre's first plan is a solve), so every other test file starts as fast as before.
  if ((options.district ?? config.NODE_ENV !== "test") && !(await store.latestApprovedPlan(lastDistrictChcId(config)))) {
    const demoCentre = await store.getChc(DEMO_CHC_ID);
    // Seeded on the season's current day (a restart after "Start tomorrow" keeps that day).
    await planDistrict(await seedDistrict(store, config, planner.dayToIso(planner.today()), new Set(demoCentre?.villageIds ?? [])));
  }
  return { config, dependencies };
}

if (process.env.NODE_ENV !== "test") {
  logProcessFailures("api");
  const started = Date.now();
  const { config, dependencies } = await buildRuntime().catch((error: unknown) => {
    logger.fatal({ err: error }, "vaari api could not start");
    process.exit(1);
  });
  createApp(dependencies).listen(config.PORT, () => {
    logger.info(
      {
        port: config.PORT,
        engineMode: config.ENGINE_MODE,
        authMode: config.AUTH_MODE,
        repo: config.REPO,
        tablePrefix: config.REPO === "dynamo" ? config.TABLE_PREFIX : undefined,
        // Where a webhook goes: answered here (memory) or queued for `npm run worker` (sqs).
        whatsapp: config.WHATSAPP_ENABLED ? `on, queue ${config.WHATSAPP_QUEUE}${config.WHATSAPP_QUEUE === "sqs" ? " (replies need the worker running)" : ""}` : "off (webhook answers 404)",
        agent: config.AGENT_ENABLED,
        logLevel: logger.level,
        startupMs: Date.now() - started,
      },
      "vaari api listening",
    );
    for (const problem of whatsappSetupProblems(config)) logger.warn(problem);
  });
}
