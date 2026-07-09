import fs from "node:fs";
import type { Issue } from "../../types.js";

/**
 * GitHub Actions output for `rn-guardian ci`: workflow-command annotations that
 * surface each finding inline on the PR diff, plus an optional job-summary
 * table. Pure string building — no network, no Actions SDK. See
 * https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
 */

/** The minimal shape an annotation needs — an Issue or a gate failure. */
export interface Annotation {
  severity: "error" | "warning";
  /** Repo-relative path; omit for a job-level (fileless) annotation. */
  file?: string;
  line?: number;
  column?: number;
  /** Short heading (the ruleId). */
  title: string;
  /** The body — may contain newlines; they're encoded. */
  message: string;
}

/** True when running inside a GitHub Actions job. */
export function inGithubActions(): boolean {
  return process.env.GITHUB_ACTIONS === "true";
}

/** `%`, CR and LF are escaped in workflow-command *data* (the message). */
function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Property *values* additionally escape `:` and `,`. */
function escapeProp(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function issueToAnnotation(issue: Issue): Annotation {
  const message = issue.impact
    ? `${issue.problem}\n${issue.impact}\nFix: ${issue.fix.description}`
    : `${issue.problem}\nFix: ${issue.fix.description}`;
  return {
    severity: issue.severity,
    file: issue.file || undefined,
    line: issue.line || undefined,
    column: issue.column,
    title: issue.ruleId,
    message,
  };
}

/** One `::error …::` / `::warning …::` workflow command line. */
export function formatAnnotation(a: Annotation): string {
  const props: string[] = [`title=${escapeProp(a.title)}`];
  // Properties are only meaningful with a file; a fileless command is job-level.
  if (a.file) {
    props.unshift(`file=${escapeProp(a.file)}`);
    if (a.line) props.push(`line=${a.line}`);
    if (a.column) props.push(`col=${a.column}`);
  }
  return `::${a.severity} ${props.join(",")}::${escapeData(a.message)}`;
}

/** Emit annotations for every issue + gate failure to stdout. */
export function printAnnotations(annotations: Annotation[]): void {
  if (annotations.length === 0) return;
  process.stdout.write(annotations.map(formatAnnotation).join("\n") + "\n");
}

export interface SummaryInput {
  errors: number;
  warnings: number;
  fileCount: number;
  durationMs: number;
  blocked: boolean;
  gateFailures: string[];
}

/** Markdown for the Actions job summary (`$GITHUB_STEP_SUMMARY`). */
export function renderStepSummary(s: SummaryInput): string {
  const verdict = s.blocked
    ? "❌ **Failed** — the gate blocked this change."
    : "✅ **Passed**";
  const lines = [
    "## rn-guardian",
    "",
    verdict,
    "",
    "| Metric | Count |",
    "| --- | --- |",
    `| Errors | ${s.errors} |`,
    `| Warnings | ${s.warnings} |`,
    `| Files scanned | ${s.fileCount} |`,
    `| Duration | ${s.durationMs}ms |`,
  ];
  if (s.gateFailures.length > 0) {
    lines.push("", "### Gate failures", "");
    for (const g of s.gateFailures) lines.push(`- ${g}`);
  }
  return lines.join("\n") + "\n";
}

/** Append the summary to `$GITHUB_STEP_SUMMARY` when Actions provides it. */
export function writeStepSummary(s: SummaryInput): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, renderStepSummary(s));
  } catch {
    // A summary is best-effort; never fail the run over it.
  }
}
