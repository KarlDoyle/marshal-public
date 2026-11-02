import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTicket, ticketFromText } from "../src/ticket.js";

describe("ticketFromText", () => {
  it("synthesizes a thin ticket from a one-line problem description", () => {
    const t = ticketFromText("Cart total is wrong when a discount and tax both apply");
    expect(t.summary).toBe("Cart total is wrong when a discount and tax both apply");
    expect(t.key).toBe("ADHOC-1");
    expect(t.description).toBe("");
    expect(t.type).toBe("Task");
    expect(t.status).toBe("Open");
  });

  it("trims surrounding whitespace and rejects empty text", () => {
    expect(ticketFromText("  Login is broken  ").summary).toBe("Login is broken");
    expect(() => ticketFromText("   ")).toThrow(/empty/i);
  });
});

describe("loadTicket input routing", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "marshal-ticket-test-"));
    for (const key of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_TOKEN"]) vi.stubEnv(key, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("treats a non-file, non-Jira argument as a raw one-line ticket", async () => {
    const t = await loadTicket("Login button does nothing on Safari");
    expect(t.summary).toBe("Login button does nothing on Safari");
    expect(t.key).toBe("ADHOC-1");
  });

  it.each(["PROJ-100", "  PROJ-100  "])(
    "rejects an unconfigured live Jira key: %s",
    async (input) => {
      await expect(loadTicket(input)).rejects.toThrow(/JIRA_BASE_URL, JIRA_EMAIL and JIRA_TOKEN/);
    },
  );

  it("rejects partially configured Jira credentials without making a request", async () => {
    vi.stubEnv("JIRA_BASE_URL", "https://jira.invalid");
    vi.stubEnv("JIRA_EMAIL", "test@example.invalid");
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(loadTicket("PROJ-100")).rejects.toThrow(/JIRA_TOKEN/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "missing.json",
    "fixtures/missing.json",
    "./missing",
    "/missing/issue.json",
    "C:\\missing\\issue.json",
  ])("rejects a missing file-like input: %s", async (input) => {
    await expect(loadTicket(input)).rejects.toThrow(/Ticket file not found/);
  });

  it("keeps ordinary prose containing slashes as ticket text", async () => {
    expect((await loadTicket("Login fails on /auth/token")).summary).toBe(
      "Login fails on /auth/token",
    );
  });

  it("rejects directories, malformed JSON and invalid Jira ticket shapes", async () => {
    await expect(loadTicket(dir)).rejects.toThrow(/not a file/);
    const path = join(dir, "issue.json");
    writeFileSync(path, "{not JSON");
    await expect(loadTicket(path)).rejects.toThrow(/Could not read Jira JSON fixture/);
    for (const data of [
      {},
      { key: "PROJ-1", fields: { summary: 42 } },
      { key: "PROJ-1", fields: { summary: " " } },
    ]) {
      writeFileSync(path, JSON.stringify(data));
      await expect(loadTicket(path)).rejects.toThrow(/Invalid Jira issue/);
    }
  });

  it("uses the configured live client and validates the returned ticket", async () => {
    vi.stubEnv("JIRA_BASE_URL", "https://jira.invalid");
    vi.stubEnv("JIRA_EMAIL", "test@example.invalid");
    vi.stubEnv("JIRA_TOKEN", "test-placeholder");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          key: "PROJ-1",
          fields: { summary: "Live fixture response", description: "Investigate" },
        }),
        { status: 200 },
      ),
    );
    expect((await loadTicket("PROJ-1")).summary).toBe("Live fixture response");
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(loadTicket("PROJ-1")).rejects.toThrow(/Invalid Jira issue/);
  });

  it("loads a saved Jira issue when the argument is an existing file", async () => {
    const t = await loadTicket(join(import.meta.dirname, "fixtures/jira-issue.json"));
    expect(t.key).toBe("PROJ-100");
    expect(t.summary).toBe("Cart total is wrong when a discount and tax both apply");
    expect(t.type).toBe("Bug");
  });
});
