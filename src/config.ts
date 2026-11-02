import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

/**
 * Marshal keeps its state (per-repo indexes + a registry) on disk, no server.
 * Defaults to `~/.marshal`; override with MARSHAL_DATA_DIR. The LLM step,
 * like Quarry, defaults to local Ollama with NO API key.
 */
export interface MarshalConfig {
  dataDir: string;
  provider: "ollama" | "anthropic" | "moss";
  model: string;
  ollamaHost: string;
  anthropicApiKey: string | undefined;
}

export function loadConfig(): MarshalConfig {
  const dataDir = process.env.MARSHAL_DATA_DIR
    ? resolve(process.env.MARSHAL_DATA_DIR)
    : join(homedir(), ".marshal");
  // `moss` routes generation through moss's local-first router (still Ollama under
  // the hood, no key); `anthropic` bills the API; default is direct Ollama.
  const envProvider = process.env.MARSHAL_PROVIDER;
  const provider =
    envProvider === "anthropic" ? "anthropic" : envProvider === "moss" ? "moss" : "ollama";
  const defaultModel = provider === "anthropic" ? "claude-haiku-4-5-20251001" : "llama3.1";
  return {
    dataDir,
    provider,
    model: process.env.MARSHAL_MODEL ?? defaultModel,
    ollamaHost: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  };
}

/**
 * Versioned identity avoids lossy sanitisation and case-insensitive filename
 * collisions. Registry names stay unchanged; legacy indexes must be rebuilt.
 */
export function indexDbPath(dataDir: string, repoName: string): string {
  const identity = createHash("sha256").update(repoName).digest("hex");
  return join(dataDir, "indexes", `v2-${identity}.db`);
}

export interface RegistryEntry {
  name: string;
  path: string;
  files: number;
  chunks: number;
  indexedAt: string;
}

export type Registry = Record<string, RegistryEntry>;

/**
 * Preserve the historical basename identity for existing data. If another
 * repository has the same basename, key the additional repository by path hash.
 */
export function registryName(registry: Registry, repoPath: string): string {
  const base = basename(repoPath);
  const existing = registry[base];
  if (!existing || resolve(existing.path) === repoPath) return base;

  const suffix = createHash("sha256").update(repoPath).digest("hex").slice(0, 10);
  const candidate = `${base}-${suffix}`;
  const collision = registry[candidate];
  if (collision && resolve(collision.path) !== repoPath) {
    throw new Error(
      `Repository identity collision for ${repoPath}; refusing to overwrite ${collision.path}`,
    );
  }
  return candidate;
}

function registryPath(dataDir: string): string {
  return join(dataDir, "registry.json");
}

export function loadRegistry(dataDir: string): Registry {
  const p = registryPath(dataDir);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as Registry;
  } catch {
    return {};
  }
}

export function saveRegistry(dataDir: string, registry: Registry): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(registryPath(dataDir), `${JSON.stringify(registry, null, 2)}\n`);
}
