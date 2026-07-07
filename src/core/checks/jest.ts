import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";
import type { Check, Issue } from "../../types.js";
import { sourceFiles } from "../util/files.js";
import { docs } from "../docs.js";

const execFileAsync = promisify(execFile);

/**
 * Affected-tests check: runs the project's own Jest against only the tests
 * related to the staged source files (`jest --findRelatedTests`), at the `push`
 * tier. We resolve and spawn the user's local Jest — rn-guardian never depends
 * on it — and skip cleanly when Jest isn't installed. Determinism is bounded by
 * the user's own tests; that's inherent to running them.
 */
export interface JestSummary {
  failedFiles: Array<{ file: string; failures: number; firstMessage?: string }>;
  numFailedTests: number;
}

/** Parse `jest --json` stdout into a minimal failure summary, or null. */
export function parseJestJson(stdout: string): JestSummary | null {
  const json = extractJson(stdout);
  if (!json) return null;
  const results = Array.isArray(json.testResults) ? json.testResults : [];
  const failedFiles: JestSummary["failedFiles"] = [];
  for (const suite of results) {
    const assertions = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
    const failed = assertions.filter((a) => a?.status === "failed");
    // A suite can also fail to run at all (compile error) — status "failed",
    // no assertions. Treat that as one failure so it still surfaces.
    const suiteFailedToRun = suite.status === "failed" && failed.length === 0;
    if (failed.length === 0 && !suiteFailedToRun) continue;
    failedFiles.push({
      file: String(suite.name ?? ""),
      failures: failed.length || 1,
      firstMessage:
        failed[0]?.failureMessages?.[0] ??
        (typeof suite.message === "string" ? suite.message : undefined),
    });
  }
  return {
    failedFiles,
    numFailedTests: typeof json.numFailedTests === "number" ? json.numFailedTests : failedFiles.length,
  };
}

interface JestJson {
  numFailedTests?: number;
  testResults?: Array<{
    name?: string;
    status?: string;
    message?: string;
    assertionResults?: Array<{ status?: string; failureMessages?: string[] }>;
  }>;
}

/** Jest prints JSON to stdout; be tolerant of any stray leading/trailing text. */
function extractJson(stdout: string): JestJson | null {
  const trimmed = stdout.trim();
  const candidates = [trimmed];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first > 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c) as JestJson;
    } catch {
      // try next
    }
  }
  return null;
}

function resolveJestBin(packageRoot: string): string | null {
  try {
    const require = createRequire(path.join(packageRoot, "package.json"));
    return require.resolve("jest/bin/jest.js");
  } catch {
    return null;
  }
}

export const affectedTestsCheck: Check = {
  id: "affected-tests",
  inspector: "tests",
  tier: "push",
  appliesTo: () => true,
  async run(files, ctx) {
    const start = Date.now();
    const done = (
      status: "pass" | "fail" | "skipped",
      issues: Issue[] = [],
      note?: string,
    ) => ({ status, issues, durationMs: Date.now() - start, note });

    const targets = sourceFiles(files).map((f) => f.absPath);
    if (targets.length === 0) return done("pass");

    const bin = resolveJestBin(ctx.packageRoot);
    if (!bin) return done("skipped", [], "jest not installed in project");

    let stdout = "";
    try {
      const res = await execFileAsync(
        process.execPath,
        [bin, "--findRelatedTests", ...targets, "--json", "--passWithNoTests", "--ci"],
        { cwd: ctx.packageRoot, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
      );
      stdout = res.stdout;
    } catch (err) {
      // Jest exits non-zero when tests fail — the JSON report is still on stdout.
      stdout = (err as { stdout?: string }).stdout ?? "";
      if (!stdout) {
        return done("skipped", [], `jest did not produce output: ${errText(err)}`);
      }
    }

    const summary = parseJestJson(stdout);
    if (!summary) return done("skipped", [], "could not parse jest output");
    if (summary.failedFiles.length === 0) return done("pass");

    const issues = summary.failedFiles.map((f) =>
      failingTests(toRel(f.file, ctx.packageRoot), f.failures, f.firstMessage),
    );
    return done("fail", issues);
  },
};

function failingTests(file: string, count: number, firstMessage?: string): Issue {
  const hint = firstMessage ? firstMessage.split("\n")[0]!.slice(0, 200) : undefined;
  return {
    ruleId: "tests/affected-failing",
    inspector: "tests",
    severity: "error",
    file,
    line: 1,
    problem: `${count} failing test${count === 1 ? "" : "s"} in a suite related to your change.`,
    why: "A test that covers code you just touched is now red. Pushing it breaks the suite for everyone and, if CI gates merges, blocks the whole team.",
    impact: hint ? `First failure: ${hint}` : "The related test suite fails.",
    fix: {
      description: `Reproduce with \`jest ${file}\`, fix the code or update the test, then push again.`,
    },
    docsUrl: docs("affected-failing"),
  };
}

function toRel(abs: string, root: string): string {
  return abs.startsWith(root) ? abs.slice(root.length + 1) : abs;
}

function errText(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  return (e.stderr || e.message || String(err)).split("\n")[0]!.slice(0, 200);
}
