import fs from "node:fs";
import path from "node:path";
import type { AutoFix, Check, Issue, Severity } from "../../types.js";
import { importLocal } from "../util/resolve-local.js";
import { sourceFiles } from "../util/files.js";
import { docs } from "../docs.js";

// Minimal shapes from the ESLint Node API (compatible across v8 and v9).
interface LintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  fix?: unknown;
}
interface LintResult {
  filePath: string;
  messages: LintMessage[];
  errorCount: number;
  warningCount: number;
  /** Present only when `fix` produced changed source for this file. */
  output?: string;
}
interface ESLintInstance {
  lintFiles(patterns: string[]): Promise<LintResult[]>;
}
interface ESLintCtor {
  new (options: Record<string, unknown>): ESLintInstance;
  outputFixes(results: LintResult[]): Promise<void>;
}
interface ESLintModule {
  ESLint: ESLintCtor;
}

export const eslintCheck: Check = {
  id: "eslint",
  inspector: "lint",
  tier: "commit",
  appliesTo: (ctx) => ctx.eslint.installed,
  async run(files, ctx) {
    const start = Date.now();
    const mod = await importLocal<ESLintModule>(ctx.packageRoot, "eslint");
    if (!mod?.ESLint) {
      return {
        status: "skipped",
        issues: [],
        durationMs: Date.now() - start,
        note: "eslint not resolvable in project",
      };
    }

    const targets = sourceFiles(files).map((f) => f.absPath);
    if (targets.length === 0) {
      return { status: "pass", issues: [], durationMs: Date.now() - start };
    }

    const { ESLint } = mod;
    // ESLint's result cache: unchanged files aren't re-linted on the next
    // commit attempt, which is what keeps "fix two files and retry" fast on
    // large staged sets. ESLint invalidates entries itself when file contents
    // or the resolved config change. Best-effort: an uncreatable cache dir
    // (read-only FS) must never break the check.
    const cacheLocation = eslintCachePath(ctx.packageRoot);
    const eslint = new ESLint({
      cwd: ctx.packageRoot,
      errorOnUnmatchedPattern: false,
      ...(cacheLocation ? { cache: true, cacheLocation } : {}),
    });
    const results = await eslint.lintFiles(targets);

    const issues: Issue[] = [];
    const fixAttached = new Set<string>();
    let hadError = false;
    let hadWarning = false;

    for (const res of results) {
      const rel = toRel(res.filePath, ctx.packageRoot);
      const fileHasFixable = res.messages.some((m) => m.fix != null);

      for (const msg of res.messages) {
        const severity: Severity = msg.severity === 2 ? "error" : "warning";
        if (severity === "error") hadError = true;
        else hadWarning = true;

        const fixable = msg.fix != null;
        const attachFix =
          fixable && fileHasFixable && !fixAttached.has(res.filePath);
        if (attachFix) fixAttached.add(res.filePath);

        issues.push({
          ruleId: msg.ruleId ?? "eslint/parse-error",
          inspector: "lint",
          severity,
          file: rel,
          line: msg.line ?? 1,
          column: msg.column,
          // ESLint messages can quote the offending source (e.g.
          // no-unused-expressions on a minified file quotes the whole
          // expression) — clamp so one generated file can't bloat every report.
          problem: clip(msg.message, 500),
          why: msg.ruleId
            ? `ESLint rule "${msg.ruleId}" flags this. Your project's config decided this pattern is worth catching.`
            : "ESLint could not parse the file — usually a syntax error.",
          fix: {
            description: fixable
              ? "Auto-fixable — rn-guardian runs `eslint --fix` and re-stages."
              : "No automatic fix; resolve manually per the rule's guidance.",
            auto: attachFix
              ? makeFix(ESLint, ctx.packageRoot, res.filePath)
              : undefined,
          },
          docsUrl: msg.ruleId ? eslintDocs(msg.ruleId) : undefined,
        });
      }
    }

    const status = hadError ? "fail" : hadWarning ? "warn" : "pass";
    return { status, issues, durationMs: Date.now() - start };
  },
};

function makeFix(
  ESLint: ESLintCtor,
  cwd: string,
  absPath: string,
): AutoFix {
  return {
    safe: true, // ESLint's fixer output is behavior-preserving (not suggestions)
    description: "apply eslint --fix",
    async apply() {
      const eslint = new ESLint({ cwd, fix: true, errorOnUnmatchedPattern: false });
      const results = await eslint.lintFiles([absPath]);
      await ESLint.outputFixes(results);
      // ESLint sets `output` only on files whose source it actually changed.
      return results.some((r) => r.output !== undefined);
    },
  };
}

/** Cache file under node_modules/.cache/rn-guardian; null if uncreatable. */
function eslintCachePath(packageRoot: string): string | null {
  const dir = path.join(packageRoot, "node_modules", ".cache", "rn-guardian");
  try {
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "eslint-cache.json");
  } catch {
    return null;
  }
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function eslintDocs(ruleId: string): string | undefined {
  const base = docs("eslint");
  return base ? `${base}?rule=${encodeURIComponent(ruleId)}` : undefined;
}

function toRel(abs: string, root: string): string {
  return abs.startsWith(root) ? abs.slice(root.length + 1) : abs;
}
