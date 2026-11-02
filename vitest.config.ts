import { defineConfig } from "vitest/config";

/**
 * Vitest config — ai-starter standard, plus the `node:sqlite` handling Quarry
 * needs.
 *
 * Keep SQLite imports external and launch forked test processes with
 * `--experimental-sqlite`. Unit tests use fakes; indexing regression tests
 * exercise real SQLite stores with fixed offline embeddings.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    globals: true,
    pool: "forks",
    // Forked processes need the SQLite flag too.
    execArgv: ["--experimental-sqlite"],
    server: {
      deps: { external: ["node:sqlite", "sqlite", /sqlite-vec/] },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**"],
      exclude: ["dist/**", "build/**", "scripts/**", "tests/**", "**/*.config.*", "**/*.d.ts"],
      // Agreed regression floors after the correctness follow-ups.
      // `pnpm coverage` enforces these globally, both pre-push and in CI.
      thresholds: {
        statements: 70,
        branches: 82,
        functions: 76,
        lines: 68,
      },
    },
  },
  ssr: {
    external: ["node:sqlite", "sqlite", "sqlite-vec"],
  },
});
