import type { Tier } from "../types.js";
import { runEngine } from "../engine.js";
import {
  printHeader,
  printCheckLine,
  printIssues,
  printSummary,
} from "../core/reporter/terminal.js";
import { toJson } from "../core/reporter/json.js";
import { writeLastRun } from "../core/cache.js";

export interface RunArgs {
  cwd: string;
  tier: Tier;
  json: boolean;
}

/**
 * The git-hook entry point. Autofix runs only in an interactive terminal — never
 * in CI or when piped — matching the safe-autofix principle (PLAN.md §2).
 */
export async function runCommand(args: RunArgs): Promise<number> {
  const interactive = process.stdout.isTTY === true && !args.json;
  const autofix = interactive;

  const { report, autofixed, profile, fileCount, packageRoot } = await runEngine({
    cwd: args.cwd,
    tier: args.tier,
    autofix,
  });

  // Persist for `explain` to replay without re-scanning.
  writeLastRun(packageRoot, {
    tier: args.tier,
    fileCount,
    blocked: report.blocked,
    issues: report.remaining,
  });

  if (args.json) {
    process.stdout.write(toJson(report, autofixed) + "\n");
    return report.blocked ? 1 : 0;
  }

  if (fileCount === 0) {
    process.stdout.write("rn-guardian: no staged files to check.\n");
    return 0;
  }

  printHeader(profile, fileCount);
  for (const run of report.runs) printCheckLine(run);
  printIssues(report);
  printSummary(report, autofixed);

  return report.blocked ? 1 : 0;
}
