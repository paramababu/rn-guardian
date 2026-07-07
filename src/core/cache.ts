import fs from "node:fs";
import path from "node:path";
import type { Issue, Tier } from "../types.js";

/**
 * Last-run cache. `run` (the hook) writes the report here; `explain` replays it
 * instead of re-scanning, so "why did my commit fail?" is instant and shows the
 * exact findings the commit tripped on. Best-effort: a missing `node_modules` or
 * a read-only FS must never break a commit, so every op swallows its errors.
 */

const REL_DIR = path.join("node_modules", ".cache", "rn-guardian");
const FILE = "last-run.json";
const VERSION = 1;

export interface CachedReport {
  version: number;
  savedAt: number;
  tier: Tier;
  fileCount: number;
  blocked: boolean;
  /**
   * The issues that still needed attention (auto-fixed ones already removed).
   * `Issue.fix.auto` (which carries a live `apply()` closure) is stripped before
   * writing — `explain` only reads the prose, never re-applies a fix, and a
   * half-serialized fix object with no `apply` would be a trap for other readers.
   */
  issues: Issue[];
}

/** Drop the non-serializable autofix closure so no reader trusts a dead fix. */
function stripAuto(issue: Issue): Issue {
  if (!issue.fix.auto) return issue;
  return { ...issue, fix: { description: issue.fix.description } };
}

function cachePath(packageRoot: string): string {
  return path.join(packageRoot, REL_DIR, FILE);
}

export function writeLastRun(
  packageRoot: string,
  data: Pick<CachedReport, "tier" | "fileCount" | "blocked" | "issues">,
): void {
  try {
    fs.mkdirSync(path.join(packageRoot, REL_DIR), { recursive: true });
    const payload: CachedReport = {
      version: VERSION,
      savedAt: Date.now(),
      ...data,
      issues: data.issues.map(stripAuto),
    };
    fs.writeFileSync(cachePath(packageRoot), JSON.stringify(payload));
  } catch {
    // best-effort — never fail the run because the cache couldn't be written
  }
}

export function readLastRun(packageRoot: string): CachedReport | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(cachePath(packageRoot), "utf8"),
    ) as CachedReport;
    if (parsed.version !== VERSION || !Array.isArray(parsed.issues)) return null;
    return parsed;
  } catch {
    return null;
  }
}
