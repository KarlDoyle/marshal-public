import { existsSync, statSync } from "node:fs";
import { JiraClient, loadJiraFixture } from "./quarry-adapter.js";
import type { Ticket } from "./types.js";

/** A bare Jira-style key, e.g. PROJ-100 or ENG-7 (used to disambiguate input). */
const JIRA_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

function validateTicket(ticket: Ticket): Ticket {
  const fields = ["key", "summary", "description", "status", "type", "priority"] as const;
  if (
    !ticket ||
    fields.some((field) => typeof ticket[field] !== "string") ||
    !ticket.key.trim() ||
    !ticket.summary.trim()
  ) {
    throw new Error(
      "Invalid Jira issue: expected a non-empty key and fields.summary, with string ticket fields.",
    );
  }
  return { ...ticket, key: ticket.key.trim(), summary: ticket.summary.trim() };
}

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
 *   2. a live Jira key (PROJ-123), requiring JIRA_BASE_URL/EMAIL/TOKEN,
 *   3. otherwise, a raw one-line ticket (reject missing JSON/explicit paths).
 * This makes the common demo path — typing the problem in plain English —
 * work with no Jira and no fixture, while keeping the file/Jira paths intact.
 */
export async function loadTicket(fileOrKeyOrText: string): Promise<Ticket> {
  const input = fileOrKeyOrText.trim();
  if (existsSync(input)) {
    if (!statSync(input).isFile()) throw new Error(`Ticket input is not a file: ${input}`);
    let ticket: Ticket;
    try {
      ticket = loadJiraFixture(input);
    } catch {
      throw new Error(
        `Could not read Jira JSON fixture: ${input}. Supply a saved Jira issue JSON file.`,
      );
    }
    return validateTicket(ticket);
  }
  if (
    /^(?:\.{1,2}[\\/]|[\\/~]|[A-Za-z]:[\\/])/.test(input) ||
    (!/\s/.test(input) && /\.json$/i.test(input))
  ) {
    throw new Error(
      `Ticket file not found: ${input}. Check the path or pass a plain-English description.`,
    );
  }
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_TOKEN } = process.env;
  if (JIRA_KEY.test(input)) {
    if (!JIRA_BASE_URL?.trim() || !JIRA_EMAIL?.trim() || !JIRA_TOKEN?.trim()) {
      throw new Error(
        "Live Jira keys require JIRA_BASE_URL, JIRA_EMAIL and JIRA_TOKEN. Configure them, or pass a saved Jira JSON fixture or plain-English description.",
      );
    }
    return validateTicket(
      await new JiraClient(JIRA_BASE_URL, JIRA_EMAIL, JIRA_TOKEN).getIssue(input),
    );
  }
  return ticketFromText(input);
}
