import fs from "node:fs";
import path from "node:path";
import type { Check, Issue } from "../../types.js";
import { readFileSafe, sourceFiles } from "../util/files.js";
import { docs } from "../docs.js";

/**
 * Circular-import detector — dependency-free, scoped to the "changed subgraph".
 *
 * Starting from the staged source files, it walks *relative* imports (`./`,
 * `../`), resolving each to a file on disk, and reports any import cycle it can
 * reach. It deliberately does not follow bare `node_modules` specifiers or
 * tsconfig path aliases — resolving those correctly needs a full resolver (that
 * is what madge buys, and the dependency we chose not to take). Relative-import
 * cycles are the common, hand-written case and the ones you can actually fix.
 *
 * A guarded node cap keeps a pathological graph from stalling a push.
 */
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_EXTS = [".ts", ".tsx", ".js", ".jsx"];
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const NODE_CAP = 5000;

export const circularDepsCheck: Check = {
  id: "circular-deps",
  inspector: "hygiene",
  tier: "push",
  appliesTo: () => true,
  async run(files, ctx) {
    const start = Date.now();
    const entries = sourceFiles(files).map((f) => f.absPath);
    if (entries.length === 0) {
      return { status: "pass", issues: [], durationMs: Date.now() - start };
    }

    const cycles = collectCycles(entries);
    const issues: Issue[] = cycles.map((cycle) => cycleIssue(cycle, ctx.gitRoot));

    return {
      status: issues.length ? "warn" : "pass",
      issues,
      durationMs: Date.now() - start,
    };
  },
};

/** DFS from the entry files, collecting distinct relative-import cycles. */
function collectCycles(entries: string[]): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const neighborCache = new Map<string, string[]>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();
  let visited = 0;

  const neighbors = (node: string): string[] => {
    const cached = neighborCache.get(node);
    if (cached) return cached;
    const content = readFileSafe(node);
    const out: string[] = [];
    if (content !== null) {
      for (const spec of relativeSpecifiers(content)) {
        const resolved = resolveImport(node, spec);
        if (resolved) out.push(resolved);
      }
    }
    neighborCache.set(node, out);
    return out;
  };

  const dfs = (node: string): void => {
    if (visited >= NODE_CAP) return;
    color.set(node, GRAY);
    stack.push(node);
    visited++;
    for (const next of neighbors(node)) {
      const c = color.get(next) ?? WHITE;
      if (c === WHITE) {
        dfs(next);
      } else if (c === GRAY) {
        const idx = stack.lastIndexOf(next);
        if (idx !== -1) {
          const cycle = stack.slice(idx);
          const key = canonical(cycle);
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(cycle);
          }
        }
      }
    }
    stack.pop();
    color.set(node, BLACK);
  };

  for (const entry of entries) {
    if ((color.get(entry) ?? WHITE) === WHITE) dfs(entry);
  }
  return cycles;
}

/** Rotate a cycle to start at its lexicographically smallest node, so the same
 *  cycle found from different entry points dedupes to one key. */
function canonical(cycle: string[]): string {
  let min = 0;
  for (let i = 1; i < cycle.length; i++) if (cycle[i]! < cycle[min]!) min = i;
  return [...cycle.slice(min), ...cycle.slice(0, min)].join(">");
}

function relativeSpecifiers(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const spec = m[1]!;
    if (spec.startsWith(".")) out.push(spec);
  }
  return out;
}

/** Resolve a relative specifier to an on-disk file, or null. */
function resolveImport(importer: string, spec: string): string | null {
  const target = path.resolve(path.dirname(importer), spec);
  if (isFile(target)) return target;
  for (const ext of EXTS) if (isFile(target + ext)) return target + ext;
  for (const ext of INDEX_EXTS) {
    const idx = path.join(target, "index" + ext);
    if (isFile(idx)) return idx;
  }
  return null;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function cycleIssue(cycle: string[], gitRoot: string): Issue {
  const rels = cycle.map(baseName);
  const chain = [...rels, rels[0]].join(" → ");
  return {
    ruleId: "hygiene/circular-import",
    inspector: "hygiene",
    severity: "warning",
    file: toRel(cycle[0]!, gitRoot),
    line: 1,
    problem: `Circular import: ${chain}`,
    why: "Modules in an import cycle can observe each other half-initialized: whichever is loaded first sees the others' exports as undefined until evaluation completes. That surfaces as intermittent 'undefined is not a function' errors that depend on load order.",
    impact: "Fragile module init order — bugs that appear only after an unrelated import moves.",
    fix: {
      description:
        "Break the cycle: extract the shared piece into a third module both can import, invert one dependency, or defer the import to call-time.",
    },
    docsUrl: docs("circular-import"),
  };
}

function baseName(abs: string): string {
  const norm = abs.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i === -1 ? norm : norm.slice(i + 1);
}

function toRel(abs: string, root: string): string {
  return abs.startsWith(root) ? abs.slice(root.length + 1) : baseName(abs);
}
