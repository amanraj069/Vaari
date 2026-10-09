/**
 * Entry point. Wires config, store (REPO=memory|dynamo), engine client, token verifier and
 * planner; in demo mode seeds the demo season if it is not there yet; then listens.
 */
import { createApp, logger } from "./app";
import { loadConfig } from "./config";
import { createTokenVerifier } from "./auth/tokens";
import { createEngineClient } from "./engine/client";
import { DEMO_CHC_ID, DEMO_OPERATOR_NAME, seedDemo } from "./demo/seed";
import { Planner } from "./domain/planner";
import { createStore } from "./store";
import { buildWhatsApp } from "./whatsapp";

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
      await seedDemo(store, config);
      // The season is already running: start as if the operator published a plan last evening.
      await planner.publishInitialPlan(DEMO_CHC_ID, DEMO_OPERATOR_NAME);
    },
  };
  // With DynamoDB the season survives restarts: seed only when the demo CHC does not exist yet.
  if (config.DEMO_MODE && (options.freshDemo || !(await store.getChc(DEMO_CHC_ID)))) await dependencies.resetDemo();
  return { config, dependencies };
}

if (process.env.NODE_ENV !== "test") {
  const started = Date.now();
  const { config, dependencies } = await buildRuntime();
  createApp(dependencies).listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, engineMode: config.ENGINE_MODE, authMode: config.AUTH_MODE, repo: config.REPO, tablePrefix: config.REPO === "dynamo" ? config.TABLE_PREFIX : undefined, startupMs: Date.now() - started },
      "vaari api listening",
    );
  });
}
