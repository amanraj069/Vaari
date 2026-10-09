/**
 * GET /public/proof serves only the simulator's own results file: missing -> 404 NOT_RUN (the page
 * shows an empty state), malformed -> 500 (never patched), and a file the Python simulator really
 * writes passes the shared schema the page renders from (the Python -> TypeScript contract).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { buildRuntime } from "../src/server";
import { proofResultsSchema } from "../src/shared";

let runtime: Awaited<ReturnType<typeof buildRuntime>>;
const appWithData = (dataDir: string) => createApp({ ...runtime.dependencies, config: { ...runtime.dependencies.config, DATA_DIR: dataDir } });

beforeAll(async () => {
  runtime = await buildRuntime({ freshDemo: true });
});

describe("GET /public/proof", () => {
  it("answers 404 NOT_RUN when the simulation has not been run", async () => {
    const empty = mkdtempSync(path.join(tmpdir(), "vaari-proof-"));
    const response = await request(appWithData(empty)).get("/public/proof").expect(404);
    expect(response.body.error).toBe("NOT_RUN");
  });

  it("refuses a results file that does not match the schema", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "vaari-proof-"));
    mkdirSync(path.join(dataDir, "sim"));
    writeFileSync(path.join(dataDir, "sim", "results.json"), JSON.stringify({ schemaVersion: 4, scenarios: {} }));
    const response = await request(appWithData(dataDir)).get("/public/proof").expect(500);
    expect(response.body.error).toBe("RESULTS_INVALID");
  });

  it("serves what the Python simulator writes, unchanged", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "vaari-proof-"));
    const out = path.join(dataDir, "sim", "results.json");
    const { config } = runtime.dependencies;
    const run = spawnSync(config.ENGINE_PYTHON, ["-m", "vaari_engine", "simulate", "--runs", "2", "--sweep-runs", "1", "--seed", "3", "--workers", "2", "--centres", "2", "--out", out], {
      cwd: config.ENGINE_DIR,
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    const response = await request(appWithData(dataDir)).get("/public/proof").expect(200);
    const results = proofResultsSchema.parse(response.body);
    expect(results.simulated).toBe(true);
    expect(results.runs).toBe(2);
    expect(response.body).toEqual(JSON.parse(readFileSync(out, "utf8")));
  });

  it("the committed results file (if present) matches the schema", () => {
    const committed = path.join(runtime.dependencies.config.DATA_DIR, "sim", "results.json");
    if (!existsSync(committed)) return;
    expect(() => proofResultsSchema.parse(JSON.parse(readFileSync(committed, "utf8")))).not.toThrow();
  });
});
