import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { StagedFile } from "../../types.js";
import { loadIgnoreFile } from "../util/ignore.js";
import { isSourceFile } from "../util/files.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/** Absolute path to the git repository root, or null if not in a repo. */
export async function findGitRoot(cwd: string): Promise<string | null> {
  try {
    const out = await git(["rev-parse", "--show-toplevel"], cwd);
    return out.trim() || null;
  } catch {
    return null;
  }
}

const STATUS_LETTERS = new Set(["A", "C", "M", "R"]);

/**
 * Files staged for commit (added/copied/modified/renamed). Deleted files are
 * excluded — there is nothing to inspect. Also flags partially staged files
 * (staged AND with unstaged changes), which autofix must treat carefully.
 */
export async function getStagedFiles(gitRoot: string): Promise<StagedFile[]> {
  // NUL-delimited to survive spaces/newlines in paths.
  const staged = await git(
    ["diff", "--cached", "--name-status", "--diff-filter=ACMR", "-z"],
    gitRoot,
  );

  const files: StagedFile[] = [];
  const parsed = parseNameStatusZ(staged);

  // Files that also have unstaged working-tree changes => partially staged.
  const unstaged = new Set(
    (await git(["diff", "--name-only", "-z"], gitRoot))
      .split("\0")
      .filter(Boolean),
  );

  // `.rn-guardianignore` (gitignore syntax) removes paths from every check.
  const ignore = loadIgnoreFile(gitRoot);

  for (const { status, filePath } of parsed) {
    const letter = status[0] as StagedFile["status"];
    if (!STATUS_LETTERS.has(letter)) continue;
    if (!ignore.empty && ignore.ignores(filePath)) continue;
    files.push({
      path: filePath,
      absPath: path.join(gitRoot, filePath),
      status: letter,
      partiallyStaged: unstaged.has(filePath),
    });
  }
  return files;
}

/**
 * Parse the `-z` output of `git diff --name-status`. For renames/copies git
 * emits: STATUS \0 OLD \0 NEW \0. For others: STATUS \0 PATH \0.
 */
function parseNameStatusZ(
  raw: string,
): Array<{ status: string; filePath: string }> {
  const tokens = raw.split("\0").filter((t) => t.length > 0);
  const out: Array<{ status: string; filePath: string }> = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i++]!;
    if (status.startsWith("R") || status.startsWith("C")) {
      // old path (ignored), new path
      i++; // skip old
      const newPath = tokens[i++];
      if (newPath) out.push({ status, filePath: newPath });
    } else {
      const filePath = tokens[i++];
      if (filePath) out.push({ status, filePath });
    }
  }
  return out;
}

/** Re-stage files after an autofix mutated them on disk. */
export async function restage(gitRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await git(["add", "--", ...paths], gitRoot);
}

/** Does a git ref resolve? Used to pick a base branch for the `ci` diff. */
async function revExists(ref: string, gitRoot: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], gitRoot);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the base ref to diff a PR against. Tries an explicit ref first, then
 * the GitHub Actions PR base (`GITHUB_BASE_REF`), then the usual main branches.
 * Returns null when none resolve (a shallow/detached checkout) so the caller can
 * fall back to scanning the whole tree.
 */
export async function resolveBaseRef(
  gitRoot: string,
  explicit?: string,
): Promise<string | null> {
  const candidates = [
    explicit,
    process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`,
    "origin/main",
    "origin/master",
    "main",
    "master",
  ].filter((r): r is string => typeof r === "string" && r.length > 0);

  for (const ref of candidates) {
    if (await revExists(ref, gitRoot)) return ref;
  }
  return null;
}

/**
 * Source files changed between the merge-base of `base` and HEAD (the PR diff).
 * `base...HEAD` diffs from the merge-base, so unrelated changes already on the
 * base branch are excluded. Deleted files are dropped (nothing to inspect).
 */
export async function getChangedFiles(
  gitRoot: string,
  base: string,
): Promise<StagedFile[]> {
  const out = await git(
    ["diff", "--name-status", "--diff-filter=ACMR", "-z", `${base}...HEAD`],
    gitRoot,
  );
  const ignore = loadIgnoreFile(gitRoot);
  const files: StagedFile[] = [];
  for (const { status, filePath } of parseNameStatusZ(out)) {
    const letter = status[0] as StagedFile["status"];
    if (!STATUS_LETTERS.has(letter)) continue;
    if (!isSourceFile(filePath)) continue;
    if (!ignore.empty && ignore.ignores(filePath)) continue;
    files.push({
      path: filePath,
      absPath: path.join(gitRoot, filePath),
      status: letter,
      partiallyStaged: false,
    });
  }
  return files;
}

/** Every tracked source file in the repo (the `ci --all` sweep set). */
export async function getAllSourceFiles(gitRoot: string): Promise<StagedFile[]> {
  const out = await git(["ls-files", "-z"], gitRoot);
  const ignore = loadIgnoreFile(gitRoot);
  const files: StagedFile[] = [];
  for (const filePath of out.split("\0").filter(Boolean)) {
    if (!isSourceFile(filePath)) continue;
    if (!ignore.empty && ignore.ignores(filePath)) continue;
    files.push({
      path: filePath,
      absPath: path.join(gitRoot, filePath),
      status: "M",
      partiallyStaged: false,
    });
  }
  return files;
}
