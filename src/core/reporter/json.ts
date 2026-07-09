import type { RunReport } from "../runner/runner.js";

/** The plain object behind `--json`, so callers (e.g. `ci`) can extend it. */
export function reportToObject(
  report: RunReport,
  autofixed: number,
): Record<string, unknown> {
  // Summary counts reflect what still needs attention; auto-fixed issues are
  // reported separately via `autofixed` and the per-issue `fixed` flag.
  const remaining = report.remaining;
  const errors = remaining.filter((i) => i.severity === "error").length;
  const warnings = remaining.filter((i) => i.severity === "warning").length;
  return {
    tier: report.tier,
    blocked: report.blocked,
    durationMs: report.totalDurationMs,
    fileCount: report.files.length,
    autofixed,
    summary: {
      errors,
      warnings,
      remaining: remaining.length,
      total: report.issues.length,
    },
    checks: report.runs.map((r) => ({
      id: r.check.id,
      inspector: r.check.inspector,
      status: r.result.status,
      durationMs: r.result.durationMs,
      note: r.result.note,
    })),
    issues: report.issues.map((i) => ({
      ruleId: i.ruleId,
      inspector: i.inspector,
      severity: i.severity,
      file: i.file,
      line: i.line,
      column: i.column,
      problem: i.problem,
      why: i.why,
      impact: i.impact,
      fix: i.fix.description,
      fixable: Boolean(i.fix.auto),
      fixed: report.fixedIssues.has(i),
      docsUrl: i.docsUrl,
    })),
  };
}

/** Machine-readable output for CI / tooling (`--json`). */
export function toJson(report: RunReport, autofixed: number): string {
  return JSON.stringify(reportToObject(report, autofixed), null, 2);
}
