/**
 * `npm run simulate:check`: the fast reproducibility check. Plays a small simulation twice with the
 * same seed (--runs 5 --centres 3, every scenario and sweep) into a temporary folder and compares
 * the two files byte for byte. Exit code 0 only when they are identical. It never touches
 * data/sim/results.json. Extra arguments are passed to both runs (e.g. -- --seed 7).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engineDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../engine");
const folder = mkdtempSync(path.join(tmpdir(), "vaari-simulate-check-"));
const extra = process.argv.slice(2);
const args = ["--runs", "5", "--centres", "3", "--seed", "1", ...extra];

function play(name) {
  const out = path.join(folder, `${name}.json`);
  const started = Date.now();
  const run = spawnSync("uv", ["run", "--quiet", "python", "-m", "vaari_engine", "simulate", ...args, "--out", out], { cwd: engineDirectory, stdio: ["ignore", "ignore", "inherit"] });
  if (run.status !== 0) {
    console.error(`simulate:check: run ${name} failed (exit ${run.status ?? run.signal})`);
    process.exit(1);
  }
  const bytes = readFileSync(out);
  return { bytes, seconds: (Date.now() - started) / 1000, sha256: createHash("sha256").update(bytes).digest("hex") };
}

try {
  console.log(`simulate:check: ${args.join(" ")}, twice`);
  const first = play("first");
  const second = play("second");
  const same = Buffer.compare(first.bytes, second.bytes) === 0;
  console.log(`  first  ${first.bytes.length} bytes  sha256 ${first.sha256}  ${first.seconds.toFixed(0)} s`);
  console.log(`  second ${second.bytes.length} bytes  sha256 ${second.sha256}  ${second.seconds.toFixed(0)} s`);
  console.log(same ? "  IDENTICAL: the same seed writes the same file" : "  DIFFERENT: the simulation is not reproducible");
  process.exitCode = same ? 0 : 1;
} finally {
  rmSync(folder, { recursive: true, force: true });
}
