/**
 * Marshal — public library surface. The CLI is the common path; import these
 * to embed ticket routing / rewriting in your own tooling.
 */

export { loadCodeowners, ownersForPath, parseCodeowners } from "./codeowners.js";
export { indexDbPath, loadConfig, type MarshalConfig } from "./config.js";
export {
  buildProvider,
  indexRepo,
  type LLMProvider,
  QuarryRetriever,
} from "./quarry-adapter.js";
export { rewriteFromChunks, rewriteTicket } from "./rewrite.js";
export { routeFromChunks, routeTicket } from "./route.js";
export { loadTicket, ticketFromText } from "./ticket.js";
export type {
  EnrichedTicket,
  EvidenceFile,
  RepoRef,
  RetrievedChunk,
  Retriever,
  RouteResult,
  Ticket,
} from "./types.js";
