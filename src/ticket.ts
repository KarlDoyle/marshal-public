import { existsSync } from "node:fs";
import { JiraClient, loadJiraFixture } from "./quarry-adapter.js";
import type { Ticket } from "./types.js";

/** A bare Jira-style key, e.g. PROJ-100 or ENG-7 (used to disambiguate input). */
const JIRA_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

/**
 * Synthesize a ticket from a raw one-line description — the "just type the
 * problem" path (`marshal triage "Cart total wrong with discount and tax"`).
 * No Jira, no fixture: the line becomes the summary; everything is retrieved
 * from the indexed code, so a thin ticket is exactly the point.
 */
export function ticketFromText(text: string): Ticket {
  const summary = text.trim();
  if (!summary) {
    throw new Error("Empty ticket text — pass a one-line description of the problem.");
  }
  return {
    key: "ADHOC-1",
    summary,
    description: "",
    status: "Open",
    type: "Task",
    priority: "Medium",
  };
}

/**
 * Resolve a ticket from a CLI argument, in priority order:
 *   1. a path to a saved Jira issue JSON (offline demo / tests),
 *   2. a live Jira key (PROJ-123) when JIRA_BASE_URL/EMAIL/TOKEN are set,
 *   3. otherwise, the argument itself as a raw one-line ticket.
 * This makes the common demo path — typing the problem in plain English —
 * work with no Jira and no fixture, while keeping the file/Jira paths intact.
 */
export async function loadTicket(fileOrKeyOrText: string): Promise<Ticket> {
  if (existsSync(fileOrKeyOrText)) {
    return loadJiraFixture(fileOrKeyOrText);
  }
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_TOKEN } = process.env;
  if (JIRA_KEY.test(fileOrKeyOrText) && JIRA_BASE_URL && JIRA_EMAIL && JIRA_TOKEN) {
    return new JiraClient(JIRA_BASE_URL, JIRA_EMAIL, JIRA_TOKEN).getIssue(fileOrKeyOrText);
  }
  return ticketFromText(fileOrKeyOrText);
}
