import { describe, expect, it } from "vitest";
import type { MarshalConfig } from "../src/config.js";
import { buildProvider } from "../src/quarry-adapter.js";

/**
 * buildProvider only *constructs* provider objects — it never calls
 * `.complete()` — so these assertions exercise the real selection logic
 * without touching Ollama, moss, or the network.
 */
function config(overrides: Partial<MarshalConfig> = {}): MarshalConfig {
  return {
    dataDir: "/tmp/marshal-test",
    provider: "ollama",
    model: "llama3.1",
    ollamaHost: "http://127.0.0.1:11434",
    anthropicApiKey: undefined,
    ...overrides,
  };
}

describe("buildProvider", () => {
  it("defaults to a direct Ollama provider when no key is configured", () => {
    const llm = buildProvider(config());
    expect(llm.name).toBe("ollama");
    expect(llm.model).toBe("llama3.1");
  });

  it("stays local when an Anthropic key exists but cloud use was not explicitly selected", () => {
    const llm = buildProvider(config({ anthropicApiKey: "sk-ant-test" }));
    expect(llm.name).toBe("ollama");
    expect(llm.model).toBe("llama3.1");
  });

  it("routes through moss, falling back to Ollama, when provider=moss", () => {
    const llm = buildProvider(config({ provider: "moss", model: "moss-model" }));
    expect(llm.name).toBe("moss→ollama");
    expect(llm.model).toBe("moss-model");
  });

  it("uses Anthropic directly when provider=anthropic and a key is set", () => {
    const llm = buildProvider(
      config({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        anthropicApiKey: "sk-ant-test",
      }),
    );
    expect(llm.name).toBe("anthropic");
    expect(llm.model).toBe("claude-haiku-4-5-20251001");
  });

  it("throws a clear error when provider=anthropic but no key is set", () => {
    expect(() => buildProvider(config({ provider: "anthropic" }))).toThrow(
      /ANTHROPIC_API_KEY is not set/,
    );
  });
});
