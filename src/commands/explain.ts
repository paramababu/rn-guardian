import pc from "picocolors";
import { runEngine } from "../engine.js";
import { printIssues } from "../core/reporter/terminal.js";

/**
 * `explain` re-examines the staged changes and prints the full five-part block
 * (problem → why → impact → fix → docs) for every issue — the tool as built-in
 * documentation. v0.1 recomputes on demand; v0.2 will replay the last hook run
 * from a cached result (PLAN.md roadmap).
 */
export async function explainCommand(cwd: string): Promise<number> {
  const { report, fileCount } = await runEngine({
    cwd,
    tier: "commit",
    autofix: false,
  });

  if (fileCount === 0) {
    process.stdout.write("rn-guardian: no staged files to explain.\n");
    return 0;
  }

  const errors = report.issues.filter((i) => i.severity === "error").length;
  const warnings = report.issues.filter((i) => i.severity === "warning").length;

  process.stdout.write(
    `\n${pc.bold("Why did this commit fail?")}\n` +
      pc.dim(
        `  ${errors} blocking · ${warnings} warning${warnings === 1 ? "" : "s"} across ${fileCount} file${fileCount === 1 ? "" : "s"}\n`,
      ),
  );

  if (report.issues.length === 0) {
    process.stdout.write(`\n  ${pc.green("Nothing to explain — all clear.")}\n\n`);
    return 0;
  }

  printIssues(report);
  process.stdout.write("\n");
  return report.blocked ? 1 : 0;
}
