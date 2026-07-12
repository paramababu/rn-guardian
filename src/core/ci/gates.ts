import fs from "node:fs";
import path from "node:path";
import type { Issue, StagedFile } from "../../types.js";
import { importLocal } from "../util/resolve-local.js";

/**
 * Team-rule gates for `rn-guardian ci` — the `"ci"` block in the config
 * (PLAN.md §5). These turn advisory warnings into hard, configurable CI
 * failures without adding any dependency or heuristic.
 *
 * The artifact-backed gates (`coverage`, `maxBundleMb`) deliberately read what
 * the project's own tooling produced instead of running it: rn-guardian stays
 * fast and deterministic, and an enabled gate whose artifact is missing FAILS
 * with instructions rather than silently passing.
 */
export interface CiGateConfig {
  /** Block the build on the first error (default) or on any warning. */
  failOn?: "error" | "warning";
  /** Fail when remaining warnings exceed this count. */
  maxWarnings?: number;
  /**
   * Minimum coverage percentage, read from the project's Jest/istanbul
   * `coverage/coverage-summary.json`. A number gates overall line coverage;
   * an object gates individual metrics.
   */
  coverage?:
    | number
    | Partial<Record<"lines" | "statements" | "branches" | "functions", number>>;
  /** Fail when a changed TypeScript file contains an explicit `any`. */
  noAny?: boolean;
  /** Fail when the built JS bundle exceeds this size (megabytes). */
  maxBundleMb?: number;
  /**
   * Bundle artifact for `maxBundleMb` — a file or directory, relative to the
   * package root. When omitted, the usual Expo/bare output locations are tried.
   */
  bundlePath?: string;
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

/** What the project-inspecting gates need beyond the issue list. */
export interface GateEnv {
  packageRoot: string;
  /** The files this ci run scanned (the PR diff or the full tree). */
  files: StagedFile[];
}

const COVERAGE_METRICS = ["lines", "statements", "branches", "functions"] as const;
type CoverageMetric = (typeof COVERAGE_METRICS)[number];

/** Read and normalize the `ci` block from raw config (all fields optional). */
export function readGateConfig(raw: unknown): CiGateConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  const out: CiGateConfig = {};
  if (cfg.failOn === "error" || cfg.failOn === "warning") out.failOn = cfg.failOn;
  if (typeof cfg.maxWarnings === "number" && cfg.maxWarnings >= 0) {
    out.maxWarnings = cfg.maxWarnings;
  }
  if (typeof cfg.coverage === "number" && cfg.coverage > 0 && cfg.coverage <= 100) {
    out.coverage = cfg.coverage;
  } else if (typeof cfg.coverage === "object" && cfg.coverage !== null) {
    const obj: Partial<Record<CoverageMetric, number>> = {};
    for (const m of COVERAGE_METRICS) {
      const v = (cfg.coverage as Record<string, unknown>)[m];
      if (typeof v === "number" && v > 0 && v <= 100) obj[m] = v;
    }
    if (Object.keys(obj).length > 0) out.coverage = obj;
  }
  if (cfg.noAny === true) out.noAny = true;
  if (typeof cfg.maxBundleMb === "number" && cfg.maxBundleMb > 0) {
    out.maxBundleMb = cfg.maxBundleMb;
  }
  if (typeof cfg.bundlePath === "string" && cfg.bundlePath.length > 0) {
    out.bundlePath = cfg.bundlePath;
  }
  return out;
}

/** Evaluate the gates against the issues that still need attention. */
export async function evaluateGates(
  remaining: Issue[],
  cfg: CiGateConfig,
  env: GateEnv,
): Promise<GateResult> {
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

  if (cfg.coverage !== undefined) {
    const f = coverageGate(cfg.coverage, env.packageRoot);
    if (f) failures.push(f);
  }

  if (cfg.noAny) {
    const f = await noAnyGate(env);
    if (f) failures.push(f);
  }

  if (cfg.maxBundleMb !== undefined) {
    const f = bundleGate(cfg.maxBundleMb, cfg.bundlePath, env.packageRoot);
    if (f) failures.push(f);
  }

  return { blocked: failures.length > 0, failures };
}

// ---- ci.coverage ------------------------------------------------------------

const COVERAGE_SUMMARY = path.join("coverage", "coverage-summary.json");

