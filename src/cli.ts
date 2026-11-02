#!/usr/bin/env -S node --experimental-sqlite
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { type CodeownersRule, loadCodeowners } from "./codeowners.js";
import { loadConfig, loadRegistry, type Registry, registryName, saveRegistry } from "./config.js";
import { buildProvider, indexRepo, QuarryRetriever } from "./quarry-adapter.js";
import { rewriteFromChunks, rewriteTicket } from "./rewrite.js";
import { routeFromChunks, routeTicket } from "./route.js";
import { loadTicket } from "./ticket.js";
import type { RepoRef } from "./types.js";

const program = new Command();
program
  .name("marshal")
  .description(
    "Ticket intelligence on Quarry: route a ticket to the owning repo/team, " +
      "and rewrite it into a reviewable draft brief. Local-first, no API key by default.",
  )
  .version("0.1.0");

/** Registry entries → RepoRefs the core consumes. */
function reposFromRegistry(registry: Registry): RepoRef[] {
  return Object.values(registry).map((e) => ({ name: e.name, path: e.path }));
}

function defaultDemoRepos(): string[] {
  return [join(homedir(), "Dev/quarry"), join(homedir(), "Dev/moss")];
}

program
  .command("index")
  .description("Index one or more repos (default: the demo repos quarry + moss)")
  .argument("[repoPath...]", "paths to local repos to index")
  .action(async (repoPaths: string[]) => {
    const config = loadConfig();
    const targets = (repoPaths.length ? repoPaths : defaultDemoRepos()).map((p) => resolve(p));
    const registry = loadRegistry(config.dataDir);

    for (const repoPath of targets) {
      if (!existsSync(repoPath)) {
        console.error(`Skipping missing path: ${repoPath}`);
        continue;
      }
      const name = registryName(registry, repoPath);
      console.log(`Indexing ${name} (${repoPath}) …`);
      const result = await indexRepo(config, name, repoPath);
      registry[name] = {
        name,
        path: repoPath,
        files: result.files,
        chunks: result.chunks,
        indexedAt: new Date().toISOString(),
      };
      saveRegistry(config.dataDir, registry);
      console.log(`  ✓ ${result.files} files → ${result.chunks} chunks`);
    }
    const names = Object.keys(registry);
    console.log(`\nIndexed repos: ${names.length ? names.join(", ") : "(none)"}`);
  });

program
  .command("route")
  .description("Route a ticket to the owning repo + team, with heuristic confidence")
  .argument("<ticketFileOrKey>", "Jira JSON path, live Jira key, or plain-English description")
  .action(async (ticketFileOrKey: string) => {
    const config = loadConfig();
    const registry = loadRegistry(config.dataDir);
    const repos = reposFromRegistry(registry);
    if (repos.length === 0) {
      console.error("No repos indexed yet. Run `marshal index <repoPath...>` first.");
      process.exit(1);
    }
    const ticket = await loadTicket(ticketFileOrKey);
    const retriever = new QuarryRetriever(config.dataDir);
    const result = await routeTicket(ticket, retriever, repos);
    console.log(`\n# Route: ${ticket.key} — ${ticket.summary}\n`);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("rewrite-ticket")
  .description("Rewrite a thin ticket into a reviewable draft implementation brief")
  .argument("<ticketFileOrKey>", "Jira JSON path, live Jira key, or plain-English description")
  .action(async (ticketFileOrKey: string) => {
    const config = loadConfig();
    const registry = loadRegistry(config.dataDir);
    const repos = reposFromRegistry(registry);
    if (repos.length === 0) {
      console.error("No repos indexed yet. Run `marshal index <repoPath...>` first.");
      process.exit(1);
    }
    const ticket = await loadTicket(ticketFileOrKey);
    const retriever = new QuarryRetriever(config.dataDir);
    const llm = buildProvider(config);
    const enriched = await rewriteTicket(ticket, retriever, repos, llm);
    console.log(`\n# Rewritten: ${enriched.key} — ${enriched.title}\n`);
    console.log(JSON.stringify(enriched, null, 2));
    console.log(`\n(via ${llm.name}: ${llm.model})`);
  });

program
  .command("triage")
  .description(
    "One shot: route a ticket to its owning repo/team with heuristic confidence " +
      "AND rewrite it into a reviewable draft brief. Accepts a one-line problem in plain " +
      "English, a Jira issue JSON path, or a live Jira key.",
  )
  .argument("<ticket>", "a one-line problem, a Jira issue JSON path, or a live Jira key")
  .option(
    "--top-k <n>",
    "how many code chunks to retrieve (1–100)",
    (value: string) => {
      const count = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(count) || count < 1 || count > 100) {
        throw new InvalidArgumentError("must be an integer between 1 and 100");
      }
      return count;
    },
    12,
  )
  .action(async (ticketArg: string, opts: { topK: number }) => {
    const config = loadConfig();
    const registry = loadRegistry(config.dataDir);
    const repos = reposFromRegistry(registry);
    if (repos.length === 0) {
      console.error("No repos indexed yet. Run `marshal index <repoPath...>` first.");
      process.exit(1);
    }
    const ticket = await loadTicket(ticketArg);
    const topK = opts.topK;

    // Retrieve once, then route AND rewrite off the same evidence — one engine,
    // two products, no double work.
    const retriever = new QuarryRetriever(config.dataDir);
    const query = `${ticket.summary}\n${ticket.description}`.trim();
    const chunks = await retriever.retrieve(query, repos, topK);

    const codeownersByRepo = new Map<string, CodeownersRule[] | null>();
    for (const repo of repos) codeownersByRepo.set(repo.name, loadCodeowners(repo.path));
    const route = routeFromChunks(chunks, codeownersByRepo);

    const llm = buildProvider(config);
    const enrichedSpec = await rewriteFromChunks(ticket, chunks, llm);

    console.log(
      JSON.stringify(
        {
          ticket: { key: ticket.key, summary: ticket.summary },
          route,
          enrichedSpec,
          via: `${llm.name}: ${llm.model}`,
        },
        null,
        2,
      ),
    );
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
