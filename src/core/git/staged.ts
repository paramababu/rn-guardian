import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { StagedFile } from "../../types.js";

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

  for (const { status, filePath } of parsed) {
    const letter = status[0] as StagedFile["status"];
    if (!STATUS_LETTERS.has(letter)) continue;
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
