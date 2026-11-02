import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  indexDbPath,
  loadConfig,
  loadRegistry,
  registryName,
  saveRegistry,
} from "../src/config.js";

const ENV_KEYS = [
  "MARSHAL_DATA_DIR",
  "MARSHAL_PROVIDER",
  "MARSHAL_MODEL",
  "OLLAMA_HOST",
  "ANTHROPIC_API_KEY",
] as const;

describe("loadConfig", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to ollama, llama3.1, and ~/.marshal when nothing is set", () => {
    const config = loadConfig();
    expect(config.provider).toBe("ollama");
    expect(config.model).toBe("llama3.1");
    expect(config.dataDir.endsWith(".marshal")).toBe(true);
    expect(config.ollamaHost).toBe("http://127.0.0.1:11434");
    expect(config.anthropicApiKey).toBeUndefined();
  });

  it("resolves MARSHAL_DATA_DIR relative to the cwd", () => {
    process.env.MARSHAL_DATA_DIR = "some/relative/dir";
    expect(loadConfig().dataDir).toBe(resolve("some/relative/dir"));
  });

  it("picks the anthropic default model when MARSHAL_PROVIDER=anthropic", () => {
    process.env.MARSHAL_PROVIDER = "anthropic";
    const config = loadConfig();
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-haiku-4-5-20251001");
  });

  it("recognises MARSHAL_PROVIDER=moss", () => {
    process.env.MARSHAL_PROVIDER = "moss";
    expect(loadConfig().provider).toBe("moss");
  });

  it("falls back to ollama for an unrecognised MARSHAL_PROVIDER", () => {
    process.env.MARSHAL_PROVIDER = "some-other-thing";
    expect(loadConfig().provider).toBe("ollama");
  });

  it("lets MARSHAL_MODEL override the provider's default model", () => {
    process.env.MARSHAL_PROVIDER = "moss";
    process.env.MARSHAL_MODEL = "custom-model";
    expect(loadConfig().model).toBe("custom-model");
  });

  it("passes through OLLAMA_HOST and ANTHROPIC_API_KEY when set", () => {
    process.env.OLLAMA_HOST = "http://example.internal:1234";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const config = loadConfig();
    expect(config.ollamaHost).toBe("http://example.internal:1234");
    expect(config.anthropicApiKey).toBe("sk-ant-test");
  });
});

describe("indexDbPath", () => {
  it("builds a per-repo db path under indexes/", () => {
    expect(indexDbPath("/data", "quarry")).toBe(join("/data", "indexes", "quarry.db"));
  });

  it("sanitises characters unsafe for a filename", () => {
    expect(indexDbPath("/data", "my repo/v2.0")).toBe(join("/data", "indexes", "my_repo_v2_0.db"));
  });
});

describe("registryName", () => {
  it("preserves the existing basename identity for an indexed repository", () => {
    const registry = {
      api: { name: "api", path: "/work/one/api", files: 1, chunks: 1, indexedAt: "now" },
    };
    expect(registryName(registry, "/work/one/api")).toBe("api");
  });

  it("assigns a deterministic distinct key to a second repository with the same basename", () => {
    const registry = {
      api: { name: "api", path: "/work/one/api", files: 1, chunks: 1, indexedAt: "now" },
    };
    const name = registryName(registry, "/work/two/api");
    expect(name).not.toBe("api");
    expect(name).toBe(registryName(registry, "/work/two/api"));
  });

  it("refuses to overwrite an existing hashed identity", () => {
    const repoPath = "/work/two/api";
    const suffix = createHash("sha256").update(repoPath).digest("hex").slice(0, 10);
    const registry = {
      api: { name: "api", path: "/work/one/api", files: 1, chunks: 1, indexedAt: "now" },
      [`api-${suffix}`]: {
        name: `api-${suffix}`,
        path: "/work/other/api",
        files: 1,
        chunks: 1,
        indexedAt: "now",
      },
    };
    expect(() => registryName(registry, repoPath)).toThrow(/refusing to overwrite/);
  });
});

describe("loadRegistry / saveRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "marshal-config-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty registry when nothing has been saved yet", () => {
    expect(loadRegistry(dir)).toEqual({});
  });

  it("round-trips a saved registry, creating the data dir if needed", () => {
    const nested = join(dir, "nested", "data");
    const registry = {
      quarry: { name: "quarry", path: "/x", files: 3, chunks: 9, indexedAt: "2026-01-01" },
    };
    saveRegistry(nested, registry);
    expect(loadRegistry(nested)).toEqual(registry);
  });

  it("returns an empty registry for corrupt JSON rather than throwing", () => {
    writeFileSync(join(dir, "registry.json"), "{ not valid json");
    expect(loadRegistry(dir)).toEqual({});
  });
});
