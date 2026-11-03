# Marshal

**Code-grounded ticket routing and refinement.**

Marshal takes a thin engineering ticket, searches across indexed repositories, identifies likely ownership from code evidence and CODEOWNERS, and can turn the original report into a more structured implementation brief.

It is an **experimental portfolio MVP**, deliberately focused on the routing and rewriting workflow. It has no UI, and its live Jira integration is minimal.

Maintained by [Karl Doyle](https://github.com/KarlDoyle). Source: [github.com/KarlDoyle/marshal-public](https://github.com/KarlDoyle/marshal-public).

## The workflow

1. **Index repositories:** maintain separate local indexes so multiple codebases can be searched together.
2. **Retrieve evidence:** use Quarry's retrieval engine to find source files relevant to the ticket.
3. **Route ownership:** group evidence by repository and use CODEOWNERS information to identify a likely owning repository and team when matching rules exist.
4. **Score confidence:** account for evidence strength, ambiguity between repositories and whether ownership can be established.
5. **Rewrite the ticket:** optionally use a local LLM to produce a structured brief with likely affected files, acceptance criteria and a definition of done.

The intention is not to manufacture certainty from a vague ticket. Weak or ambiguous evidence should result in low confidence.

## Architecture

Marshal reuses Quarry rather than implementing a second retrieval system. Quarry provides the local indexing, embeddings, vector store and LLM provider interfaces.

Marshal adds three focused layers:

- **Multi-repository indexing:** separate databases and a small registry allow repositories to coexist.
- **Ownership routing:** retrieval evidence is grouped by repository and combined with CODEOWNERS data. The route includes the owning repository, team, confidence and evidence files.
- **Ticket rewriting:** a local LLM receives retrieved code context and returns a structured enriched ticket. The LLM is injected, making the rewrite path testable independently.

The Quarry integration is isolated in [`src/quarry-adapter.ts`](src/quarry-adapter.ts). Routing and rewriting are implemented in [`src/route.ts`](src/route.ts) and [`src/rewrite.ts`](src/rewrite.ts).

## Confidence is allowed to be low

Confidence is a heuristic score, not a measured probability that a route is correct. It combines:

- The mean dense similarity of up to five strongest distinct files per repository. Repeated chunks from a file do not add votes, and repositories do not win simply by returning more chunks.
- The winning repository's score share and margin over the runner-up.
- CODEOWNERS coverage and agreement between the owners of the evidence files. A file with multiple owners divides its vote between them.

Weak matches, competing repositories and missing ownership information reduce confidence. This is an important behaviour: the tool should expose uncertainty rather than disguise it.

An exact repository tie is shown explicitly with zero confidence; repository-name order chooses the displayed candidate consistently. An exact owner tie leaves the team unassigned. Without positive similarity, no repository is recommended. Route JSON includes an `explanation` with repository scores, the runner-up, ownership candidates and the four factors whose product produces confidence. Evidence files are shown in Quarry's hybrid rank order after the five-file scoring limit is applied.

Routes below heuristic confidence 0.05 are marked `recommendationStatus: "low-confidence"`. The repository and evidence remain visible for investigation, while the top-level team is left unset; ownership candidates remain in the explanation. At 0.05 and above, `recommendationStatus` is `"candidate"`. This provisional display threshold is based on a small synthetic practical evaluation, not calibrated routing accuracy.

Retrieval still has a global chunk budget (12 by default). Repository-name order makes the round-robin merge reproducible; it does not establish relevance. A budget smaller than the number of repositories can omit repositories. Routing only compares the evidence retrieved and is not a representative accuracy evaluation.

## Current status and limitations

- **MVP / spike:** the CLI workflow exists; this is not a finished product.
- **No UI:** interaction is through the command line.
- **Jira:** live Jira support is a thin client. The offline fixture path is the tested route.
- **CODEOWNERS:** support covers a common-glob subset, not the full GitHub specification.
- **Routing quality:** depends on the quality and coverage of the indexed repositories and their CODEOWNERS files.
- **Generated drafts:** every draft includes a source-review warning because acceptance criteria can describe behaviour already implemented. Output validation checks structure and evidence paths, not whether proposed changes are needed.
- **Validation:** the 2 November 2026 combined dependency review passed 61 tests and the enforced coverage thresholds. CLI smoke tests verify help and empty-registry guidance; they do not provide in-process CLI coverage. See [validation notes](docs/VALIDATION.md).

## Run it

Requirements: Node.js 24+, pnpm and Ollama with a model for rewriting. Marshal uses the versioned `@mrkarldoyle/quarry` package for code indexing and retrieval. The first index run downloads the embedding model from Hugging Face; cached indexing and retrieval then run locally. Ollama defaults to localhost, even if an Anthropic API key is configured. Anthropic is used only when `MARSHAL_PROVIDER=anthropic` is explicitly selected. A remote `OLLAMA_HOST` also sends ticket text and retrieved code to that server.

For rewriting, start `ollama serve` in another terminal, then run `ollama pull llama3.1`. Indexing and routing do not require Ollama.

```bash
git clone https://github.com/KarlDoyle/marshal-public.git
cd marshal-public
pnpm install --frozen-lockfile
pnpm build

# Explicit local settings for the examples (environment variables configure Marshal)
export MARSHAL_PROVIDER=ollama
export MARSHAL_MODEL=llama3.1
export OLLAMA_HOST=http://127.0.0.1:11434

# Index two or more repositories
node --experimental-sqlite dist/cli.js index <repoPath...>

# Route a saved Jira issue fixture
node --experimental-sqlite dist/cli.js route tests/fixtures/jira-issue.json

# Rewrite a thin ticket into a code-grounded brief
node --experimental-sqlite dist/cli.js rewrite-ticket tests/fixtures/jira-issue.json

# Route and rewrite a plain-English ticket in one step
node --experimental-sqlite dist/cli.js triage "Cart total is wrong when a discount and tax both apply"
```

A ticket argument can be a saved Jira JSON file, a live Jira key or a plain-English problem description. Missing JSON/explicit file paths fail with a path error. Live keys require `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_TOKEN`; an unconfigured key is not treated as ticket text. Saved issues require a non-empty `key` and `fields.summary`.

Configuration is read from the process environment. `.env.example` is a reference; copying it to `.env` does not load it automatically. Export values in your shell or explicitly use `node --env-file=.env --experimental-sqlite dist/cli.js <command>`.

### Draft validation and limits

Rewrites require a non-empty description, acceptance criteria and definition of done, plus a string array of suggested files (which may be empty). Malformed or incomplete model output fails with an error. `likelyAffectedFiles` contains repository-qualified paths supported by the context actually supplied; unsupported or ambiguous suggestions move to `unsupportedFiles` and trigger a warning. `evidenceFiles` records the supplied sources, not proof that a change is necessary.

The model receives at most 12 source chunks, 2,000 characters per chunk and 10,000 source-context characters including headings, plus 3,000 ticket characters. Truncation is reported in `warnings`. These are character limits, not model-specific token guarantees. `triage --top-k` accepts integers from 1 to 100; increasing retrieval does not increase the rewrite context limits. Route evidence can therefore include files omitted from the draft's context.

Every successful rewrite includes a draft warning. The model is asked to flag existing behaviour, but source review remains necessary: validation cannot establish correctness, prevent all prompt injection or determine that suggested acceptance criteria represent missing functionality.

### Existing indexes after the identity fix

Database filenames now use a versioned hash of the full registry name, preventing punctuation or case differences from sharing an index. Registry names and repository paths are preserved. Rebuild every registered repository once with `node --experimental-sqlite dist/cli.js index <repoPath...>`, using the same `MARSHAL_DATA_DIR` as before (default `~/.marshal`). Routing reports a rebuild instruction if a current-format index is missing. Legacy database files are left untouched and are not reused: a previously shared index cannot reliably be attributed to either repository.

## Testing

The tests exercise routing heuristics with fake retrieval, labelled regression cases and real CODEOWNERS fixtures. Rewrite tests use a mock LLM to check validation, context bounds, path support and draft warnings. Indexing tests use real SQLite stores and Quarry's indexer with fixed offline embeddings. CLI smoke tests cover help, input errors and empty-registry guidance; Jira HTTP responses are mocked. The suite runs offline without a model or network connection. GitHub Actions runs typecheck, lint, coverage-enforced tests and a build; see the [current workflow results](https://github.com/KarlDoyle/marshal-public/actions).

## Engineering approach

AI assistants helped accelerate implementation and test development. I chose the architecture, reviewed the retrieval and routing behaviour, and decide what ships.

## Build and quality practices

TypeScript checks, Biome linting, coverage-enforced Vitest tests, CI, a pre-push gate and a pattern-based secret scan provide repeatable checks. Human review remains responsible for accepting changes.

## Relationship to Quarry

Quarry is the retrieval engine; Marshal is a workflow built on top of it. This separation keeps code indexing and retrieval reusable while allowing ticket routing and refinement to evolve independently.

## Licence

Marshal is licensed under the MIT License. See [LICENSE](LICENSE).
