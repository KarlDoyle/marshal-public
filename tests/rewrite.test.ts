import { describe, expect, it } from "vitest";
import type { LLMProvider } from "../src/quarry-adapter.js";
import { rewriteFromChunks, rewriteTicket } from "../src/rewrite.js";
import type { RepoRef, RetrievedChunk, Retriever, Ticket } from "../src/types.js";

const ticket: Ticket = {
  key: "PROJ-100",
  summary: "Cart total is wrong when a discount and tax both apply",
  description: "Discount and tax combined in the wrong order.",
  status: "In Progress",
  type: "Bug",
  priority: "High",
};

const chunks: RetrievedChunk[] = [
  {
    repo: "payments-svc",
    filePath: "src/billing/cart.ts",
    similarity: 0.82,
    content: "function cartTotal(){}",
    entityName: "cartTotal",
  },
];

/** Mock LLM: records the prompt, returns a fixed JSON spec. No network. */
class MockLLM implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock-1";
  lastSystem = "";
  lastUser = "";
  constructor(private response: string) {}
  async complete(system: string, user: string): Promise<string> {
    this.lastSystem = system;
    this.lastUser = user;
    return this.response;
  }
}

describe("rewriteFromChunks", () => {
  it("produces the structured enriched-ticket fields from the LLM JSON", async () => {
    const llm = new MockLLM(
      `Sure, here is the spec:
      {
        "description": "Apply discount before tax in cartTotal.",
        "likelyAffectedFiles": ["src/billing/cart.ts"],
        "acceptanceCriteria": ["Discount applied before tax", "Totals match the spec"],
        "definitionOfDone": ["Unit tests added", "Reviewed"]
      }
      thanks`,
    );
    const out = await rewriteFromChunks(ticket, chunks, llm);

    expect(out.key).toBe("PROJ-100");
    expect(out.title).toBe(ticket.summary);
    expect(out.description).toContain("discount before tax");
    expect(out.acceptanceCriteria).toHaveLength(2);
    expect(out.definitionOfDone).toContain("Unit tests added");
    expect(out.likelyAffectedFiles).toEqual(["src/billing/cart.ts"]);
    expect(out.evidenceFiles).toContain("payments-svc/src/billing/cart.ts");
  });

  it("keeps retrieved evidence separate when the LLM omits suggested files", async () => {
    const llm = new MockLLM('{"description":"d","acceptanceCriteria":[],"definitionOfDone":[]}');
    const out = await rewriteFromChunks(ticket, chunks, llm);
    expect(out.likelyAffectedFiles).toEqual([]);
    expect(out.evidenceFiles).toContain("payments-svc/src/billing/cart.ts");
  });

  it("keeps the original description when the LLM's is missing or blank", async () => {
    const llm = new MockLLM('{"description":"   ","acceptanceCriteria":[],"definitionOfDone":[]}');
    const out = await rewriteFromChunks(ticket, chunks, llm);
    expect(out.description).toBe(ticket.description);
  });

  it("handles a thin ticket and an unnamed chunk without inventing detail", async () => {
    const thin: Ticket = { ...ticket, description: "" };
    const unnamed: RetrievedChunk[] = [
      { repo: "web-app", filePath: "src/Cart.tsx", similarity: 0.4, content: "const x = 1;" },
    ];
    const llm = new MockLLM('{"description":"d","acceptanceCriteria":[],"definitionOfDone":[]}');
    const out = await rewriteFromChunks(thin, unnamed, llm);

    expect(llm.lastUser).toContain("(none)");
    // No entityName on the chunk → no parenthesised entity in the source heading.
    expect(llm.lastUser).toContain("### Source 1: web-app/src/Cart.tsx\n");
    expect(out.likelyAffectedFiles).toEqual([]);
    expect(out.evidenceFiles).toEqual(["web-app/src/Cart.tsx"]);
  });

  it("says so in the prompt when nothing was retrieved", async () => {
    const llm = new MockLLM('{"description":"d","acceptanceCriteria":[],"definitionOfDone":[]}');
    await rewriteFromChunks(ticket, [], llm);
    expect(llm.lastUser).toContain("(no code retrieved)");
  });

  it("drops non-string and blank entries from the LLM's string arrays", async () => {
    const llm = new MockLLM(
      '{"description":"d","likelyAffectedFiles":"nope","acceptanceCriteria":[1,"  ","real"],"definitionOfDone":[]}',
    );
    const out = await rewriteFromChunks(ticket, chunks, llm);
    expect(out.acceptanceCriteria).toEqual(["real"]);
    expect(out.likelyAffectedFiles).toEqual([]);
    expect(out.evidenceFiles).toContain("payments-svc/src/billing/cart.ts");
  });

  it("throws a clear error when the LLM returns no JSON", async () => {
    const llm = new MockLLM("I cannot help with that.");
    await expect(rewriteFromChunks(ticket, chunks, llm)).rejects.toThrow(/no JSON/i);
  });
});

/** A retriever that returns canned, repo-tagged chunks — no embeddings, no DB. */
class FakeRetriever implements Retriever {
  constructor(private chunks: RetrievedChunk[]) {}
  async retrieve(_q: string, _repos: RepoRef[], topK: number): Promise<RetrievedChunk[]> {
    return this.chunks.slice(0, topK);
  }
}

describe("rewriteTicket (IO: retrieves then enriches off the same evidence)", () => {
  it("retrieves chunks for the ticket and feeds them into rewriteFromChunks", async () => {
    const retriever = new FakeRetriever(chunks);
    const repos: RepoRef[] = [{ name: "payments-svc", path: "/repos/payments-svc" }];
    const llm = new MockLLM(
      '{"description":"Apply discount before tax.","acceptanceCriteria":["a"],"definitionOfDone":["d"]}',
    );

    const out = await rewriteTicket(ticket, retriever, repos, llm);

    expect(out.key).toBe(ticket.key);
    expect(out.evidenceFiles).toContain("payments-svc/src/billing/cart.ts");
  });

  it("defaults topK to 12 when not given", async () => {
    let seenTopK = -1;
    const retriever: Retriever = {
      async retrieve(_q, _repos, topK) {
        seenTopK = topK;
        return [];
      },
    };
    const llm = new MockLLM('{"description":"d","acceptanceCriteria":[],"definitionOfDone":[]}');
    await rewriteTicket(ticket, retriever, [], llm);
    expect(seenTopK).toBe(12);
  });
});
