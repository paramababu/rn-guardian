import type { Tier } from "./types.js";
import { detectProject } from "./core/project/detect.js";
import { getStagedFiles, restage } from "./core/git/staged.js";
import { loadConfig, resolveConfig } from "./core/config/load.js";
import { assembleChecks } from "./core/registry.js";
import { runChecks, type RunReport } from "./core/runner/runner.js";
import { BUNDLED_PLUGINS } from "./plugins-list.js";

export interface EngineResult {
  report: RunReport;
  autofixed: number;
  profile: string;
  fileCount: number;
  /** Repo root, so callers can re-stage files after applying their own fixes. */
  gitRoot: string;
}

export interface EngineOptions {
  cwd: string;
  tier: Tier;
  /** Override the staged-file set (used by `check` to scan everything). */
  files?: Awaited<ReturnType<typeof getStagedFiles>>;
  autofix: boolean;
  onCheckStart?: Parameters<typeof runChecks>[4]["onCheckStart"];
  onCheckDone?: Parameters<typeof runChecks>[4]["onCheckDone"];
}

/**
 * Shared pipeline behind `run` (hook) and `check` (manual). Detects the
 * project, resolves config/profile, assembles core + plugin checks, runs the
 * requested tier, applies safe autofixes, and re-stages fixed files.
 */
export async function runEngine(opts: EngineOptions): Promise<EngineResult> {
  const ctx = await detectProject(opts.cwd);
  const config = resolveConfig(loadConfig(ctx.packageRoot));
  const checks = await assembleChecks(ctx, BUNDLED_PLUGINS);

  const files = opts.files ?? (await getStagedFiles(ctx.gitRoot));

  const report = await runChecks(checks, files, ctx, config, {
    tier: opts.tier,
    autofix: opts.autofix,
    onCheckStart: opts.onCheckStart,
    onCheckDone: opts.onCheckDone,
  });

  if (opts.autofix && report.fixedPaths.length > 0) {
    await restage(ctx.gitRoot, report.fixedPaths);
  }

  return {
    report,
    autofixed: report.fixedIssues.size,
    profile: config.profile,
    fileCount: files.length,
    gitRoot: ctx.gitRoot,
  };
}
