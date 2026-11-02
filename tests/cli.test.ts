import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const dataDirs: string[] = [];

afterEach(() => {
  for (const dir of dataDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runCliWithRegistry(registered: boolean, ...args: string[]) {
  const dataDir = mkdtempSync(join(tmpdir(), "marshal-cli-test-"));
  dataDirs.push(dataDir);
  if (registered)
    writeFileSync(
      join(dataDir, "registry.json"),
      JSON.stringify({
        demo: { name: "demo", path: dataDir, files: 1, chunks: 1, indexedAt: "test" },
      }),
    );
  return spawnSync(
    process.execPath,
    ["--experimental-sqlite", "--import", "tsx", "src/cli.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MARSHAL_DATA_DIR: dataDir,
        JIRA_BASE_URL: "",
        JIRA_EMAIL: "",
        JIRA_TOKEN: "",
      },
    },
  );
}

function runCli(...args: string[]) {
  return runCliWithRegistry(false, ...args);
}

describe("CLI smoke tests", () => {
  it.each(["0", "-1", "1.5", "NaN", "101", "12oops"])(
    "rejects invalid --top-k before retrieval: %s",
    (value) => {
      const result = runCli("triage", "Cart is wrong", "--top-k", value);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("integer between 1 and 100");
    },
  );

  it.each(["route", "rewrite-ticket", "triage"])(
    "%s rejects malformed input before retrieval",
    (command) => {
      const missing = runCliWithRegistry(true, command, "missing-marshal-ticket.json");
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain("Ticket file not found");
      const jira = runCliWithRegistry(true, command, "PROJ-1");
      expect(jira.status).toBe(1);
      expect(jira.stderr).toContain("JIRA_BASE_URL, JIRA_EMAIL and JIRA_TOKEN");
    },
  );

  it("describes drafts and heuristic confidence in command help", () => {
    expect(runCli("route", "--help").stdout).toContain("heuristic confidence");
    expect(runCli("rewrite-ticket", "--help").stdout).toContain("reviewable draft");
  });

  it("lists the supported commands in help output", () => {
    const result = runCli("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("index");
    expect(result.stdout).toContain("route");
    expect(result.stdout).toContain("rewrite-ticket");
    expect(result.stdout).toContain("triage");
  });

  it.each(["route", "rewrite-ticket", "triage"])(
    "%s gives an actionable message before any repo is indexed",
    (command) => {
      const result = runCli(command, "PROJ-1");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("No repos indexed yet");
      expect(result.stderr).toContain("marshal index");
    },
  );
});
