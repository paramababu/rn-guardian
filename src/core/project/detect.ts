import fs from "node:fs";
import path from "node:path";
import type { ProjectContext } from "../../types.js";
import { findGitRoot } from "../git/staged.js";

function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readJson(p: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Walk up from `start` to find the nearest directory containing package.json. */
function findPackageRoot(start: string, stopAt: string): string {
  let dir = start;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (exists(path.join(dir, "package.json"))) return dir;
    if (dir === stopAt) return start;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function detectPackageManager(root: string): ProjectContext["packageManager"] {
  if (exists(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (exists(path.join(root, "yarn.lock"))) return "yarn";
  if (exists(path.join(root, "bun.lockb"))) return "bun";
  return "npm";
}

function depVersion(
  pkg: Record<string, unknown> | null,
  name: string,
): string | undefined {
  if (!pkg) return undefined;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[field] as Record<string, string> | undefined;
    if (deps && typeof deps[name] === "string") return deps[name];
  }
  return undefined;
}

function majorFromRange(range: string | undefined): number | undefined {
  if (!range) return undefined;
  const m = range.match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

function detectHookManager(
  root: string,
  pkg: Record<string, unknown> | null,
): ProjectContext["hookManager"] {
  if (exists(path.join(root, ".husky"))) return "husky";
  if (
    exists(path.join(root, "lefthook.yml")) ||
    exists(path.join(root, "lefthook.yaml")) ||
    exists(path.join(root, ".lefthook.yml"))
  ) {
    return "lefthook";
  }
  if (pkg && depVersion(pkg, "husky")) return "husky";
  if (pkg && depVersion(pkg, "lefthook")) return "lefthook";
  return "none";
}

/**
 * Detect the framework-agnostic facts about the project. Framework-specific
 * detail (Expo vs. bare, RN version, …) is filled in later by a Plugin.
 */
export async function detectProject(cwd: string): Promise<ProjectContext> {
  const gitRoot = (await findGitRoot(cwd)) ?? cwd;
  const packageRoot = findPackageRoot(cwd, gitRoot);
  const pkg = readJson(path.join(packageRoot, "package.json"));

  const hasTypeScript =
    exists(path.join(packageRoot, "tsconfig.json")) ||
    Boolean(depVersion(pkg, "typescript"));

  const eslintRange = depVersion(pkg, "eslint");
  const prettierInstalled = Boolean(depVersion(pkg, "prettier"));

  return {
    gitRoot,
    packageRoot,
    hasTypeScript,
    packageManager: detectPackageManager(packageRoot),
    eslint: {
      installed: Boolean(eslintRange),
      major: majorFromRange(eslintRange),
    },
    prettierInstalled,
    hookManager: detectHookManager(packageRoot, pkg),
  };
}
