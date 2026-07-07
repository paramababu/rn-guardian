import fs from "node:fs";
import path from "node:path";
import type { Check, Issue, StagedFile } from "../../types.js";
import { docs } from "../docs.js";

/**
 * Duplicate-dependency advisor. When a lockfile resolves the same package to
 * more than one version, the extra copies bloat the bundle and can cause subtle
 * "two copies of the same singleton" bugs (a classic being two Reacts → "invalid
 * hook call"). This is a pure lockfile read — deterministic, no dependency.
 *
 * It only runs when a lockfile (or package.json) is part of the staged change,
 * so it fires exactly when dependencies moved, not on every unrelated push.
 * Supports npm (package-lock.json, all lockfileVersions) and classic Yarn;
 * pnpm's YAML lock is skipped with a note rather than mis-parsed.
 */
const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock"];
const DEP_TRIGGERS = new Set([...LOCKFILES, "pnpm-lock.yaml", "package.json"]);

export const duplicateDepsCheck: Check = {
  id: "duplicate-deps",
  inspector: "dependency",
  tier: "push",
  appliesTo: () => true,
  async run(files, ctx) {
    const start = Date.now();
    const done = (
      status: "pass" | "warn" | "skipped",
      issues: Issue[] = [],
      note?: string,
    ) => ({ status, issues, durationMs: Date.now() - start, note });

    // Only relevant when the dependency set changed in this push.
    if (!files.some((f) => DEP_TRIGGERS.has(basename(f)))) return done("pass");

    const found = firstExisting(ctx.packageRoot, LOCKFILES);
    if (!found) {
      if (fileExists(path.join(ctx.packageRoot, "pnpm-lock.yaml"))) {
        return done("skipped", [], "pnpm-lock.yaml parsing not yet supported");
      }
      return done("skipped", [], "no supported lockfile found");
    }

    const raw = readSafe(found.abs);
    if (raw === null) return done("skipped", [], `could not read ${found.rel}`);

    const versions = found.rel.endsWith(".json")
      ? parseNpmLock(raw)
      : parseYarnLock(raw);

    const issues: Issue[] = [];
    for (const [name, set] of versions) {
      if (set.size > 1) {
        issues.push(duplicateIssue(found.rel, name, [...set].sort()));
      }
    }

    return done(issues.length ? "warn" : "pass", issues);
  },
};

function duplicateIssue(lockfile: string, name: string, vers: string[]): Issue {
  return {
    ruleId: "dependency/duplicate-version",
    inspector: "dependency",
    severity: "warning",
    file: lockfile,
    line: 1,
    problem: `"${name}" is installed at ${vers.length} versions (${vers.join(", ")}).`,
    why: "Each distinct version is bundled separately, so duplicate copies add straight to bundle size. For stateful singletons (react, react-native, a context library) two copies also break identity checks — the source of 'invalid hook call' and instanceof failures.",
    impact: "Larger bundle, and hard-to-debug singleton/identity bugs at runtime.",
    fix: {
      description:
        "Align the version ranges across your dependencies, run your package manager's dedupe (`npm dedupe` / `yarn-deduplicate`), or pin one version via `overrides` (npm) / `resolutions` (yarn).",
    },
    docsUrl: docs("duplicate-version"),
  };
}

/** npm `package-lock.json` (lockfileVersion 1, 2, and 3). */
function parseNpmLock(raw: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return out;
  }
  const root = json as {
    packages?: Record<string, { version?: string }>;
    dependencies?: Record<string, unknown>;
  };

  // v2/v3: flat `packages` keyed by node_modules path.
  if (root.packages) {
    const marker = "node_modules/";
    for (const [key, entry] of Object.entries(root.packages)) {
      if (key === "" || !entry?.version) continue;
      const idx = key.lastIndexOf(marker);
      if (idx === -1) continue;
      add(out, key.slice(idx + marker.length), entry.version);
    }
  }

  // v1 (and the legacy tree still present in v2): recurse `dependencies`.
  const walk = (deps?: Record<string, unknown>): void => {
    if (!deps) return;
    for (const [name, node] of Object.entries(deps)) {
      const n = node as { version?: string; dependencies?: Record<string, unknown> };
      if (n.version) add(out, name, n.version);
      walk(n.dependencies);
    }
  };
  walk(root.dependencies);

  return out;
}

/** Classic Yarn `yarn.lock` (v1). Best-effort for Berry's YAML form. */
function parseYarnLock(raw: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let names: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("#") || line.trim() === "") continue;
    if (!/^\s/.test(line) && line.trimEnd().endsWith(":")) {
      // Header: one or more `"name@range"` descriptors, comma-separated.
      names = line
        .slice(0, line.lastIndexOf(":"))
        .split(",")
        .map((d) => nameFromDescriptor(d.trim()))
        .filter(Boolean);
    } else {
      const m = line.match(/^\s+version:?\s+"?([^"\s]+)"?/);
      if (m) for (const n of names) add(out, n, m[1]!);
    }
  }
  return out;
}

/** `"@scope/pkg@^1.2.0"` / `lodash@^4.0.0` / `pkg@npm:^1.0.0` → package name. */
function nameFromDescriptor(desc: string): string {
  const d = desc.replace(/^"|"$/g, "");
  const at = d.lastIndexOf("@");
  return at > 0 ? d.slice(0, at) : d;
}

function add(map: Map<string, Set<string>>, name: string, version: string): void {
  (map.get(name) ?? map.set(name, new Set()).get(name)!).add(version);
}

function basename(f: StagedFile): string {
  const i = f.path.lastIndexOf("/");
  return i === -1 ? f.path : f.path.slice(i + 1);
}

function firstExisting(
  root: string,
  names: string[],
): { abs: string; rel: string } | null {
  for (const rel of names) {
    const abs = path.join(root, rel);
    if (fileExists(abs)) return { abs, rel };
  }
  return null;
}

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readSafe(abs: string): string | null {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}
