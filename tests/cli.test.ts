import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const dataDirs: string[] = [];

afterEach(() => {
  for (const dir of dataDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runCli(...args: string[]) {
  const dataDir = mkdtempSync(join(tmpdir(), "marshal-cli-test-"));
  dataDirs.push(dataDir);
  return spawnSync(
    process.execPath,
    ["--experimental-sqlite", "--import", "tsx", "src/cli.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, MARSHAL_DATA_DIR: dataDir },
    },
  );
}

describe("CLI smoke tests", () => {
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
