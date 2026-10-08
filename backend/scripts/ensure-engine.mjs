// Runs before `npm run dev` / `npm start`: makes sure the Python engine can be spawned locally.
// With ENGINE_MODE=http the engine is a separate service and nothing is needed here.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engineDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../engine");
const python = process.env.ENGINE_PYTHON ?? path.join(engineDirectory, ".venv/bin/python");

if (process.env.ENGINE_MODE === "http" || existsSync(python)) process.exit(0);

console.log("[vaari] Setting up the Python engine (first run only)…");
const uv = spawnSync("uv", ["sync"], { cwd: engineDirectory, stdio: "inherit" });
if (uv.error || uv.status !== 0) {
  console.error(
    "\n[vaari] Could not set up the engine. Install uv (https://docs.astral.sh/uv/), then run `npm run engine:setup`.\n" +
      "        uv downloads Python 3.12 and OR-Tools for you.",
  );
  process.exit(1);
}
