import { defineConfig } from "vitest/config";

/**
 * Vitest config — ai-starter standard, plus the `node:sqlite` handling Quarry
 * needs.
 *
 * Quarry (our retrieval engine) uses Node's built-in `node:sqlite`, which is
 * newer than Vite's bundled builtin list, so Vite tries to bundle it and fails.
 * We externalise it (prefixed + bare) and run tests in forked Node processes
 * launched with `--experimental-sqlite` so the real builtin is used. The unit
 * tests here mock retrieval and never touch SQLite, but this keeps the door open
 * to exercising the real adapter without reconfiguring.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    globals: true,
    pool: "forks",
    // Vitest 4 flattened `poolOptions.forks.*` to top-level options.
    execArgv: ["--experimental-sqlite"],
    server: {
      deps: { external: ["node:sqlite", "sqlite", /sqlite-vec/] },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**"],
      exclude: ["dist/**", "build/**", "scripts/**", "tests/**", "**/*.config.*", "**/*.d.ts"],
      // Ratchet: thresholds sit at/just below current measured coverage to stop
      // regression. Measured 2026-06-29: stmts 44.02 / branch 76.62 / funcs
      // 68.42 / lines 44.02. Bump these up as coverage improves; never down.
      thresholds: {
        statements: 44,
        branches: 76,
        functions: 68,
        lines: 44,
      },
    },
  },
  ssr: {
    external: ["node:sqlite", "sqlite", "sqlite-vec"],
  },
});
