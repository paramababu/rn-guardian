import pc from "picocolors";
import type { Check, CheckStatus, Issue } from "../../types.js";
import type { CheckRun, RunReport } from "../runner/runner.js";
import { inspectorTitle } from "../inspectors.js";

const ICON: Record<CheckStatus, string> = {
  pass: pc.green("✓"),
  fixed: pc.green("✓"),
  warn: pc.yellow("⚠"),
  fail: pc.red("✗"),
  skipped: pc.dim("○"),
};

function ms(n: number): string {
  return pc.dim(`${n}ms`);
}

const RULE = pc.dim("─".repeat(40));

/** Live, per-check progress line (called as each check finishes). */
export function printCheckLine(run: CheckRun): void {
  const { check, result } = run;
  const label = inspectorTitle(check.inspector);
  const count =
    result.issues.length > 0 ? pc.dim(` (${result.issues.length})`) : "";
  const note = result.note ? pc.dim(`  ${result.note}`) : "";
  process.stdout.write(
    `  ${ICON[result.status]} ${label}${count}  ${ms(result.durationMs)}${note}\n`,
  );
}

export function printHeader(profile: string, fileCount: number): void {
  const bar = pc.dim("━".repeat(43));
  process.stdout.write(
    `\n${bar}\n  ${pc.bold("RN Guardian")}  ${pc.dim(`· ${profile} profile`)}\n${bar}\n\n`,
  );
  process.stdout.write(
    pc.dim(`  Checking ${fileCount} staged file${fileCount === 1 ? "" : "s"}…\n\n`),
  );
}

/** The signature issue block: Problem → Why → Impact → Fix → Docs. */
function printIssue(issue: Issue): void {
  const loc = pc.cyan(`${issue.file}:${issue.line}`);
  const sev =
    issue.severity === "error" ? pc.red("error") : pc.yellow("warning");
  const w = (label: string, text?: string) =>
    text
      ? `  ${pc.bold(label.padEnd(8))}${indent(text, 10)}\n`
      : "";

  let out = `\n  ${loc}  ${sev}\n  ${RULE}\n`;
  out += w("Problem", issue.problem);
  out += w("Why", issue.why);
  out += w("Impact", issue.impact);
  out += w("Fix", issue.fix.description);
  if (issue.docsUrl) out += w("Docs", pc.underline(issue.docsUrl));
  process.stdout.write(out);
}

/** Indent wrapped continuation lines to align under the first line's text. */
function indent(text: string, pad: number): string {
  return text.split("\n").join("\n" + " ".repeat(pad));
}

export function printIssues(report: RunReport): void {
  // Only show issues that still need attention; auto-fixed ones are summarized
  // by the "Auto-fixed N, re-staged" line instead of printed as problems.
  const remaining = report.remaining;
  if (remaining.length === 0) return;

  // Group by inspector for the "Performance Inspector — N issues" framing.
  const byInspector = new Map<string, Issue[]>();
  for (const issue of remaining) {
    const key = issue.inspector;
    (byInspector.get(key) ?? byInspector.set(key, []).get(key)!).push(issue);
  }

  for (const [inspector, issues] of byInspector) {
    const hasError = issues.some((i) => i.severity === "error");
    const head = `${hasError ? pc.red("✗") : pc.yellow("⚠")} ${pc.bold(
      inspectorTitle(inspector as Issue["inspector"]),
    )} ${pc.dim(`— ${issues.length} issue${issues.length === 1 ? "" : "s"}`)}`;
    process.stdout.write(`\n${head}\n`);
    for (const issue of issues) printIssue(issue);
  }
}

export function printSummary(report: RunReport, autofixed: number): void {
  // Counts reflect what still needs attention, not issues already auto-fixed.
  const remaining = report.remaining;
  const errors = remaining.filter((i) => i.severity === "error").length;
  const warnings = remaining.filter((i) => i.severity === "warning").length;
  const bar = pc.dim("─".repeat(43));

  process.stdout.write(`\n${bar}\n`);
  if (autofixed > 0) {
    process.stdout.write(
      `  ${pc.green("✓")} Auto-fixed ${pc.bold(String(autofixed))} issue${
        autofixed === 1 ? "" : "s"
      }, re-staged.\n`,
    );
  }
  const parts = [
    errors ? pc.red(`${errors} error${errors === 1 ? "" : "s"}`) : "",
    warnings ? pc.yellow(`${warnings} warning${warnings === 1 ? "" : "s"}`) : "",
    pc.dim(`${report.totalDurationMs}ms`),
  ].filter(Boolean);
  if (parts.length === 1) {
    // Only the duration remains — nothing outstanding.
    process.stdout.write(`  ${parts[0]}\n`);
  } else {
    process.stdout.write(`  ${parts.join(pc.dim("  ·  "))}\n`);
  }

  if (report.blocked) {
    process.stdout.write(
      `\n  ${pc.bgRed(pc.white(" COMMIT BLOCKED "))} ${pc.dim(
        "fix the errors above, then commit again.",
      )}\n\n`,
    );
  } else if (errors === 0 && warnings === 0) {
    const msg = autofixed > 0 ? "All issues auto-fixed." : "All checks passed.";
    process.stdout.write(`\n  ${pc.green(msg)}\n\n`);
  } else {
    process.stdout.write(
      `\n  ${pc.green("Commit allowed")} ${pc.dim("(warnings only).")}\n\n`,
    );
  }
}

export function checkStartHint(check: Check): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(pc.dim(`  … ${inspectorTitle(check.inspector)}\r`));
}
