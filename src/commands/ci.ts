import pc from "picocolors";
import type { StagedFile, Tier } from "../types.js";
import { runEngine } from "../engine.js";
import { findGitRoot } from "../core/git/staged.js";
import {
  resolveBaseRef,
  getChangedFiles,
  getAllSourceFiles,
} from "../core/git/staged.js";
import {
  printHeader,
  printCheckLine,
  printIssues,
  printSummary,
} from "../core/reporter/terminal.js";
import { reportToObject } from "../core/reporter/json.js";
import {
  inGithubActions,
  issueToAnnotation,
  printAnnotations,
  writeStepSummary,
  type Annotation,
} from "../core/reporter/github.js";
import { loadConfig } from "../core/config/load.js";
import { readGateConfig, evaluateGates } from "../core/ci/gates.js";
import { toHtml } from "../core/reporter/html.js";
import fs from "node:fs";
import path from "node:path";

export interface CiArgs {
  cwd: string;
  json: boolean;
  /** Base ref to diff against; falls back to the usual main branches. */
  base?: string;
  /** Scan every tracked source file instead of the PR diff. */
  all: boolean;
  /** Force GitHub-annotation output even outside Actions. */
  annotate: boolean;
  /** Write a self-contained HTML report to this path. */
  html?: string;
}

/** The `ci` sweep runs every enabled check, across all tiers, with no budget. */
const CI_TIERS: Tier[] = ["commit", "push", "ci"];

/**
 * Tier-3 runner for CI (PLAN.md §Tier 3): runs the whole check suite over the
 * PR diff (or the full tree), applies the configured team-rule gates, and emits
 * GitHub Actions annotations + a JSON report. Never autofixes. Exits non-zero
 * when an error remains or a gate fails.
 */
export async function ciCommand(args: CiArgs): Promise<number> {
  const gitRoot = await findGitRoot(args.cwd);
  if (!gitRoot) {
    process.stderr.write(
      `${pc.red("rn-guardian ci:")} not inside a git repository.\n`,
    );
    return 1;
  }

  const { files, scope } = await selectFiles(gitRoot, args);
  const annotate = args.annotate || inGithubActions();

  const engine = await runEngine({
    cwd: args.cwd,
    tier: "ci",
    tiers: CI_TIERS,
    files,
    autofix: false,
  });
  const { report, profile, fileCount } = engine;

  // Team-rule gates from the `ci` config block.
  const gates = await evaluateGates(
    report.remaining,
    readGateConfig(loadConfig(engine.packageRoot).ci),
    { packageRoot: engine.packageRoot, files },
  );
  const blocked = report.blocked || gates.blocked;

  const errors = report.remaining.filter((i) => i.severity === "error").length;
  const warnings = report.remaining.filter(
    (i) => i.severity === "warning",
  ).length;

  if (annotate) {
    const annotations: Annotation[] = report.remaining.map(issueToAnnotation);
    for (const g of gates.failures) {
      annotations.push({ severity: "error", title: g.title, message: g.message });
    }
    printAnnotations(annotations);
    writeStepSummary({
      errors,
      warnings,
      fileCount,
      durationMs: report.totalDurationMs,
      blocked,
      gateFailures: gates.failures.map((g) => `**${g.title}** — ${g.message}`),
    });
  }

  if (args.html) {
    const htmlPath = path.resolve(args.cwd, args.html);
    fs.writeFileSync(
      htmlPath,
      toHtml(report, gates, { profile, scope, generatedAt: new Date() }),
    );
    process.stderr.write(pc.dim(`HTML report → ${htmlPath}\n`));
  }

  if (args.json) {
    const payload = {
      ...reportToObject(report, 0),
      scope,
      gates: {
        blocked: gates.blocked,
        failures: gates.failures,
      },
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return blocked ? 1 : 0;
  }

  // Human summary (also printed in Actions, below the annotations).
  printHeader(`${profile} · ci`, fileCount);
  process.stdout.write(pc.dim(`  Scope: ${scope}\n\n`));
  for (const run of report.runs) printCheckLine(run);
  printIssues(report);
  printSummary(report, 0);

  if (gates.failures.length > 0) {
    process.stdout.write(`\n${pc.red("✗ Gate failures:")}\n`);
    for (const g of gates.failures) {
      process.stdout.write(`  ${pc.red("•")} ${pc.bold(g.title)} — ${g.message}\n`);
    }
  }

  return blocked ? 1 : 0;
}

/** Choose the file set: `--all` scans everything, else the PR diff vs a base. */
async function selectFiles(
  gitRoot: string,
  args: CiArgs,
): Promise<{ files: StagedFile[]; scope: string }> {
  if (args.all) {
    return { files: await getAllSourceFiles(gitRoot), scope: "all tracked files" };
  }
  const base = await resolveBaseRef(gitRoot, args.base);
  if (!base) {
    // Shallow clone or no base branch — scan everything rather than nothing.
    return {
      files: await getAllSourceFiles(gitRoot),
      scope: "all tracked files (no base ref found)",
    };
  }
  return {
    files: await getChangedFiles(gitRoot, base),
    scope: `changed vs ${base}`,
  };
}
