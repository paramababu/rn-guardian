import pc from "picocolors";
import type { Issue } from "../types.js";
import { runEngine } from "../engine.js";
import { detectProject } from "../core/project/detect.js";
import { readLastRun } from "../core/cache.js";
import { printIssues, printGroupedIssues } from "../core/reporter/terminal.js";

/**
 * `explain` answers "why did this commit fail?" with the full five-part block
 * (problem → why → impact → fix → docs) for every issue — the tool as built-in
 * documentation.
 *
 * It first replays the last hook run from the on-disk cache (instant, and shows
 * the exact findings the commit tripped on). If there is no cache — e.g. run
 * standalone before any hook fired — it falls back to a fresh scan of the
 * staged changes.
 */
export async function explainCommand(cwd: string): Promise<number> {
  const ctx = await detectProject(cwd);
  const cached = readLastRun(ctx.packageRoot);
  if (cached) {
    return renderExplain(cached.issues, cached.fileCount, cached.blocked, true);
  }

  const { report, fileCount } = await runEngine({ cwd, tier: "commit", autofix: false });
  if (fileCount === 0) {
    process.stdout.write("rn-guardian: no staged files to explain.\n");
    return 0;
  }
  return renderExplain(report.remaining, fileCount, report.blocked, false, () =>
    printIssues(report),
  );
}

function renderExplain(
  issues: Issue[],
  fileCount: number,
  blocked: boolean,
  fromCache: boolean,
  print?: () => void,
): number {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  process.stdout.write(
    `\n${pc.bold("Why did this commit fail?")}` +
      (fromCache ? pc.dim("  (last run)") : "") +
      "\n" +
      pc.dim(
        `  ${errors} blocking · ${warnings} warning${warnings === 1 ? "" : "s"} across ${fileCount} file${fileCount === 1 ? "" : "s"}\n`,
      ),
  );

  if (issues.length === 0) {
    process.stdout.write(`\n  ${pc.green("Nothing to explain — all clear.")}\n\n`);
    return 0;
  }

  if (print) print();
  else printGroupedIssues(issues);
  process.stdout.write("\n");
  return blocked ? 1 : 0;
}