function coverageGate(
  min: NonNullable<CiGateConfig["coverage"]>,
  packageRoot: string,
): GateFailure | null {
  const thresholds: Partial<Record<CoverageMetric, number>> =
    typeof min === "number" ? { lines: min } : min;

  let summary: Record<string, Record<string, { pct?: number }>>;
  try {
    summary = JSON.parse(
      fs.readFileSync(path.join(packageRoot, COVERAGE_SUMMARY), "utf8"),
    );
  } catch {
    return {
      title: "ci.coverage",
      message:
        `coverage gate is enabled but ${COVERAGE_SUMMARY} was not found — ` +
        `generate it earlier in the job, e.g. \`jest --coverage --coverageReporters=json-summary\`.`,
    };
  }

  const total = summary.total ?? {};
  const shortfalls: string[] = [];
  for (const metric of COVERAGE_METRICS) {
    const need = thresholds[metric];
    if (need === undefined) continue;
    const got = total[metric]?.pct;
    if (typeof got !== "number") {
      shortfalls.push(`${metric}: not present in the summary (need ≥ ${need}%)`);
    } else if (got < need) {
      shortfalls.push(`${metric}: ${got}% < ${need}%`);
    }
  }

  return shortfalls.length > 0
    ? { title: "ci.coverage", message: `coverage below threshold — ${shortfalls.join("; ")}.` }
    : null;
}

// ---- ci.noAny ---------------------------------------------------------------

/** Minimal slice of the TypeScript API used for the `any` scan. */
interface TsApi {
  createSourceFile(
    name: string,
    text: string,
    target: number,
    parents?: boolean,
    kind?: number,
  ): TsNode & {
    getLineAndCharacterOfPosition(pos: number): { line: number; character: number };
  };
  forEachChild(node: TsNode, cb: (n: TsNode) => void): void;
  SyntaxKind: { AnyKeyword: number };
  ScriptTarget: { Latest: number };
  ScriptKind: { TS: number; TSX: number };
}
interface TsNode {
  kind: number;
  getStart(sourceFile?: unknown): number;
}

async function noAnyGate(env: GateEnv): Promise<GateFailure | null> {
  const targets = env.files.filter(
    (f) => /\.(ts|tsx)$/.test(f.path) && !f.path.endsWith(".d.ts"),
  );
  if (targets.length === 0) return null;

  const ts = await importLocal<TsApi>(env.packageRoot, "typescript");
  if (!ts) {
    return {
      title: "ci.noAny",
      message:
        "noAny gate is enabled but typescript is not resolvable in the project — install it or disable the gate.",
    };
  }

  const hits: string[] = [];
  for (const file of targets) {
    let text: string;
    try {
      text = fs.readFileSync(file.absPath, "utf8");
    } catch {
      continue; // deleted between diff and scan — nothing to gate
    }
    const sf = ts.createSourceFile(
      file.path,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: TsNode): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        hits.push(`${file.path}:${line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf as unknown as TsNode);
  }

  if (hits.length === 0) return null;
  const shown = hits.slice(0, 10).join(", ");
  const more = hits.length > 10 ? ` (+${hits.length - 10} more)` : "";
  return {
    title: "ci.noAny",
    message: `${hits.length} explicit \`any\` type${
      hits.length === 1 ? "" : "s"
    } in changed files: ${shown}${more}.`,
  };
}

// ---- ci.maxBundleMb ----------------------------------------------------------

/** Where the usual RN toolchains put a built JS bundle, tried in order. */
const BUNDLE_CANDIDATES = [
  path.join("dist", "_expo", "static", "js"), // expo export
  path.join("ios", "main.jsbundle"),
  path.join("android", "app", "src", "main", "assets", "index.android.bundle"),
];

const BUNDLE_EXT = /\.(js|hbc|jsbundle|bundle)$/;

function bundleGate(
  maxMb: number,
  bundlePath: string | undefined,
  packageRoot: string,
): GateFailure | null {
  const candidates = bundlePath ? [bundlePath] : BUNDLE_CANDIDATES;
  let found: { rel: string; bytes: number } | null = null;
  for (const rel of candidates) {
    const bytes = artifactSize(path.join(packageRoot, rel));
    if (bytes !== null) {
      found = { rel, bytes };
      break;
    }
  }

  if (!found) {
    const where = bundlePath
      ? `ci.bundlePath ("${bundlePath}")`
      : `any of the usual locations (${BUNDLE_CANDIDATES.join(", ")})`;
    return {
      title: "ci.maxBundleMb",
      message:
        `bundle-size gate is enabled but no bundle artifact exists at ${where} — ` +
        `build one earlier in the job (e.g. \`npx expo export\` or \`npx react-native bundle\`), or set ci.bundlePath.`,
    };
  }

  const mb = found.bytes / (1024 * 1024);
  return mb > maxMb
    ? {
        title: "ci.maxBundleMb",
        message: `bundle at ${found.rel} is ${mb.toFixed(2)} MB, over the ${maxMb} MB limit.`,
      }
    : null;
}

/**
 * Size of a bundle artifact: the file itself, or for a directory the sum of
 * bundle-looking files inside (source maps excluded). Null when absent/empty.
 */
function artifactSize(abs: string): number | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null;
  }
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return null;

  let total = 0;
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (BUNDLE_EXT.test(e.name)) total += fs.statSync(p).size;
    }
  };
  walk(abs);
  return total > 0 ? total : null;
}
