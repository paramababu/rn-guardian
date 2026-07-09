import type { Issue } from "../../types.js";

/**
 * Team-rule gates for `rn-guardian ci` — the `"ci"` block in the config
 * (PLAN.md §5). These turn advisory warnings into hard, configurable CI
 * failures without adding any dependency or heuristic. Coverage / bundle-size /
 * no-any gates are planned but need heavier machinery and land later.
 */
export interface CiGateConfig {
  /** Block the build on the first error (default) or on any warning. */
  failOn?: "error" | "warning";
  /** Fail when remaining warnings exceed this count. */
  maxWarnings?: number;
}

export interface GateFailure {
  /** Short heading, used as the annotation title (e.g. "ci.maxWarnings"). */
  title: string;
  message: string;
}

export interface GateResult {
  /** True when a gate (not just a pre-existing error) should block the build. */
  blocked: boolean;
  failures: GateFailure[];
}

/** Read and normalize the `ci` block from raw config (all fields optional). */
export function readGateConfig(raw: unknown): CiGateConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  const out: CiGateConfig = {};
  if (cfg.failOn === "error" || cfg.failOn === "warning") out.failOn = cfg.failOn;
  if (typeof cfg.maxWarnings === "number" && cfg.maxWarnings >= 0) {
    out.maxWarnings = cfg.maxWarnings;
  }
  return out;
}

/** Evaluate the gates against the issues that still need attention. */
export function evaluateGates(
  remaining: Issue[],
  cfg: CiGateConfig,
): GateResult {
  const warnings = remaining.filter((i) => i.severity === "warning").length;
  const failures: GateFailure[] = [];

  if (cfg.failOn === "warning" && warnings > 0) {
    failures.push({
      title: "ci.failOn",
      message: `failOn is set to "warning" and ${warnings} warning${
        warnings === 1 ? "" : "s"
      } remain.`,
    });
  }

  if (cfg.maxWarnings !== undefined && warnings > cfg.maxWarnings) {
    failures.push({
      title: "ci.maxWarnings",
      message: `${warnings} warnings exceed the configured ci.maxWarnings limit of ${cfg.maxWarnings}.`,
    });
  }

  return { blocked: failures.length > 0, failures };
}
