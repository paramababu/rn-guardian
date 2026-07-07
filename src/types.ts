/**
 * Core contracts for rn-guardian (PLAN.md §3).
 *
 * `Check` is the internal unit of work. Users never see the word "check" — the
 * reporter groups checks into user-facing **Inspectors**. `Plugin` bundles the
 * framework-specific checks (React Native is the first; the core knows nothing
 * about it). Every `Issue` is explainable: problem → why → impact → fix → docs.
 */

/** User-facing grouping shown in the reporter. */
export type InspectorId =
  | "format" // Prettier / whitespace
  | "lint" // ESLint
  | "hygiene" // console.log, debugger, merge markers, TODOs
  | "performance" // RN render/list performance
  | "accessibility" // RN a11y
  | "security" // secrets, insecure storage, http
  | "dependency" // heavy deps, duplicates
  | "types" // TypeScript
  | "tests"; // affected unit tests

export interface InspectorMeta {
  id: InspectorId;
  /** Human label rendered as "<title> Inspector" (or as-is for advisors). */
  title: string;
}

/** Where a check is allowed to run. Ordered cheapest-gate to most-thorough. */
export type Tier = "commit" | "push" | "ci";

export type Severity = "error" | "warning";

/** Status of a single check's execution. */
export type CheckStatus = "pass" | "fixed" | "warn" | "fail" | "skipped";

/** A single file staged for commit (paths are repo-root relative, POSIX). */
export interface StagedFile {
  /** Repo-relative path, forward slashes. */
  path: string;
  /** Absolute path on disk. */
  absPath: string;
  /** Git status letter: A(dded) C(opied) M(odified) R(enamed). */
  status: "A" | "C" | "M" | "R";
  /** True when only part of the file is staged (unstaged changes remain). */
  partiallyStaged: boolean;
}

/**
 * A deterministic, safe autofix. `apply` mutates the file on disk and resolves
 * true if it changed anything. Only fixes that cannot alter program behavior
 * should be marked `safe: true` (those apply automatically); everything else
 * requires interactive confirmation and never runs in CI/non-TTY.
 */
export interface AutoFix {
  safe: boolean;
  /** Short description of what the fix does, e.g. "remove console.log". */
  description: string;
  apply(): Promise<boolean>;
}

/**
 * One finding. The five-part shape is mandatory (PLAN.md §2, principle 3): no
 * bare error strings, ever.
 */
export interface Issue {
  ruleId: string;
  inspector: InspectorId;
  severity: Severity;
  file: string;
  line: number;
  column?: number;
  /** What is wrong. */
  problem: string;
  /** Why it matters. */
  why: string;
  /** Concrete consequence, when known. */
  impact?: string;
  /** How to fix it (prose), plus an optional mechanical fix. */
  fix: {
    description: string;
    auto?: AutoFix;
  };
  /** Deep-dive link. */
  docsUrl?: string;
}

export interface CheckResult {
  status: CheckStatus;
  issues: Issue[];
  durationMs: number;
  /** Optional note shown when a check is skipped (e.g. "prettier not installed"). */
  note?: string;
}

/**
 * Detected facts about the project. Populated by the core (framework-agnostic
 * fields) and enriched by whichever plugin `detect()`s the project.
 */
export interface ProjectContext {
  /** Absolute path to the git repository root. */
  gitRoot: string;
  /** Absolute path to the nearest package root (may equal gitRoot). */
  packageRoot: string;
  hasTypeScript: boolean;
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  eslint: { installed: boolean; major?: number };
  prettierInstalled: boolean;
  /** Existing hook manager we must coexist with, if any. */
  hookManager: "husky" | "lefthook" | "none";
  /** Framework detected by a plugin; undefined until a plugin claims it. */
  framework?: {
    id: string;
    /** e.g. "expo" | "bare" for react-native. */
    variant?: string;
    version?: string;
  };
}

/** Per-check configuration resolved from the active Profile + user overrides. */
export interface CheckConfig {
  enabled: boolean;
  tier: Tier;
  /** Arbitrary per-check options (e.g. large-assets maxKb). */
  options: Record<string, unknown>;
  /**
   * Gitignore-style globs; files matching any are hidden from this check only
   * (on top of the repo-wide `.rn-guardianignore`). Empty/absent = no extra
   * exclusions.
   */
  exclude?: string[];
}

export interface Check {
  id: string;
  inspector: InspectorId;
  /** Default tier; may be overridden by profile/config. */
  tier: Tier;
  /** Whether this check applies to the detected project. */
  appliesTo(ctx: ProjectContext): boolean;
  run(
    files: StagedFile[],
    ctx: ProjectContext,
    config: CheckConfig,
  ): Promise<CheckResult>;
}

export interface Plugin {
  id: string;
  /** Does this plugin's framework describe the project? */
  detect(ctx: ProjectContext): Promise<boolean> | boolean;
  /**
   * Enrich the context with framework details (variant, version). Called only
   * when `detect` returned true.
   */
  enrich?(ctx: ProjectContext): Promise<void> | void;
  checks: Check[];
}
