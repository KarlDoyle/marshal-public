# Validation notes

## Scope

On 2 November 2026, the combined dependency-age cleanup and development-dependency update passed frozen-lockfile installation, typechecking, lint, all 61 tests, coverage thresholds and build. The dependency audit reported zero advisories for that locked tree at the time of the check. These are dated results, not a promise about future advisories. The current source is an experimental portfolio MVP.

Coverage in that run was 69.69% statements, 82.48% branches, 76.08% functions and 68.46% lines. The CLI smoke tests cover help and empty-registry guidance. Unit and adapter tests use mocked dependencies; they are separate from the live checks below.

## Practical workflow check

The preceding live check used published Quarry 0.2.2 with separate indexes for clean Moss and Marshal source snapshots and the local Ollama llama3.1 model. Indexing, ticket routing, triage and rewriting completed. The provider-router ticket selected Moss; the repository-name-collision ticket selected Marshal. Returned evidence and suggested file paths existed in those snapshots. No live Jira credentials or cloud model were used.

These examples establish that the workflow executed, not general routing accuracy. A generated draft proposed adding behaviour already present in the code. Review the source before turning generated acceptance criteria into implementation work. Missing CODEOWNERS coverage leaves the team unassigned, and confidence is a heuristic score rather than a calibrated probability.

## Retrieval check

The 28-question Moss evaluation used published Quarry 0.2.2 and Moss public snapshot `6e90118`: 224 indexed files and 2,275 chunks, with the local Xenova/all-MiniLM-L6-v2 embedding model. The questions and expected paths were hand-authored for an earlier Moss snapshot. They are a small, author-labelled set.

| Mode | Recall@1 | Recall@3 | Recall@5 | MRR@10 |
|---|---:|---:|---:|---:|
| Hybrid | 46.4% | 67.9% | 85.7% (24/28) | 0.619 |
| Dense only | 64.3% | 75.0% | 89.3% (25/28) | 0.732 |

Recall measures whether any expected path appears among the top retrieved chunks, not unique files. These results are retrieval measurements, not generated-answer correctness or general accuracy. Dense-only scored higher on this corpus; the production default remains unchanged. A changed corpus prevents treating this as a controlled improvement over earlier results.

## Recheck a source checkout

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm coverage
pnpm build
pnpm audit
node --experimental-sqlite dist/cli.js --help
```

For a practical run, set `MARSHAL_DATA_DIR` to a separate test folder, index only repositories you are authorised to use, then run `route`, `rewrite-ticket` or `triage`. Local rewriting requires Ollama and its configured model. Live Jira ingestion remains outside this validation.
