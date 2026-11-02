/** Shared domain types for Marshal. Kept dependency-free so the core logic
 *  (routing, rewriting, CODEOWNERS) is unit-testable without loading Quarry. */

/** A parsed ticket. Structurally identical to Quarry's `Ticket`, redeclared
 *  here so the core never has to import Quarry just for a type. */
export interface Ticket {
  key: string;
  summary: string;
  description: string;
  status: string;
  type: string;
  priority: string;
}

/** A repo Marshal knows about: a name and the on-disk path (for CODEOWNERS). */
export interface RepoRef {
  name: string;
  path: string;
}

/** One retrieved code chunk, tagged with the repo it came from. */
export interface RetrievedChunk {
  repo: string;
  filePath: string;
  /** Dense cosine similarity in [0,1]; not the hybrid retrieval score. */
  similarity: number;
  /** 1-based position returned by Quarry's hybrid search within this repository. */
  retrievalRank?: number;
  content: string;
  entityName?: string;
}

/**
 * Retrieval is an interface so routing/rewriting can be tested with a fake.
 * The real implementation (QuarryRetriever) wraps Quarry's vector store.
 */
export interface Retriever {
  retrieve(query: string, repos: RepoRef[], topK: number): Promise<RetrievedChunk[]>;
}

/** A single evidence file backing a routing decision. */
export interface EvidenceFile {
  repo: string;
  filePath: string;
  similarity: number;
  entityName?: string;
}

export interface RouteResult {
  owningRepo: string | null;
  team: string | null;
  /** Honest, calibrated confidence in [0,1] — not always-high. */
  confidence: number;
  evidenceFiles: EvidenceFile[];
}

export interface EnrichedTicket {
  key: string;
  title: string;
  description: string;
  likelyAffectedFiles: string[];
  /** Files present in retrieved code context, kept separate from model suggestions. */
  evidenceFiles: string[];
  acceptanceCriteria: string[];
  definitionOfDone: string[];
}
