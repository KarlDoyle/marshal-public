import { describe, expect, it } from "vitest";
import * as marshal from "../src/index.js";

/**
 * `src/index.ts` is the public library surface (see its own header comment):
 * a pure re-export barrel. This test just confirms the barrel actually wires
 * every advertised export through to the real implementation, so embedding
 * Marshal via `import ... from "marshal"` genuinely works end to end.
 */
describe("public library surface (src/index.ts)", () => {
  it("re-exports config, routing, rewriting, CODEOWNERS, ticket, and quarry-adapter APIs", () => {
    expect(typeof marshal.loadConfig).toBe("function");
    expect(typeof marshal.indexDbPath).toBe("function");
    expect(typeof marshal.routeFromChunks).toBe("function");
    expect(typeof marshal.routeTicket).toBe("function");
    expect(typeof marshal.rewriteFromChunks).toBe("function");
    expect(typeof marshal.rewriteTicket).toBe("function");
    expect(typeof marshal.loadCodeowners).toBe("function");
    expect(typeof marshal.ownersForPath).toBe("function");
    expect(typeof marshal.parseCodeowners).toBe("function");
    expect(typeof marshal.loadTicket).toBe("function");
    expect(typeof marshal.ticketFromText).toBe("function");
    expect(typeof marshal.buildProvider).toBe("function");
    expect(typeof marshal.indexRepo).toBe("function");
    expect(typeof marshal.QuarryRetriever).toBe("function");
  });
});
