import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateEmbedding, initialize, stores } = vi.hoisted(() => ({
  generateEmbedding: vi.fn(async () => [0.1, 0.2]),
  initialize: vi.fn(async () => undefined),
  stores: new Map<string, { hits: unknown[]; close: ReturnType<typeof vi.fn> }>(),
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: (path: string) => stores.has(path),
}));

vi.mock("@mrkarldoyle/quarry", () => ({
  AnthropicProvider: class {},
  EmbeddingGenerator: class {
    initialize = initialize;
    generateEmbedding = generateEmbedding;
  },
  FallbackProvider: class {},
  JiraClient: class {},
  MossProvider: class {},
  OllamaProvider: class {},
  RepositoryIndexer: class {},
  VectorStore: class {
    private store: { hits: unknown[]; close: ReturnType<typeof vi.fn> };
    constructor(path: string) {
      const store = stores.get(path);
      if (!store) throw new Error("not indexed");
      this.store = store;
    }
    search = vi.fn(() => this.store.hits);
    close = vi.fn(() => this.store.close());
  },
  loadJiraFixture: vi.fn(),
  parseJiraIssue: vi.fn(),
}));

import { indexDbPath } from "../src/config.js";
import { QuarryRetriever } from "../src/quarry-adapter.js";

function hit(filePath: string, similarity: number) {
  return {
    filePath,
    similarity,
    content: filePath,
    metadata: { entityName: filePath },
  };
}

describe("QuarryRetriever", () => {
  beforeEach(() => {
    stores.clear();
    initialize.mockClear();
    generateEmbedding.mockClear();
  });

  it("embeds once and merges repositories by Quarry hybrid rank, not dense score", async () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    stores.set(indexDbPath("/data", "a"), {
      hits: [hit("a-first.ts", 0.3), hit("a-dense.ts", 0.99)],
      close: closeA,
    });
    stores.set(indexDbPath("/data", "b"), {
      hits: [hit("b-first.ts", 0.8)],
      close: closeB,
    });
    const retriever = new QuarryRetriever("/data");
    const repos = [
      { name: "a", path: "/repos/a" },
      { name: "b", path: "/repos/b" },
    ];

    const results = await retriever.retrieve("query", repos, 3);

    expect(initialize).toHaveBeenCalledOnce();
    expect(generateEmbedding).toHaveBeenCalledOnce();
    expect(results.map((r) => r.filePath)).toEqual(["a-first.ts", "b-first.ts", "a-dense.ts"]);
    expect(results.map((r) => r.retrievalRank)).toEqual([1, 1, 2]);
    expect(results.map((r) => r.repo)).toEqual(["a", "b", "a"]);
    expect(closeA).toHaveBeenCalledOnce();
    expect(closeB).toHaveBeenCalledOnce();
  });

  it("requires a rebuild for missing or legacy indexes before loading embeddings", async () => {
    stores.set("/data/indexes/missing.db", { hits: [], close: vi.fn() });
    const retriever = new QuarryRetriever("/data");
    await expect(
      retriever.retrieve("query", [{ name: "missing", path: "/repos/missing" }], 12),
    ).rejects.toThrow(/marshal index "\/repos\/missing"/);
    expect(initialize).not.toHaveBeenCalled();
    expect(generateEmbedding).not.toHaveBeenCalled();
  });
});
