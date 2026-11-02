import { describe, expect, it } from "vitest";
import type { CodeownersRule } from "../src/codeowners.js";
import { routeFromChunks } from "../src/route.js";
import type { RetrievedChunk } from "../src/types.js";
import routingCases from "./fixtures/routing-cases.json";

function chunk(repo: string, filePath: string, similarity: number): RetrievedChunk {
  return { repo, filePath, similarity, content: "" };
}

const owned = new Map<string, CodeownersRule[]>([
  ["a", [{ pattern: "*", owners: ["@a"] }]],
  ["b", [{ pattern: "*", owners: ["@b"] }]],
]);

describe("routing credibility", () => {
  it.each(routingCases)("labelled fixture: $name", (fixture) => {
    const result = routeFromChunks(
      fixture.chunks.map((c) => ({ ...c, content: "" })),
      new Map(Object.entries(fixture.owners)),
    );
    expect(result.owningRepo).toBe(fixture.expected.repo);
    expect(result.team).toBe(fixture.expected.team);
    expect(result.explanation.repositoryStatus).toBe(fixture.expected.status);
    expect(result.confidence).toBeGreaterThanOrEqual(fixture.expected.minConfidence);
    expect(result.confidence).toBeLessThanOrEqual(fixture.expected.maxConfidence);
    expect(
      routeFromChunks(
        fixture.chunks.map((c) => ({ ...c, content: "" })).reverse(),
        new Map(Object.entries(fixture.owners)),
      ),
    ).toEqual(result);
  });

  it("selects a strong implementation match over many weak files and repeated chunks", () => {
    const strong = chunk("b", "cart.ts", 0.8);
    const weak = Array.from({ length: 20 }, (_, i) => chunk("a", `file-${i}.ts`, 0.2));
    const result = routeFromChunks([...weak, strong], owned);
    const duplicated = routeFromChunks([...weak, ...Array(30).fill(weak[0]), strong], owned);
    expect(result.owningRepo).toBe("b");
    expect(result.confidence).toBeGreaterThan(0.4);
    expect(duplicated).toEqual(result);
    expect(result.explanation.repositoryScores).toEqual([
      { repo: "b", score: 0.8, evidenceFileCount: 1 },
      { repo: "a", score: 0.2, evidenceFileCount: 5 },
    ]);
  });

  it("keeps an exact repository tie stable, visible and at zero confidence", () => {
    const chunks = [chunk("b", "b.ts", 0.9), chunk("a", "a.ts", 0.9)];
    const forward = routeFromChunks(chunks, owned);
    expect(routeFromChunks([...chunks].reverse(), owned)).toEqual(forward);
    expect(forward).toMatchObject({
      owningRepo: "a",
      confidence: 0,
      explanation: { repositoryStatus: "tied", runnerUp: { repo: "b", score: 0.9 } },
    });
  });

  it("isolates the confidence penalty for competing repositories", () => {
    const winner = chunk("a", "a.ts", 0.9);
    const clean = routeFromChunks([winner], owned);
    const contested = routeFromChunks([winner, chunk("b", "b.ts", 0.89)], owned);
    expect(contested.explanation.confidenceFactors.evidenceStrength).toBe(
      clean.explanation.confidenceFactors.evidenceStrength,
    );
    expect(clean.confidence).toBe(0.9);
    expect(contested.confidence).toBeLessThan(0.05);
    expect(contested.explanation.runnerUp?.repo).toBe("b");
  });

  it("keeps a weak match low even with complete ownership", () => {
    const result = routeFromChunks([chunk("a", "a.ts", 0.04)], owned);
    expect(result.team).toBe("@a");
    expect(result.confidence).toBe(0.04);
    expect(result.explanation.ownership.status).toBe("assigned");
  });

  it("leaves an exact owner tie unassigned and reduces confidence", () => {
    const chunks = [chunk("a", "a.ts", 0.9)];
    const rules = new Map([["a", [{ pattern: "*", owners: ["@two", "@one", "@one"] }]]]);
    const result = routeFromChunks(chunks, rules);
    expect(result.team).toBeNull();
    expect(result.confidence).toBeLessThan(routeFromChunks(chunks, owned).confidence);
    expect(result.explanation.ownership).toEqual({
      status: "contested",
      coverage: 1,
      agreement: 0.5,
      candidates: [
        { owner: "@one", support: 0.5 },
        { owner: "@two", support: 0.5 },
      ],
    });
    rules.get("a")?.[0].owners.reverse();
    expect(routeFromChunks(chunks, rules)).toEqual(result);
  });

  it("reports conflicting owners while preserving a clear majority", () => {
    const chunks = [
      chunk("a", "one.ts", 0.9),
      chunk("a", "two.ts", 0.9),
      chunk("a", "three.ts", 0.9),
    ];
    const rules = new Map([
      [
        "a",
        [
          { pattern: "*", owners: ["@one"] },
          { pattern: "three.ts", owners: ["@two"] },
        ],
      ],
    ]);
    const result = routeFromChunks(chunks, rules);
    expect(result.team).toBe("@one");
    expect(result.explanation.ownership.status).toBe("contested");
    expect(result.explanation.ownership.agreement).toBeCloseTo(2 / 3);
    expect(result.confidence).toBeLessThan(routeFromChunks(chunks, owned).confidence);
  });

  it("distinguishes missing CODEOWNERS from unmatched rules", () => {
    const chunks = [chunk("a", "app.ts", 0.9)];
    const missing = routeFromChunks(chunks, new Map());
    const unmatched = routeFromChunks(
      chunks,
      new Map([["a", [{ pattern: "docs/", owners: ["@docs"] }]]]),
    );
    expect(missing.explanation.ownership.status).toBe("missing");
    expect(unmatched.explanation.ownership.status).toBe("unmatched");
    expect(missing.team).toBeNull();
    expect(unmatched.team).toBeNull();
    expect(missing.confidence).toBe(unmatched.confidence);
  });

  it("exposes factors whose product reproduces the heuristic confidence", () => {
    const result = routeFromChunks([chunk("a", "a.ts", 0.9), chunk("b", "b.ts", 0.3)], owned);
    const factors = Object.values(result.explanation.confidenceFactors);
    expect(Number(factors.reduce((product, factor) => product * factor, 1).toFixed(2))).toBe(
      result.confidence,
    );
  });

  it("does not treat invalid or negative similarity as positive routing evidence", () => {
    const result = routeFromChunks(
      [chunk("a", "a.ts", Number.NaN), chunk("a", "b.ts", -0.5)],
      owned,
    );
    expect(result.owningRepo).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
