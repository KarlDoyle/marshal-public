import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCodeowners, ownersForPath, parseCodeowners } from "../src/codeowners.js";

const REPO = join(import.meta.dirname, "fixtures/repos/payments-svc");

describe("parseCodeowners", () => {
  it("ignores comments and blank lines, keeps pattern + owners", () => {
    const rules = parseCodeowners("# c\n\n*  @a @b\nsrc/  @team\n");
    expect(rules).toEqual([
      { pattern: "*", owners: ["@a", "@b"] },
      { pattern: "src/", owners: ["@team"] },
    ]);
  });

  it("preserves ownerless overrides", () => {
    expect(parseCodeowners("* @a\nsrc/private/ # deliberately unowned\n")).toEqual([
      { pattern: "*", owners: ["@a"] },
      { pattern: "src/private/", owners: [] },
    ]);
  });
});

describe("ownersForPath glob forms", () => {
  it("does not let a terminal single star match nested files", () => {
    const rules = parseCodeowners("* @default\ndocs/* @docs");
    expect(ownersForPath(rules, "docs/readme.md")).toEqual(["@docs"]);
    expect(ownersForPath(rules, "docs/deep/readme.md")).toEqual(["@default"]);
    expect(ownersForPath(rules, "packages/docs/readme.md")).toEqual(["@default"]);
  });

  it("matches zero, one and multiple directories with a recursive segment", () => {
    const rules = parseCodeowners("src/**/cart.ts @cart\n**/logs @logs");
    for (const path of ["src/cart.ts", "src/billing/cart.ts", "src/a/b/cart.ts"]) {
      expect(ownersForPath(rules, path)).toEqual(["@cart"]);
    }
    expect(ownersForPath(rules, "other/src/cart.ts")).toEqual([]);
    for (const path of ["logs/a.txt", "build/logs/a.txt", "a/b/logs/a.txt"]) {
      expect(ownersForPath(rules, path)).toEqual(["@logs"]);
    }
  });

  it("matches all descendants with a trailing double star", () => {
    const rules = parseCodeowners("docs/** @docs");
    expect(ownersForPath(rules, "docs/readme.md")).toEqual(["@docs"]);
    expect(ownersForPath(rules, "docs/a/b/readme.md")).toEqual(["@docs"]);
  });

  it("removes ownership with a later ownerless override and allows reassignment", () => {
    const rules = parseCodeowners("* @default\n/apps/private\n/apps/private/public/ @public");
    expect(ownersForPath(rules, "apps/private/secret.ts")).toEqual([]);
    expect(ownersForPath(rules, "apps/private/public/api.ts")).toEqual(["@public"]);
    expect(ownersForPath(rules, "apps/other/api.ts")).toEqual(["@default"]);
  });

  it("anchors a leading-slash pattern to the repo root", () => {
    const rules = parseCodeowners("/config  @root-cfg\n");
    expect(ownersForPath(rules, "config/app.json")).toEqual(["@root-cfg"]);
    expect(ownersForPath(rules, "packages/x/config/app.json")).toEqual([]);
  });

  it("treats a trailing-slash pattern as a directory subtree, not the directory itself", () => {
    const rules = parseCodeowners("src/billing/  @billing\n");
    expect(ownersForPath(rules, "src/billing/cart.ts")).toEqual(["@billing"]);
    expect(ownersForPath(rules, "src/billing")).toEqual([]);
  });

  it("strips a leading ./ from the path before matching", () => {
    const rules = parseCodeowners("src/*  @src\n");
    expect(ownersForPath(rules, "./src/app.ts")).toEqual(["@src"]);
  });

  it("returns an empty array when there are no rules at all", () => {
    expect(ownersForPath([], "src/app.ts")).toEqual([]);
  });
});

describe("ownersForPath", () => {
  const rules = parseCodeowners("*  @acme/all\nsrc/billing/**  @acme/billing\ndocs  @acme/docs\n");

  it("applies the last matching rule (gitignore order)", () => {
    expect(ownersForPath(rules, "src/billing/cart.ts")).toEqual(["@acme/billing"]);
  });

  it("falls back to the catch-all", () => {
    expect(ownersForPath(rules, "src/api/server.ts")).toEqual(["@acme/all"]);
  });

  it("matches a bare directory name anywhere in the tree", () => {
    expect(ownersForPath(rules, "packages/x/docs/readme.md")).toEqual(["@acme/docs"]);
  });
});

describe("loadCodeowners", () => {
  it("prefers .github, then root, then docs, without merging files", () => {
    const fixture = join(import.meta.dirname, "fixtures/ownership-cases");
    for (const [name, owner] of [
      ["all-locations", "@github"],
      ["root-and-docs", "@root"],
      ["docs-only", "@docs"],
    ]) {
      expect(ownersForPath(loadCodeowners(join(fixture, name)) ?? [], "src/app.ts")).toEqual([
        owner,
      ]);
    }
    expect(loadCodeowners(join(fixture, "empty-github"))).toEqual([]);
  });

  it("finds a CODEOWNERS under .github/", () => {
    const rules = loadCodeowners(REPO);
    expect(rules).not.toBeNull();
    expect(ownersForPath(rules ?? [], "src/billing/cart.ts")).toEqual(["@acme/billing-team"]);
  });

  it("returns null when the repo has no CODEOWNERS", () => {
    expect(loadCodeowners(join(import.meta.dirname, "fixtures"))).toBeNull();
  });
});
