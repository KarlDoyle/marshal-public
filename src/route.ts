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

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Pure routing logic: given retrieved chunks (already tagged by repo) and each
 * repo's parsed CODEOWNERS (null when the repo has none), decide the owning
 * repo, the team, a calibrated confidence, and the evidence.
 *
 * Confidence is built to be HONEST, not always-high. It multiplies three
 * factors, each in [0,1]:
 *   - meanSim:      mean similarity of the winning repo's top evidence (how
 *                   strongly the code actually matches the ticket).
 *   - repoShare-ish: 0.4 + 0.6 * (winnerScore / totalScore) — penalises an
 *                   ambiguous split where several repos look equally relevant.
 *   - ownerFactor:  0.5 + 0.5 * ownerCoverage — halved when CODEOWNERS is
 *                   absent or doesn't cover the evidence, because we then can't
 *                   actually name the team with confidence.
 * Weak matches, contested repos, and missing CODEOWNERS all drag it down.
 */
export function routeFromChunks(
  chunks: RetrievedChunk[],
  codeownersByRepo: Map<string, CodeownersRule[] | null>,
): RouteResult {
  if (chunks.length === 0) {
    return { owningRepo: null, team: null, confidence: 0, evidenceFiles: [] };
  }

  // Sum similarity per repo to find the winner; track totals for ambiguity.
  const scoreByRepo = new Map<string, number>();
  for (const c of chunks) {
    scoreByRepo.set(c.repo, (scoreByRepo.get(c.repo) ?? 0) + c.similarity);
  }
  const totalScore = [...scoreByRepo.values()].reduce((a, b) => a + b, 0);
  const ranked = [...scoreByRepo.entries()].sort((a, b) => b[1] - a[1]);
  const [owningRepo, winnerScore] = ranked[0];

  // Keep Quarry's hybrid rank order; dense cosine is a separate signal and can
  // disagree with the fused lexical + vector ordering.
  const bestByFile = new Map<string, RetrievedChunk>();
  for (const c of chunks.filter((c) => c.repo === owningRepo)) {
    const previous = bestByFile.get(c.filePath);
    if (!previous || c.similarity > previous.similarity) bestByFile.set(c.filePath, c);
  }
  const evidenceFiles: EvidenceFile[] = [];
  for (const c of [...bestByFile.values()].sort(
    (a, b) => (a.retrievalRank ?? 0) - (b.retrievalRank ?? 0),
  )) {
    evidenceFiles.push({
      repo: c.repo,
      filePath: c.filePath,
      similarity: round2(c.similarity),
      entityName: c.entityName,
    });
  }

  const topEvidence = evidenceFiles.slice(0, EVIDENCE_TOP_N);
  const meanSim = topEvidence.reduce((a, e) => a + e.similarity, 0) / (topEvidence.length || 1);

  // Team from CODEOWNERS: most common owner across the evidence files.
  const rules = codeownersByRepo.get(owningRepo) ?? null;
  let team: string | null = null;
  let coveredFiles = 0;
  if (rules && rules.length > 0) {
    const ownerVotes = new Map<string, number>();
    for (const e of topEvidence) {
      const owners = ownersForPath(rules, e.filePath);
      if (owners.length > 0) coveredFiles++;
      for (const o of owners) ownerVotes.set(o, (ownerVotes.get(o) ?? 0) + 1);
    }
    const top = [...ownerVotes.entries()].sort((a, b) => b[1] - a[1])[0];
    team = top ? top[0] : null;
  }
  const ownerCoverage = topEvidence.length > 0 ? coveredFiles / topEvidence.length : 0;

  const repoShareFactor = 0.4 + 0.6 * (totalScore > 0 ? winnerScore / totalScore : 1);
  const ownerFactor = 0.5 + 0.5 * ownerCoverage;
  const confidence = round2(clamp01(meanSim * repoShareFactor * ownerFactor));

  return { owningRepo, team, confidence, evidenceFiles: topEvidence };
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
