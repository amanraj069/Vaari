import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite 8 compiles with oxc; Next's tsconfig says jsx "preserve", so set the React runtime here.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.tsx", "test/**/*.test.ts"],
  },
});
