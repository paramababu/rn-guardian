import fs from "node:fs";
import path from "node:path";
import type { Check, Issue, Severity } from "../../types.js";
import { importLocal } from "../util/resolve-local.js";
import { sourceFiles } from "../util/files.js";
import { docs } from "../docs.js";

/**
 * Minimal slice of the TypeScript compiler API — enough to load the project's
 * tsconfig, build a program, and read diagnostics. Kept as a local interface
 * (like `eslint.ts`) so rn-guardian never takes a hard dependency on typescript:
 * we run whichever version the target project has installed (resolve-local.ts).
 */
interface TsDiagnostic {
  file?: {
    fileName: string;
    getLineAndCharacterOfPosition(pos: number): { line: number; character: number };
  };
  start?: number;
  messageText: string | { messageText: string };
  category: number;
  code: number;
}
interface TsProgram {
  getConfigFileParsingDiagnostics?(): readonly TsDiagnostic[];
}
type TsWriteFile = (fileName: string, data: string) => void;
interface TsBuilderProgram {
  getProgram(): TsProgram;
  emit(targetSourceFile?: unknown, writeFile?: TsWriteFile): unknown;
}
interface TsSys {
  fileExists(p: string): boolean;
  readFile(p: string): string | undefined;
  writeFile(p: string, data: string): void;
  readDirectory(...args: unknown[]): string[];
  useCaseSensitiveFileNames: boolean;
}
interface TsModule {
  sys: TsSys;
  DiagnosticCategory: { Error: number; Warning: number };
  findConfigFile(
    searchPath: string,
    fileExists: (p: string) => boolean,
    configName?: string,
  ): string | undefined;
  readConfigFile(
    fileName: string,
    readFile: (p: string) => string | undefined,
  ): { config?: unknown; error?: TsDiagnostic };
  parseJsonConfigFileContent(
    json: unknown,
    host: TsSys,
    basePath: string,
  ): { options: Record<string, unknown>; fileNames: string[]; errors: TsDiagnostic[] };
  createProgram(rootNames: string[], options: Record<string, unknown>): TsProgram;
  createIncrementalProgram?(config: {
    rootNames: readonly string[];
    options: Record<string, unknown>;
  }): TsBuilderProgram;
  getPreEmitDiagnostics(program: TsProgram): readonly TsDiagnostic[];
  flattenDiagnosticMessageText(
    messageText: TsDiagnostic["messageText"],
    newLine: string,
  ): string;
}

/**
 * Whole-program TypeScript typecheck (`tsc --noEmit` via the compiler API).
 *
 * TypeScript is inherently a whole-program analysis — a change in one file can
 * break the types in another — so we compile the project once, then report only
 * the diagnostics that land in the *staged* source files. That keeps a commit
 * from being blocked by pre-existing errors in files the developer didn't touch,
 * while still catching type breaks they introduced in those files.
 *
 * Defaults to the `push` tier (it is the most expensive check); strict and
 * enterprise profiles promote it to `commit`.
 */
export const typescriptCheck: Check = {
  id: "typescript",
  inspector: "types",
  tier: "push",
  appliesTo: (ctx) => ctx.hasTypeScript,
  async run(files, ctx) {
    const start = Date.now();
    const done = (extra: Partial<import("../../types.js").CheckResult> = {}) => ({
      status: "pass" as const,
      issues: [] as Issue[],
      durationMs: Date.now() - start,
      ...extra,
    });

    const staged = sourceFiles(files);
    if (staged.length === 0) return done();

    const ts = await importLocal<TsModule>(ctx.packageRoot, "typescript");
    if (!ts?.createProgram) {
      return done({ status: "skipped", note: "typescript not resolvable in project" });
    }

    const configPath = ts.findConfigFile(
      ctx.packageRoot,
      ts.sys.fileExists,
      "tsconfig.json",
    );
    if (!configPath) {
      return done({ status: "skipped", note: "no tsconfig.json found" });
    }

    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error || !read.config) {
      return done({ status: "skipped", note: "tsconfig.json could not be parsed" });
    }

    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      path.dirname(configPath),
    );
    const diagnostics = typecheck(ts, parsed.fileNames, parsed.options, ctx.packageRoot);

    // Only surface diagnostics in the staged files, keyed by normalized abs path.
    const stagedByPath = new Map(staged.map((f) => [norm(f.absPath), f.path]));

    const issues: Issue[] = [];
    let hadError = false;
    let hadWarning = false;

    for (const diag of diagnostics) {
      if (!diag.file) continue; // config/global diagnostics: not tied to a staged file
      const rel = stagedByPath.get(norm(diag.file.fileName));
      if (!rel) continue;

      const severity: Severity =
        diag.category === ts.DiagnosticCategory.Error ? "error" : "warning";
      if (severity === "error") hadError = true;
      else hadWarning = true;

      const { line, character } =
        diag.start != null
          ? diag.file.getLineAndCharacterOfPosition(diag.start)
          : { line: 0, character: 0 };
      const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");

      issues.push({
        ruleId: `ts/TS${diag.code}`,
        inspector: "types",
        severity,
        file: rel,
        line: line + 1,
        column: character + 1,
        problem: message,
        why: "The TypeScript compiler rejects this code — the types don't line up. Type errors are the ones that turn into runtime crashes or a broken build.",
        impact: "The project no longer type-checks; CI (`tsc --noEmit`) and release builds will fail on this.",
        fix: {
          description:
            "Fix the type mismatch the message describes. There is no safe automatic fix for a type error.",
        },
        docsUrl: docs(`ts/TS${diag.code}`),
      });
    }

    const status = hadError ? "fail" : hadWarning ? "warn" : "pass";
    return done({ status, issues });
  },
};

/**
 * Type-check the program and return its diagnostics. Prefers an *incremental*
 * program backed by a `.tsbuildinfo` in `node_modules/.cache/rn-guardian`, so a
 * repeat push on a large project only re-checks what changed. The build-info is
 * persisted via `emit()` with a write hook that keeps only the `.tsbuildinfo`
 * and drops all JS/`.d.ts` output — nothing lands in the user's tree. Falls back
 * to a plain program when the incremental API or the cache dir is unavailable.
 */
function typecheck(
  ts: TsModule,
  rootNames: string[],
  options: Record<string, unknown>,
  packageRoot: string,
): readonly TsDiagnostic[] {
  if (ts.createIncrementalProgram) {
    const cacheDir = path.join(packageRoot, "node_modules", ".cache", "rn-guardian");
    const buildInfoFile = path.join(cacheDir, "typecheck.tsbuildinfo");
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      const builder = ts.createIncrementalProgram({
        rootNames,
        options: {
          ...options,
          noEmit: false, // emit() must run to persist the build-info…
          declaration: false,
          incremental: true,
          tsBuildInfoFile: buildInfoFile,
        },
      });
      const diagnostics = ts.getPreEmitDiagnostics(builder.getProgram());
      try {
        builder.emit(undefined, (fileName, data) => {
          // …but write ONLY the build-info; discard JS/d.ts so the tree is clean.
          if (fileName === buildInfoFile) ts.sys.writeFile(fileName, data);
        });
      } catch {
        // build-info persistence is a best-effort optimization
      }
      return diagnostics;
    } catch {
      // fall through to the non-incremental path
    }
  }
  const program = ts.createProgram(rootNames, { ...options, noEmit: true });
  return ts.getPreEmitDiagnostics(program);
}

/** Normalize a path for cross-platform comparison (TS reports POSIX slashes). */
function norm(p: string): string {
  return p.replace(/\\/g, "/");
}
