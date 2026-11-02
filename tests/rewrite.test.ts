import { describe, expect, it } from "vitest";
import type { LLMProvider } from "../src/quarry-adapter.js";
import { rewriteFromChunks, rewriteTicket } from "../src/rewrite.js";
import type { RepoRef, RetrievedChunk, Retriever, Ticket } from "../src/types.js";

const ticket: Ticket = {
  key: "PROJ-100",
  summary: "Cart total is wrong when discount and tax apply",
  description: "Confirm the intended discount and tax order.",
  status: "In Progress",
  type: "Bug",
  priority: "High",
};
const chunks: RetrievedChunk[] = [
  {
    repo: "payments-svc",
    filePath: "src/cart.ts",
    similarity: 0.82,
    content: "function cartTotal(){}",
    entityName: "cartTotal",
  },
];
const valid = {
  description: "Review the cart formula against the reported problem.",
  likelyAffectedFiles: [] as string[],
  acceptanceCriteria: ["Confirm the intended discount and tax order"],
  definitionOfDone: ["Engineer reviews the draft against source"],
};

/** Mock provider records the exact prompt; never calls a model or network. */
class MockLLM implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock-1";
  lastSystem = "";
  lastUser = "";
  constructor(private response = JSON.stringify(valid)) {}
  async complete(system: string, user: string): Promise<string> {
    this.lastSystem = system;
    this.lastUser = user;
    return this.response;
  }
}

