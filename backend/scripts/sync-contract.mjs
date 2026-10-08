// Copies the API contract (src/shared) into the frontend, which validates every response with it.
// The backend is the source of truth; test/contract-sync.test.ts fails if the copies drift.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(backendRoot, "src/shared");
const target = path.resolve(backendRoot, "../frontend/src/shared");
export const HEADER = "// GENERATED from backend/src/shared by `npm run contract:sync` in backend/. Do not edit here.\n";

mkdirSync(target, { recursive: true });
for (const file of readdirSync(source).filter((name) => name.endsWith(".ts"))) {
  writeFileSync(path.join(target, file), HEADER + readFileSync(path.join(source, file), "utf8"));
  console.log(`synced ${file}`);
}
