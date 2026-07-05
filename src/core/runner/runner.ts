import type {
  Check,
  CheckResult,
  Issue,
  ProjectContext,
  StagedFile,
  Tier,
} from "../../types.js";
import type { ResolvedConfig } from "../config/load.js";

export interface CheckRun {
  check: Check;
  result: CheckResult;
}

export interface RunReport {
  tier: Tier;
  files: StagedFile[];
  runs: CheckRun[];
  /** All fixes that were applied and their file paths, for re-staging. */
  fixedPaths: string[];
  /** Issues whose safe autofix actually ran and changed the file this run. */
  fixedIssues: Set<Issue>;
  totalDurationMs: number;
  /** Every issue found, including ones that were auto-fixed. */
  get issues(): Issue[];
  /** Issues that still need the developer's attention (fixed ones removed). */
  get remaining(): Issue[];
  /**
   * True when a commit should be rejected: any error-severity issue that was
   * NOT actually fixed this run. A fixable error only stops blocking once its
   * fix has really been applied — so an autofix-off run (CI, `check`) correctly
   * blocks on an unformatted or lint-failing file instead of passing it.
   */
  get blocked(): boolean;
}

export interface RunOptions {
  tier: Tier;
  /** Apply safe autofixes automatically. Disabled in CI/non-TTY by caller. */
  autofix: boolean;
  /** Notify listeners as each check starts/finishes (for the live reporter). */
  onCheckStart?: (check: Check) => void;
  onCheckDone?: (run: CheckRun) => void;
}

/**
 * Execute all applicable, enabled checks for a tier. Checks that share no files
 * or are independent could run in parallel; v0.1 runs them sequentially in a
 * stable order so the live reporter output is deterministic. Parallelism is a
 * later optimization (PLAN.md roadmap).
 */
export async function runChecks(
  checks: Check[],
  files: StagedFile[],
  ctx: ProjectContext,
  config: ResolvedConfig,
  opts: RunOptions,
): Promise<RunReport> {
  const runs: CheckRun[] = [];
  const fixedPaths = new Set<string>();
  const fixed = new Set<Issue>();
  const start = Date.now();

  for (const check of checks) {
    const cfg = config.forCheck(check);
    if (!cfg.enabled) continue;
    if (cfg.tier !== opts.tier) continue;
    if (!check.appliesTo(ctx)) continue;

    opts.onCheckStart?.(check);
    let result: CheckResult;
    try {
      result = await check.run(files, ctx, cfg);
    } catch (err) {
      result = {
        status: "fail",
        durationMs: 0,
        issues: [
          {
            ruleId: `${check.id}/internal-error`,
            inspector: check.inspector,
            severity: "error",
            file: "",
            line: 0,
            problem: `The "${check.id}" check threw an error.`,
            why: "A check should never crash; this indicates a bug in rn-guardian or a broken tool in the project.",
            fix: {
              description:
                "Re-run with RN_GUARDIAN_DEBUG=1 for the stack trace, or file an issue.",
            },
          },
        ],
        note: err instanceof Error ? err.message : String(err),
      };
    }

    if (opts.autofix) {
      for (const issue of result.issues) {
        const auto = issue.fix.auto;
        if (auto?.safe) {
          const changed = await auto.apply();
          if (changed) {
            fixed.add(issue);
            if (issue.file) fixedPaths.add(issue.file);
          }
        }
      }
    }

    runs.push({ check, result });
    opts.onCheckDone?.({ check, result });
  }

  const totalDurationMs = Date.now() - start;

  return {
    tier: opts.tier,
    files,
    runs,
    fixedPaths: [...fixedPaths],
    fixedIssues: fixed,
    totalDurationMs,
    get issues() {
      return runs.flatMap((r) => r.result.issues);
    },
    get remaining() {
      return runs.flatMap((r) => r.result.issues).filter((i) => !fixed.has(i));
    },
    get blocked() {
      return runs
        .flatMap((r) => r.result.issues)
        .some((i) => i.severity === "error" && !fixed.has(i));
    },
  };
}
