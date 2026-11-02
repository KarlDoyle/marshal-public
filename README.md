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

- How strongly retrieved code matches the ticket.
- Whether one repository clearly wins over alternatives.
- Whether CODEOWNERS can identify a team.

Weak matches, competing repositories and missing ownership information reduce confidence. This is an important behaviour: the tool should expose uncertainty rather than disguise it.

## Current status and limitations

- **MVP / spike:** the CLI workflow exists; this is not a finished product.
- **No UI:** interaction is through the command line.
- **Jira:** live Jira support is a thin client. The offline fixture path is the tested route.
- **CODEOWNERS:** support covers a common-glob subset, not the full GitHub specification.
- **Routing quality:** depends on the quality and coverage of the indexed repositories and their CODEOWNERS files.
- **Generated drafts:** suggested acceptance criteria can describe behaviour already implemented. Review the source before treating a generated draft as a required fix.
- **Validation:** the 2 November 2026 combined dependency review passed 61 tests and the enforced coverage thresholds. CLI smoke tests verify help and empty-registry guidance; they do not provide in-process CLI coverage. See [validation notes](docs/VALIDATION.md).

## Run it

Requirements: Node.js 24+, pnpm and a local Ollama model for rewriting. Marshal uses the versioned `@mrkarldoyle/quarry` package for code indexing and retrieval. Ollama is the default and remains local even if an Anthropic API key is configured. Cloud processing is used only when `MARSHAL_PROVIDER=anthropic` is explicitly selected.

```bash
git clone https://github.com/KarlDoyle/marshal-public.git
cd marshal-public
pnpm install --frozen-lockfile
pnpm build

# Index two or more repositories
node --experimental-sqlite dist/cli.js index <repoPath...>

# Route a saved Jira issue fixture
node --experimental-sqlite dist/cli.js route tests/fixtures/jira-issue.json

# Rewrite a thin ticket into a code-grounded brief
node --experimental-sqlite dist/cli.js rewrite-ticket tests/fixtures/jira-issue.json

# Route and rewrite a plain-English ticket in one step
node --experimental-sqlite dist/cli.js triage "Cart total is wrong when a discount and tax both apply"
```

Start Ollama and pull a model such as `llama3.1` for local rewriting. A ticket argument can be a saved Jira JSON file, a live Jira key (with Jira credentials configured), or a plain one-line problem description.

### Existing indexes after the identity fix

Database filenames now use a versioned hash of the full registry name, preventing punctuation or case differences from sharing an index. Registry names and repository paths are preserved. Rebuild every registered repository once with `node --experimental-sqlite dist/cli.js index <repoPath...>`, using the same `MARSHAL_DATA_DIR` as before (default `~/.marshal`). Routing reports a rebuild instruction if a current-format index is missing. Legacy database files are left untouched and are not reused: a previously shared index cannot reliably be attributed to either repository.

## Testing

The tests exercise routing with a fake retriever and real CODEOWNERS fixtures, including confidence-calibration properties. The rewrite tests use a mock LLM to verify structured output and evidence handling. Adapter tests cover Quarry result mapping and resource cleanup with mocked stores; CLI smoke tests cover help and the no-indexed-repositories path. The suite runs offline without a model or network connection. GitHub Actions runs typecheck, lint, coverage-enforced tests and a build; see the [current workflow results](https://github.com/KarlDoyle/marshal-public/actions).

## Engineering approach

AI assistants helped accelerate implementation and test development. I chose the architecture, reviewed the retrieval and routing behaviour, and decide what ships.

## Build and quality practices

TypeScript checks, Biome linting, coverage-enforced Vitest tests, CI, a pre-push gate and a pattern-based secret scan provide repeatable checks. Human review remains responsible for accepting changes.

## Relationship to Quarry

Quarry is the retrieval engine; Marshal is a workflow built on top of it. This separation keeps code indexing and retrieval reusable while allowing ticket routing and refinement to evolve independently.

## Licence

Marshal is licensed under the MIT License. See [LICENSE](LICENSE).
