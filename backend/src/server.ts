/**
 * Entry point. Wires config, store, engine client, token verifier and planner, seeds the demo
 * season (in demo mode), makes the first plan, then listens.
 */
import { createApp, logger } from "./app";
import { loadConfig } from "./config";
import { createTokenVerifier } from "./auth/tokens";
import { createEngineClient } from "./engine/client";
import { DEMO_CHC_ID, seedDemo } from "./demo/seed";
import { Planner } from "./domain/planner";
import { MemoryStore } from "./store/memory";
import type { VaariStore } from "./store/types";

export async function buildRuntime() {
  const config = loadConfig();
  if (config.STORE_MODE === "dynamodb") throw new Error("STORE_MODE=dynamodb is not wired yet; use memory");
  let store: VaariStore = new MemoryStore();
  const engine = createEngineClient(config);
  let planner = new Planner(store, engine, config);
  const verifierHolder = { current: createTokenVerifier(config, store) };

  const dependencies = {
    config,
    get store() {
      return store;
    },
    engine,
    get planner() {
      return planner;
    },
    verifier: { verify: (token: string) => verifierHolder.current.verify(token) },
    async resetDemo() {
      const fresh = new MemoryStore();
      await seedDemo(fresh, config);
      const freshPlanner = new Planner(fresh, engine, config);
      await freshPlanner.replan(DEMO_CHC_ID, "new_request");
      store = fresh;
      planner = freshPlanner;
      verifierHolder.current = createTokenVerifier(config, fresh);
    },
  };
  if (config.DEMO_MODE) await dependencies.resetDemo();
  return { config, dependencies };
}

if (process.env.NODE_ENV !== "test") {
  const started = Date.now();
  const { config, dependencies } = await buildRuntime();
  createApp(dependencies).listen(config.PORT, () => {
    logger.info({ port: config.PORT, engineMode: config.ENGINE_MODE, authMode: config.AUTH_MODE, startupMs: Date.now() - started }, "vaari api listening");
  });
}
