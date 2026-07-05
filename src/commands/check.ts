import type { Tier } from "../types.js";
import { runEngine } from "../engine.js";
import {
  printHeader,
  printCheckLine,
  printIssues,
  printSummary,
} from "../core/reporter/terminal.js";
import { toJson } from "../core/reporter/json.js";

export interface CheckArgs {
  cwd: string;
  tier: Tier;
  json: boolean;
}

/**
 * Manual, read-only scan of the staged changes ("what would fail?"). Never
 * autofixes and never re-stages — a safe preview you can run any time.
 */
export async function checkCommand(args: CheckArgs): Promise<number> {
  const { report, profile, fileCount } = await runEngine({
    cwd: args.cwd,
    tier: args.tier,
    autofix: false,
  });

  if (args.json) {
    process.stdout.write(toJson(report, 0) + "\n");
    return report.blocked ? 1 : 0;
  }

  if (fileCount === 0) {
    process.stdout.write("rn-guardian: no staged files to check.\n");
    return 0;
  }

  printHeader(profile, fileCount);
  for (const run of report.runs) printCheckLine(run);
  printIssues(report);
  printSummary(report, 0);

  return report.blocked ? 1 : 0;
}