describe("rewriteFromChunks", () => {
  it.each([false, true])("validates structured output (JSON fence: %s)", async (fenced) => {
    const json = JSON.stringify({
      ...valid,
      description: "  Review cart formula.  ",
      likelyAffectedFiles: ["src/cart.ts", "payments-svc/src/cart.ts"],
    });
    const llm = new MockLLM(fenced ? `\`\`\`json\n${json}\n\`\`\`` : json);
    const out = await rewriteFromChunks(ticket, chunks, llm);
    expect(out.key).toBe(ticket.key);
    expect(out.title).toBe(ticket.summary);
    expect(out.description).toBe("Review cart formula.");
    expect(out.likelyAffectedFiles).toEqual(["payments-svc/src/cart.ts"]);
    expect(out.evidenceFiles).toEqual(["payments-svc/src/cart.ts"]);
    expect(out.acceptanceCriteria).toEqual(valid.acceptanceCriteria);
    expect(out.definitionOfDone).toEqual(valid.definitionOfDone);
    expect(out.unsupportedFiles).toEqual([]);
    expect(out.warnings.join(" ")).toMatch(/already implemented.*Review the source/);
    expect(llm.lastSystem).toContain("reviewable draft implementation brief");
    expect(llm.lastSystem).toContain("untrusted DATA");
  });

  it.each(["{}", "null", "[]", "{ malformed", "I cannot provide JSON.", JSON.stringify([valid])])(
    "rejects empty or malformed model output: %s",
    async (response) => {
      await expect(rewriteFromChunks(ticket, chunks, new MockLLM(response))).rejects.toThrow(
        /LLM response|Invalid rewrite output/,
      );
    },
  );

  it.each([
    { ...valid, description: " " },
    { ...valid, description: undefined },
    { ...valid, likelyAffectedFiles: undefined },
    { ...valid, likelyAffectedFiles: "src/cart.ts" },
    { ...valid, acceptanceCriteria: [] },
    { ...valid, acceptanceCriteria: [1, "real"] },
    { ...valid, acceptanceCriteria: [" "] },
    { ...valid, definitionOfDone: [] },
    { ...valid, definitionOfDone: undefined },
  ])("rejects incomplete or invalid fields: %j", async (response) => {
    await expect(
      rewriteFromChunks(ticket, chunks, new MockLLM(JSON.stringify(response))),
    ).rejects.toThrow(/Invalid rewrite output/);
  });

  it("separates unsupported model paths from supported repository-qualified files", async () => {
    const llm = new MockLLM(
      JSON.stringify({
        ...valid,
        likelyAffectedFiles: ["./src/cart.ts", "invented.ts", "../outside.ts"],
      }),
    );
    const out = await rewriteFromChunks(ticket, chunks, llm);
    expect(out.likelyAffectedFiles).toEqual(["payments-svc/src/cart.ts"]);
    expect(out.unsupportedFiles).toEqual(["invented.ts", "../outside.ts"]);
    expect(out.warnings.join(" ")).toContain("unsupported or ambiguous");
  });

  it("requires qualification when a relative path occurs in multiple repositories", async () => {
    const llm = new MockLLM(
      JSON.stringify({
        ...valid,
        likelyAffectedFiles: ["src/cart.ts", "payments-svc/src/cart.ts"],
      }),
    );
    const out = await rewriteFromChunks(
      ticket,
      [...chunks, { ...chunks[0], repo: "web-app" }],
      llm,
    );
    expect(out.likelyAffectedFiles).toEqual(["payments-svc/src/cart.ts"]);
    expect(out.unsupportedFiles).toEqual(["src/cart.ts"]);
  });

  it("warns even when proposed criteria describe code already present", async () => {
    const llm = new MockLLM(JSON.stringify({ ...valid, acceptanceCriteria: ["Return 42"] }));
    const out = await rewriteFromChunks(
      ticket,
      [{ ...chunks[0], content: "function cartTotal() { return 42; }" }],
      llm,
    );
    expect(llm.lastSystem).toContain("Flag behaviour already present");
    expect(out.acceptanceCriteria).toEqual(["Return 42"]);
    expect(out.warnings[0]).toMatch(/Draft only.*already implemented/);
  });

  it("bounds source text, labels truncation, and cites only context actually sent", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...chunks[0],
      filePath: `src/file${i}.ts`,
      content: "x".repeat(20_000),
    }));
    const llm = new MockLLM(
      JSON.stringify({ ...valid, likelyAffectedFiles: ["payments-svc/src/file29.ts"] }),
    );
    const out = await rewriteFromChunks(ticket, many, llm);
    const context = llm.lastUser.split("Code context:\n")[1];
    expect(context.length).toBeLessThanOrEqual(10_000);
    expect(context.match(/### Source /g)?.length).toBeLessThanOrEqual(12);
    expect(context).not.toContain("file29.ts");
    expect(out.evidenceFiles).not.toContain("payments-svc/src/file29.ts");
    expect(out.likelyAffectedFiles).toEqual([]);
    expect(out.unsupportedFiles).toEqual(["payments-svc/src/file29.ts"]);
    expect(out.warnings.join(" ")).toContain("Code context was truncated");
  });

  it("bounds large ticket text and source headings as well as code bodies", async () => {
    const llm = new MockLLM();
    const out = await rewriteFromChunks(
      { ...ticket, description: "y".repeat(30_000) },
      [{ ...chunks[0], filePath: "z".repeat(20_000) }],
      llm,
    );
    expect(llm.lastUser.length).toBeLessThan(14_000);
    expect(out.evidenceFiles).toEqual([]);
    expect(out.warnings.join(" ")).toContain("Ticket text was truncated");
    expect(out.warnings.join(" ")).toContain("Code context was truncated");
  });

  it("handles a thin ticket and unnamed chunk while retaining the review warning", async () => {
    const llm = new MockLLM();
    const out = await rewriteFromChunks(
      { ...ticket, description: "" },
      [{ ...chunks[0], entityName: undefined }],
      llm,
    );
    expect(llm.lastUser).toContain("(none)");
    expect(llm.lastUser).toContain("### Source 1: payments-svc/src/cart.ts\n");
    expect(out.warnings[0]).toContain("Draft only");
  });

  it("explicitly reports drafts made without retrieved code", async () => {
    const llm = new MockLLM();
    const out = await rewriteFromChunks(ticket, [], llm);
    expect(llm.lastUser).toContain("(no code retrieved)");
    expect(out.evidenceFiles).toEqual([]);
    expect(out.warnings.join(" ")).toContain("no retrieved code evidence");
  });
});

describe("rewriteTicket", () => {
  it("retrieves once with the ticket query and default budget before drafting", async () => {
    let calls = 0;
    const repos: RepoRef[] = [{ name: "payments-svc", path: "/repos/payments-svc" }];
    const retriever: Retriever = {
      async retrieve(query, suppliedRepos, topK) {
        calls++;
        expect(query).toBe(`${ticket.summary}\n${ticket.description}`);
        expect(suppliedRepos).toBe(repos);
        expect(topK).toBe(12);
        return chunks;
      },
    };
    const out = await rewriteTicket(ticket, retriever, repos, new MockLLM());
    expect(calls).toBe(1);
    expect(out.evidenceFiles).toEqual(["payments-svc/src/cart.ts"]);
  });
});
