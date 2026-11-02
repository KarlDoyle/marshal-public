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

  it("skips a line that names a pattern but no owner", () => {
    expect(parseCodeowners("src/**\n*  @a\n")).toEqual([{ pattern: "*", owners: ["@a"] }]);
  });
});

describe("ownersForPath glob forms", () => {
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
  it("finds a CODEOWNERS under .github/", () => {
    const rules = loadCodeowners(REPO);
    expect(rules).not.toBeNull();
    expect(ownersForPath(rules ?? [], "src/billing/cart.ts")).toEqual(["@acme/billing-team"]);
  });

  it("returns null when the repo has no CODEOWNERS", () => {
    expect(loadCodeowners(join(import.meta.dirname, "fixtures"))).toBeNull();
  });
});
