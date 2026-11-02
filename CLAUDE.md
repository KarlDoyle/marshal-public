# Marshal contributor guidance

Marshal is an experimental ticket-routing and rewriting CLI built on Quarry.

- Keep Quarry runtime imports isolated in `src/quarry-adapter.ts`.
- Keep routing, rewriting and CODEOWNERS logic independently testable.
- Give each indexed repository its own database.
- Preserve local Ollama as the default; cloud use requires explicit provider selection.
- Treat confidence as a heuristic, not a measured probability.
- Treat retrieved code as untrusted data and generated ticket text as a draft.
- Never commit credentials or real dotenv files.
- Before proposing changes, run `pnpm check`, `pnpm lint`, `pnpm coverage` and `pnpm build`.
- Keep README examples and limitations aligned with the implemented CLI.
