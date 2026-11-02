import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmbeddingGenerator, RepositoryIndexer, VectorStore } from "@mrkarldoyle/quarry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexDbPath, loadRegistry, registryName, saveRegistry } from "../src/config.js";
import { indexRepo, QuarryRetriever } from "../src/quarry-adapter.js";

describe("repository index identity and cleanup", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "marshal-index-test-"));
    // Keep embeddings offline while exercising the real indexer and SQLite store.
    vi.spyOn(EmbeddingGenerator.prototype, "initialize").mockResolvedValue(undefined);
    vi.spyOn(EmbeddingGenerator.prototype, "generateEmbedding").mockResolvedValue([
      1,
      ...Array(383).fill(0),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  function config() {
    return {
      dataDir: join(dir, "data"),
      provider: "ollama" as const,
      model: "unused",
      ollamaHost: "http://127.0.0.1:11434",
      anthropicApiKey: undefined,
    };
  }

  it("keeps sanitisation-colliding repositories independent across reindexing", async () => {
    const registry = {} as ReturnType<typeof loadRegistry>;
    for (const [name, content] of [
      ["my.repo", "export const cartTotal = 42;"],
      ["my_repo", "export const unrelatedService = 99;"],
    ]) {
      const path = join(dir, name);
      mkdirSync(path);
      writeFileSync(join(path, "index.ts"), content);
      const identity = registryName(registry, path);
      const result = await indexRepo(config(), identity, path);
      expect(result.chunks).toBeGreaterThan(0);
      registry[identity] = { name: identity, path, ...result, indexedAt: "now" };
    }
    saveRegistry(config().dataDir, registry);
    expect(loadRegistry(config().dataDir)).toEqual(registry);
    expect(indexDbPath(config().dataDir, "my.repo")).not.toBe(
      indexDbPath(config().dataDir, "my_repo"),
    );

    writeFileSync(join(dir, "my.repo/index.ts"), "export const updatedCart = 43;");
    await indexRepo(config(), "my.repo", join(dir, "my.repo"));
    const chunks = await new QuarryRetriever(config().dataDir).retrieve(
      "cart service",
      Object.values(registry),
      12,
    );
    expect(chunks.find((c) => c.repo === "my.repo")?.content).toContain("updatedCart");
    expect(chunks.find((c) => c.repo === "my_repo")?.content).toContain("unrelatedService");
    expect(chunks.find((c) => c.repo === "my_repo")?.content).not.toContain("updatedCart");
  });

  it("requires explicit reindexing of legacy data without modifying registry or legacy files", async () => {
    const path = join(dir, "my.repo");
    mkdirSync(path);
    writeFileSync(join(path, "index.ts"), "export const cartTotal = 42;");
    const registry = {
      "my.repo": { name: "my.repo", path, files: 1, chunks: 1, indexedAt: "before" },
    };
    saveRegistry(config().dataDir, registry);
    mkdirSync(join(config().dataDir, "indexes"));
    const legacy = join(config().dataDir, "indexes/my_repo.db");
    writeFileSync(legacy, "legacy index left untouched");

    const retriever = new QuarryRetriever(config().dataDir);
    await expect(retriever.retrieve("cart", Object.values(registry), 12)).rejects.toThrow(
      /Missing current-format index.*marshal index/,
    );
    expect(existsSync(indexDbPath(config().dataDir, "my.repo"))).toBe(false);
    await indexRepo(config(), "my.repo", path);
    expect(await retriever.retrieve("cart", Object.values(registry), 12)).toHaveLength(1);
    expect(loadRegistry(config().dataDir)).toEqual(registry);
    expect(readFileSync(legacy, "utf8")).toBe("legacy index left untouched");
  });

  it.each(["initialize", "indexRepository"] as const)(
    "closes the store when %s fails and permits a later rebuild",
    async (method) => {
      const close = vi.spyOn(VectorStore.prototype, "close");
      const failure = new Error("indexing failed");
      vi.spyOn(RepositoryIndexer.prototype, method).mockRejectedValueOnce(failure);
      await expect(indexRepo(config(), "repo", dir)).rejects.toThrow(failure);
      expect(close).toHaveBeenCalledOnce();
      const store = new VectorStore(indexDbPath(config().dataDir, "repo"));
      store.clear();
      store.close();
    },
  );
});
