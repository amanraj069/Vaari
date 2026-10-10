/**
 * Entry point. Wires config, store (REPO=memory|dynamo), engine client, token verifier and
 * planner; seeds the demo centre (its season and demo accounts) if it is not there yet; then listens.
 */
import { createApp, logger } from "./app";
import { loadConfig } from "./config";
import { createTokenVerifier } from "./auth/tokens";
import { createEngineClient } from "./engine/client";
import { DEMO_CHC_ID, DEMO_OPERATOR_NAME, seedDemo } from "./demo/seed";
import { Planner } from "./domain/planner";
import { createStore } from "./store";
import { logProcessFailures } from "./logger";
import { buildWhatsApp, whatsappSetupProblems } from "./whatsapp";

export async function buildRuntime(options: { freshDemo?: boolean; whatsapp?: Parameters<typeof buildWhatsApp>[1]; config?: Partial<ReturnType<typeof loadConfig>> } = {}) {
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
     * Re-seeds only the demo CHC (its machines, fields, promises, plans, work logs). Users and
     * farmers are not deleted, so real (Google) users keep their profiles across a reset.
     */
    async resetDemo() {
      await store.clearChcData(DEMO_CHC_ID);
      await seedDemo(store, config, config.DATE_TODAY);
      // The season is already running: start as if the operator published a plan last evening.
      await planner.publishInitialPlan(DEMO_CHC_ID, DEMO_OPERATOR_NAME);
    },
  };
  // With DynamoDB the season survives restarts: seed only when the demo CHC does not exist yet.
  if (options.freshDemo || !(await store.getChc(DEMO_CHC_ID))) await dependencies.resetDemo();
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
