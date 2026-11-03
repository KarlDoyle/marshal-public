import { type CodeownersRule, loadCodeowners, ownersForPath } from "./codeowners.js";
import type {
  EvidenceFile,
  RepoRef,
  RetrievedChunk,
  Retriever,
  RouteResult,
  Ticket,
} from "./types.js";

/** How many evidence files (per repo) feed the confidence calculation. */
const EVIDENCE_TOP_N = 5;
/** Presentation threshold based on observed weak examples; not a calibrated cutoff. */
const LOW_CONFIDENCE_THRESHOLD = 0.05;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/** Stable code-point ordering, independent of locale or registry insertion order. */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deduplicate files before scoring; additional weak chunks cannot add votes. */
function evidenceForRepo(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const files = new Map<string, RetrievedChunk>();
  for (const chunk of chunks) {
    const similarity = Number.isFinite(chunk.similarity) ? clamp01(chunk.similarity) : 0;
    const previous = files.get(chunk.filePath);
    if (
      !previous ||
      similarity > previous.similarity ||
      (similarity === previous.similarity &&
        (chunk.retrievalRank ?? Infinity) < (previous.retrievalRank ?? Infinity))
    ) {
      files.set(chunk.filePath, { ...chunk, similarity });
    }
  }
  return [...files.values()]
    .sort((a, b) => b.similarity - a.similarity || compareNames(a.filePath, b.filePath))
    .slice(0, EVIDENCE_TOP_N);
}

/**
 * Compare mean similarity over at most five distinct files per repository.
 * Confidence multiplies evidence strength, score share, separation from the
 * runner-up and ownership support. These are heuristics, not probabilities.
 * Exact repository ties have zero confidence and a stable displayed candidate;
 * exact owner ties leave the team unassigned.
 */
export function routeFromChunks(
  chunks: RetrievedChunk[],
  codeownersByRepo: Map<string, CodeownersRule[] | null>,
): RouteResult {
  const chunksByRepo = new Map<string, RetrievedChunk[]>();
  for (const chunk of chunks) {
    const group = chunksByRepo.get(chunk.repo) ?? [];
    group.push(chunk);
    chunksByRepo.set(chunk.repo, group);
  }
  const ranked = [...chunksByRepo.entries()]
    .map(([repo, group]) => {
      const evidence = evidenceForRepo(group);
      // Fixed precision also makes numerical ties explicit and reproducible.
      const score = Number(
        (evidence.reduce((sum, c) => sum + c.similarity, 0) / evidence.length).toFixed(6),
      );
      return { repo, score, evidence };
    })
    .sort((a, b) => b.score - a.score || compareNames(a.repo, b.repo));
  const repositoryScores = ranked.map(({ repo, score, evidence }) => ({
    repo,
    score,
    evidenceFileCount: evidence.length,
  }));
  const runnerUp = ranked[1] ? { repo: ranked[1].repo, score: ranked[1].score } : null;
  const winner = ranked[0];
  if (!winner || winner.score <= 0) {
    return {
      owningRepo: null,
      team: null,
      recommendationStatus: "no-evidence",
      confidence: 0,
      evidenceFiles: [],
      explanation: {
        repositoryStatus: "no-evidence",
        repositoryScores,
        runnerUp,
        ownership: { status: "missing", coverage: 0, agreement: 0, candidates: [] },
        confidenceFactors: {
          evidenceStrength: 0,
          repositoryShare: 0,
          repositoryMargin: 0,
          ownership: 0,
        },
      },
    };
  }

  // Display the bounded scoring evidence in Quarry's hybrid rank order.
  const evidenceFiles: EvidenceFile[] = [...winner.evidence]
    .sort(
      (a, b) =>
        (a.retrievalRank ?? Infinity) - (b.retrievalRank ?? Infinity) ||
        b.similarity - a.similarity ||
        compareNames(a.filePath, b.filePath),
    )
    .map((c) => ({
      repo: c.repo,
      filePath: c.filePath,
      similarity: round2(c.similarity),
      entityName: c.entityName,
    }));

  const rules = codeownersByRepo.get(winner.repo);
  const votes = new Map<string, number>();
  let covered = 0;
  for (const file of winner.evidence) {
    const owners = [...new Set(ownersForPath(rules ?? [], file.filePath))].sort(compareNames);
    if (owners.length) covered++;
    for (const owner of owners) votes.set(owner, (votes.get(owner) ?? 0) + 1 / owners.length);
  }
  const candidates = [...votes.entries()]
    .map(([owner, support]) => ({ owner, support }))
    .sort((a, b) => b.support - a.support || compareNames(a.owner, b.owner));
  const ownerTie =
    candidates.length > 1 && Math.abs(candidates[0].support - candidates[1].support) < 1e-9;
  const team = candidates.length && !ownerTie ? candidates[0].owner : null;
  const coverage = covered / winner.evidence.length;
  const agreement = covered ? candidates[0].support / covered : 0;
  const totalScore = ranked.reduce((sum, r) => sum + r.score, 0);
  const confidenceFactors = {
    evidenceStrength: winner.score,
    repositoryShare: 0.4 + 0.6 * (winner.score / totalScore),
    repositoryMargin: runnerUp ? (winner.score - runnerUp.score) / winner.score : 1,
    ownership: (0.5 + 0.5 * coverage) * (candidates.length ? agreement : 1),
  };
  const confidence = round2(
    clamp01(
      confidenceFactors.evidenceStrength *
        confidenceFactors.repositoryShare *
        confidenceFactors.repositoryMargin *
        confidenceFactors.ownership,
    ),
  );
  return {
    owningRepo: winner.repo,
    team: confidence < LOW_CONFIDENCE_THRESHOLD ? null : team,
    recommendationStatus: confidence < LOW_CONFIDENCE_THRESHOLD ? "low-confidence" : "candidate",
    confidence,
    evidenceFiles,
    explanation: {
      repositoryStatus: runnerUp?.score === winner.score ? "tied" : "selected",
      repositoryScores,
      runnerUp,
      ownership: {
        status: !rules?.length
          ? "missing"
          : !covered
            ? "unmatched"
            : candidates.length > 1
              ? "contested"
              : "assigned",
        coverage,
        agreement,
        candidates,
      },
      confidenceFactors,
    },
  };
}

/**
 * Full routing with IO: retrieve across repos, read each repo's CODEOWNERS,
 * then score. `retriever` and `repos` are injected so this is easy to drive
 * from the CLI and to substitute in tests.
 */
export async function routeTicket(
  ticket: Ticket,
  retriever: Retriever,
  repos: RepoRef[],
  topK = 12,
): Promise<RouteResult> {
  const query = `${ticket.summary}\n${ticket.description}`.trim();
  const chunks = await retriever.retrieve(query, repos, topK);
  const codeownersByRepo = new Map<string, CodeownersRule[] | null>();
  for (const repo of repos) {
    codeownersByRepo.set(repo.name, loadCodeowners(repo.path));
  }
  return routeFromChunks(chunks, codeownersByRepo);
}
