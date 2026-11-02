import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
/**
 * The ONLY module that touches Quarry. We reuse Quarry's retrieval engine by
 * importing its compiled library surface (`@mrkarldoyle/quarry`): the local embedded
 * vector store, the repository
 * indexer, the local embedding generator, the Jira fixture loader, and the
 * LLM providers (Ollama-by-default, Anthropic optional). Nothing is forked or
 * re-implemented — Marshal only adds routing/rewriting on top.
 *
 * Quarry uses Node's built-in `node:sqlite`, so any process importing this must
 * run with `NODE_OPTIONS=--experimental-sqlite` (the CLI shebang sets it).
 */
import {
  AnthropicProvider,
  EmbeddingGenerator,
  FallbackProvider,
  type IndexResult,
  JiraClient,
  type LLMProvider,
  loadJiraFixture,
  MossProvider,
  OllamaProvider,
  parseJiraIssue,
  RepositoryIndexer,
  type Ticket,
  VectorStore,
} from "@mrkarldoyle/quarry";
import type { MarshalConfig } from "./config.js";
import { indexDbPath } from "./config.js";
import type { RepoRef, RetrievedChunk, Retriever } from "./types.js";

export type { LLMProvider, Ticket };
export { JiraClient, loadJiraFixture, parseJiraIssue };

/** Index one repo into its own dedicated DB (so repos don't clobber each other —
 *  Quarry's indexer clears the store it's given, so we give each repo its own). */
export async function indexRepo(
  config: MarshalConfig,
  repoName: string,
  repoPath: string,
): Promise<IndexResult> {
  const db = indexDbPath(config.dataDir, repoName);
  mkdirSync(dirname(db), { recursive: true });
  const store = new VectorStore(db);
  try {
    const indexer = new RepositoryIndexer(store);
    await indexer.initialize();
    return await indexer.indexRepository(repoPath);
  } finally {
    store.close();
  }
}

/**
 * Retriever backed by Quarry's hybrid (dense + BM25/RRF) search. Embeds the
 * query once and searches each repo's store. Quarry exposes hybrid ordering but
 * only dense similarity as a score, so results are merged round-robin by
 * per-repo rank rather than incorrectly re-sorted by dense similarity.
 */
export class QuarryRetriever implements Retriever {
  private embedder = new EmbeddingGenerator();
  private initialized = false;

  constructor(private dataDir: string) {}

  async retrieve(query: string, repos: RepoRef[], topK: number): Promise<RetrievedChunk[]> {
    // Validate before loading the embedding model. VectorStore creates missing
    // databases, which would silently hide legacy or deleted indexes.
    for (const repo of repos) {
      if (!existsSync(indexDbPath(this.dataDir, repo.name))) {
        throw new Error(
          `Missing current-format index for ${repo.name}. Rebuild it with ` +
            `marshal index ${JSON.stringify(repo.path)} (using the same MARSHAL_DATA_DIR). ` +
            "Legacy database files are left untouched.",
        );
      }
    }
    if (!this.initialized) {
      await this.embedder.initialize();
      this.initialized = true;
    }
    const queryEmbedding = await this.embedder.generateEmbedding(query);
    const rankedByRepo: RetrievedChunk[][] = [];
    for (const repo of repos) {
      const db = indexDbPath(this.dataDir, repo.name);
      const store = new VectorStore(db);
      try {
        const hits = store.search(queryEmbedding, query, topK);
        rankedByRepo.push(
          hits.map((h, index) => ({
            repo: repo.name,
            filePath: h.filePath,
            similarity: h.similarity ?? 0,
            retrievalRank: index + 1,
            content: h.content,
            entityName: h.metadata.entityName,
          })),
        );
      } finally {
        store.close();
      }
    }
    const merged: RetrievedChunk[] = [];
    for (let rank = 0; merged.length < topK; rank++) {
      let found = false;
      for (const repoHits of rankedByRepo) {
        const hit = repoHits[rank];
        if (hit) {
          merged.push(hit);
          found = true;
          if (merged.length === topK) break;
        }
      }
      if (!found) break;
    }
    return merged;
  }
}

/**
 * Build the LLM provider: local Ollama by default (free, no key). Anthropic is
 * used only when MARSHAL_PROVIDER=anthropic is explicitly selected; merely
 * configuring an API key never sends ticket or code context to the cloud.
 *
 * MARSHAL_PROVIDER=moss routes generation through moss's local-first router
 * (the shared engine the dev-tools share) instead of calling Ollama directly —
 * still key-free, nothing leaves the box. Moss is reused via Quarry's exported
 * `MossProvider`, which dynamically imports Moss only when selected, so neither
 * Quarry nor Marshal requires Moss to be installed. If Moss isn't available the
 * FallbackProvider drops to direct Ollama, so Marshal still works standalone.
 */
export function buildProvider(config: MarshalConfig): LLMProvider {
  if (config.provider === "anthropic") {
    if (!config.anthropicApiKey) {
      throw new Error("MARSHAL_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
    }
    return new AnthropicProvider(config.model, config.anthropicApiKey);
  }
  const ollama = new OllamaProvider(config.model, config.ollamaHost);
  if (config.provider === "moss") {
    return new FallbackProvider(new MossProvider(config.model), ollama);
  }
  return ollama;
}
