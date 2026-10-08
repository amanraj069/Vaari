/** The frontend validates responses with a copy of src/shared. Run `npm run contract:sync` if this fails. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = path.resolve(__dirname, "../src/shared");
const target = path.resolve(__dirname, "../../frontend/src/shared");
const HEADER = "// GENERATED from backend/src/shared by `npm run contract:sync` in backend/. Do not edit here.\n";

describe("frontend contract copy", () => {
  it.skipIf(!existsSync(target))("matches backend/src/shared exactly", () => {
    for (const file of readdirSync(source).filter((name) => name.endsWith(".ts"))) {
      const expected = HEADER + readFileSync(path.join(source, file), "utf8");
      expect(readFileSync(path.join(target, file), "utf8"), file).toBe(expected);
    }
  });
});
