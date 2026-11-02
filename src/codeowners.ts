import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal CODEOWNERS support — enough to map a changed file to its owner(s).
 *
 * GitHub's CODEOWNERS is gitignore-style: each line is `<pattern> <owner...>`,
 * and the LAST matching pattern wins. We implement the common glob subset
 * (`*`, `**`, leading `/`, trailing `/`) — deliberately not the full spec, but
 * honest about it. Absent or empty files yield no rules (handled by callers).
 */

export interface CodeownersRule {
  pattern: string;
  owners: string[];
}

/** Standard locations GitHub searches, in priority order. */
const CODEOWNERS_LOCATIONS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

export function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    if (!pattern) continue;
    rules.push({ pattern, owners });
  }
  return rules;
}

/** Load a repo's CODEOWNERS from any standard location; null if none exists. */
export function loadCodeowners(repoPath: string): CodeownersRule[] | null {
  for (const loc of CODEOWNERS_LOCATIONS) {
    const full = join(repoPath, loc);
    if (existsSync(full)) {
      return parseCodeowners(readFileSync(full, "utf-8"));
    }
  }
  return null;
}

/** Translate a CODEOWNERS glob into a RegExp anchored at the repo root. */
function patternToRegExp(pattern: string): RegExp {
  let p = pattern;
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  // A trailing slash, or a bare name with no slash, matches a directory subtree.
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  const hasSlash = p.includes("/");

  // A whole **/ segment matches zero or more directories. A single * never
  // crosses a slash; terminal ** includes every remaining path segment.
  const body = p
    .split("/")
    .map((segment, index, segments) => {
      if (segment === "**") return index === segments.length - 1 ? ".*" : "(?:[^/]+/)*";
      const literal = segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
      return literal + (index < segments.length - 1 ? "/" : "");
    })
    .join("");

  // `docs` (no slash, not anchored) should match anywhere in the tree.
  const prefix = anchored || hasSlash ? "^" : "^(?:.*/)?";
  // A final wildcard names immediate files (docs/*), whereas a literal name
  // can name a directory whose descendants inherit ownership (docs or /apps).
  const suffix = dirOnly ? "/.*$" : p.endsWith("*") ? "$" : "(?:/.*)?$";
  return new RegExp(`${prefix}${body}${suffix}`);
}

/**
 * Owners for a path under the repo. Last matching rule wins (gitignore order).
 * Returns an empty array when no rule matches or there are no rules.
 */
export function ownersForPath(rules: CodeownersRule[], filePath: string): string[] {
  const normalized = filePath.replace(/^\.?\//, "");
  let matched: string[] = [];
  for (const rule of rules) {
    if (patternToRegExp(rule.pattern).test(normalized)) {
      matched = rule.owners;
    }
  }
  return matched;
}
