import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeFromChunks, routeTicket } from "../src/route.js";
import type { RepoRef, RetrievedChunk, Retriever, Ticket } from "../src/types.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

const ticket: Ticket = {
  key: "PROJ-100",
  summary: "Cart total is wrong when a discount and tax both apply",
  description: "Discount and tax are combined in the wrong order in the cart total calculation.",
  status: "In Progress",
  type: "Bug",
  priority: "High",
};

/** A retriever that returns canned, repo-tagged chunks — no embeddings, no DB. */
class FakeRetriever implements Retriever {
  constructor(private chunks: RetrievedChunk[]) {}
  async retrieve(_q: string, _repos: RepoRef[], topK: number): Promise<RetrievedChunk[]> {
    return this.chunks.slice(0, topK);
  }
}

const repos: RepoRef[] = [
  { name: "payments-svc", path: join(FIXTURES, "repos/payments-svc") },
  { name: "web-app", path: join(FIXTURES, "repos/web-app") },
];

describe("routeTicket (IO: reads real CODEOWNERS)", () => {
  it("routes to the owning repo and a plausible team with evidence", async () => {
    const retriever = new FakeRetriever([
      { repo: "payments-svc", filePath: "src/billing/cart.ts", similarity: 0.82, content: "x" },
      { repo: "payments-svc", filePath: "src/billing/tax.ts", similarity: 0.74, content: "x" },
      { repo: "web-app", filePath: "src/components/Cart.tsx", similarity: 0.31, content: "x" },
    ]);
    const result = await routeTicket(ticket, retriever, repos);

    expect(result.owningRepo).toBe("payments-svc");
    // src/billing/** is owned by the billing team in the fixture CODEOWNERS.
    expect(result.team).toBe("@acme/billing-team");
    expect(result.evidenceFiles.map((e) => e.filePath)).toContain("src/billing/cart.ts");
    expect(result.confidence).toBeGreaterThan(0.3);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe("routeFromChunks (pure routing heuristics)", () => {
  it("returns zero confidence and nulls when nothing was retrieved", () => {
    const r = routeFromChunks([], new Map());
    expect(r).toMatchObject({
      owningRepo: null,
      team: null,
      confidence: 0,
      evidenceFiles: [],
      explanation: { repositoryStatus: "no-evidence", runnerUp: null, repositoryScores: [] },
    });
  });

  it("is honest: a contested split scores lower than a clean strong match", () => {
    const codeowners = new Map([["a", null]]);
    const clean = routeFromChunks(
      [
        { repo: "a", filePath: "f1", similarity: 0.9, content: "" },
        { repo: "a", filePath: "f2", similarity: 0.85, content: "" },
      ],
      codeowners,
    );
    const contested = routeFromChunks(
      [
        { repo: "a", filePath: "f1", similarity: 0.5, content: "" },
        { repo: "b", filePath: "g1", similarity: 0.49, content: "" },
      ],
      new Map([
        ["a", null],
        ["b", null],
      ]),
    );
    expect(clean.confidence).toBeGreaterThan(contested.confidence);
  });

  it("de-dupes evidence by file path, keeping the strongest chunk", () => {
    const r = routeFromChunks(
      [
        { repo: "a", filePath: "f1", similarity: 0.4, content: "" },
        { repo: "a", filePath: "f1", similarity: 0.9, content: "" },
        { repo: "a", filePath: "f2", similarity: 0.6, content: "" },
      ],
      new Map([["a", null]]),
    );
    expect(r.evidenceFiles.map((e) => e.filePath)).toEqual(["f1", "f2"]);
    expect(r.evidenceFiles[0].similarity).toBe(0.9);
  });

  it("preserves Quarry hybrid rank order for evidence despite dense-score differences", () => {
    const r = routeFromChunks(
      [
        { repo: "a", filePath: "lexical-hit.ts", similarity: 0.4, retrievalRank: 1, content: "" },
        { repo: "a", filePath: "dense-hit.ts", similarity: 0.95, retrievalRank: 2, content: "" },
      ],
      new Map([["a", null]]),
    );
    expect(r.evidenceFiles.map((e) => e.filePath)).toEqual(["lexical-hit.ts", "dense-hit.ts"]);
  });

  it("names no team when CODEOWNERS exists but covers none of the evidence", () => {
    const chunks: RetrievedChunk[] = [
      { repo: "a", filePath: "src/app.ts", similarity: 0.8, content: "" },
    ];
    const uncovered = routeFromChunks(
      chunks,
      new Map([["a", [{ pattern: "docs/**", owners: ["@docs"] }]]]),
    );
    const covered = routeFromChunks(
      chunks,
      new Map([["a", [{ pattern: "src/**", owners: ["@app"] }]]]),
    );
    expect(uncovered.team).toBeNull();
    expect(uncovered.confidence).toBeLessThan(covered.confidence);
  });

  it("does not divide by zero when every retrieved chunk scores zero", () => {
    const r = routeFromChunks(
      [
        { repo: "a", filePath: "f1", similarity: 0, content: "" },
        { repo: "b", filePath: "g1", similarity: 0, content: "" },
      ],
      new Map(),
    );
    expect(r.owningRepo).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("caps confidence lower when no CODEOWNERS names a team", () => {
    const chunks: RetrievedChunk[] = [
      { repo: "a", filePath: "f1", similarity: 0.8, content: "" },
      { repo: "a", filePath: "f2", similarity: 0.8, content: "" },
    ];
    const withOwners = routeFromChunks(
      chunks,
      new Map([["a", [{ pattern: "*", owners: ["@team"] }]]]),
    );
    const withoutOwners = routeFromChunks(chunks, new Map([["a", null]]));
    expect(withoutOwners.team).toBeNull();
    expect(withoutOwners.confidence).toBeLessThan(withOwners.confidence);
  });
});
