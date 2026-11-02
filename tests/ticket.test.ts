import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
  it("treats a non-file, non-Jira argument as a raw one-line ticket", async () => {
    const t = await loadTicket("Login button does nothing on Safari");
    expect(t.summary).toBe("Login button does nothing on Safari");
    expect(t.key).toBe("ADHOC-1");
  });

  it("treats a Jira-key-looking string as a one-line ticket when Jira is unconfigured", async () => {
    // No JIRA_* env in the test runner → falls through to the one-line path,
    // rather than failing obscurely.
    const t = await loadTicket("PROJ-100");
    expect(t.summary).toBe("PROJ-100");
  });

  it("loads a saved Jira issue when the argument is an existing file", async () => {
    const t = await loadTicket(join(import.meta.dirname, "fixtures/jira-issue.json"));
    expect(t.key).toBe("PROJ-100");
    expect(t.summary).toBe("Cart total is wrong when a discount and tax both apply");
    expect(t.type).toBe("Bug");
  });
});
