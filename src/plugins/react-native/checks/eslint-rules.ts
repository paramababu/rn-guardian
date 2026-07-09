import type { Check, Issue, ProjectContext } from "../../../types.js";
import { importLocal, resolveLocalPath } from "../../../core/util/resolve-local.js";
import { readFileSafe, sourceFiles } from "../../../core/util/files.js";
import { docs } from "../../../core/docs.js";
import { importsReactNative } from "../jsx.js";
import { rnGuardianEslintPlugin, PLUGIN_NAME } from "../eslint-plugin/index.js";
import { RULE_META, RULE_NAMES } from "../eslint-plugin/meta.js";

// Minimal shapes from the ESLint Node API (compatible across v8 and v9).
interface LintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  fatal?: boolean;
}
interface LintResult {
  filePath: string;
  messages: LintMessage[];
}
interface ESLintInstance {
  lintFiles(patterns: string[]): Promise<LintResult[]>;
}
interface ESLintCtor {
  new (options: Record<string, unknown>): ESLintInstance;
  version?: string;
}
interface ESLintModule {
  ESLint: ESLintCtor;
}

const TS_PARSER = "@typescript-eslint/parser";

/**
 * Can the AST rule pack run for this project? Requires ESLint to be resolvable
 * plus a parser that covers every file the heuristics would: the project's
 * `@typescript-eslint/parser` covers .ts/.tsx *and* .js/.jsx, and ESLint's
 * bundled espree covers .jsx on its own — so a JS-only project needs no extra
 * parser. A TypeScript project without the TS parser cannot cover its .tsx, so
 * we stay on the heuristics there. Pure resolution checks, so it is cheap and
 * synchronous — safe to consult from `appliesTo`.
 */
export function astRulesAvailable(ctx: ProjectContext): boolean {
  if (!resolveLocalPath(ctx.packageRoot, "eslint")) return false;
  if (resolveLocalPath(ctx.packageRoot, TS_PARSER)) return true;
  return !ctx.hasTypeScript;
}

const JS_EXTS = [".jsx", ".js"];
const TS_EXTS = [".tsx", ".ts"];

export const eslintRulesCheck: Check = {
  id: "rn-eslint-rules",
  inspector: "performance",
  tier: "commit",
  appliesTo: (ctx) =>
    ctx.framework?.id === "react-native" && ctx.framework.astRules === true,
  async run(files, ctx) {
    const start = Date.now();
    const mod = await importLocal<ESLintModule>(ctx.packageRoot, "eslint");
    if (!mod?.ESLint) {
      return {
        status: "skipped",
        issues: [],
        durationMs: Date.now() - start,
        note: "eslint not resolvable in project",
      };
    }

    const tsParserPath = resolveLocalPath(ctx.packageRoot, TS_PARSER);
    const exts = tsParserPath ? [...TS_EXTS, ...JS_EXTS] : JS_EXTS;

    // Only lint RN component files with a JSX-capable extension — same scope as
    // the heuristic checks this replaces, so web/util files never trip the rules.
    const targets = sourceFiles(files).filter((f) => {
      if (!exts.some((e) => f.path.endsWith(e))) return false;
      const content = readFileSafe(f.absPath);
      return content !== null && importsReactNative(content);
    });
    if (targets.length === 0) {
      return { status: "pass", issues: [], durationMs: Date.now() - start };
    }

    const eslint = await buildInstance(mod.ESLint, ctx, tsParserPath, exts);
    const results = await eslint.lintFiles(targets.map((f) => f.absPath));

    const issues: Issue[] = [];
    for (const res of results) {
      const rel = toRel(res.filePath, ctx.packageRoot);
      for (const m of res.messages) {
        // Only our own rules — ignore any stray parse error on an odd file.
        if (!m.ruleId || !m.ruleId.startsWith(`${PLUGIN_NAME}/`)) continue;
        const short = m.ruleId.slice(PLUGIN_NAME.length + 1);
        const meta = RULE_META[short];
        if (!meta) continue;
        issues.push({
          ruleId: meta.ruleId,
          inspector: meta.inspector,
          severity: "warning",
          file: rel,
          line: m.line ?? 1,
          column: m.column,
          problem: m.message,
          why: meta.why,
          impact: meta.impact,
          fix: { description: meta.fix },
          docsUrl: docs(meta.docsSlug),
        });
      }
    }

    return {
      status: issues.length ? "warn" : "pass",
      issues,
      durationMs: Date.now() - start,
    };
  },
};

/**
 * Build an ESLint instance that runs ONLY our plugin's rules, configured from
 * scratch (the project's own config is ignored) so results are deterministic.
 * Flat config (v9+) and legacy eslintrc (v8) inject the plugin differently.
 */
async function buildInstance(
  ESLint: ESLintCtor,
  ctx: ProjectContext,
  tsParserPath: string | null,
  exts: string[],
): Promise<ESLintInstance> {
  const rules = Object.fromEntries(
    RULE_NAMES.map((n) => [`${PLUGIN_NAME}/${n}`, "warn"]),
  );
  const flat = isFlat(ESLint, ctx);

  if (flat) {
    const configs: Record<string, unknown>[] = [
      {
        files: exts.map((e) => `**/*${e}`),
        plugins: { [PLUGIN_NAME]: rnGuardianEslintPlugin },
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules,
      },
    ];
    if (tsParserPath) {
      const parser = await importLocal(ctx.packageRoot, TS_PARSER);
      if (parser) {
        configs.push({
          files: ["**/*.ts", "**/*.tsx"],
          languageOptions: { parser },
        });
      }
    }
    return new ESLint({
      cwd: ctx.packageRoot,
      overrideConfigFile: true,
      overrideConfig: configs,
      errorOnUnmatchedPattern: false,
    });
  }

  // eslintrc (ESLint v8 and earlier): the plugin object is passed by name via
  // the `plugins` option; a parser override handles TypeScript files.
  const baseConfig: Record<string, unknown> = {
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
    plugins: [PLUGIN_NAME],
    rules,
    overrides: tsParserPath
      ? [{ files: ["*.ts", "*.tsx"], parser: tsParserPath }]
      : [],
  };
  return new ESLint({
    cwd: ctx.packageRoot,
    useEslintrc: false,
    plugins: { [PLUGIN_NAME]: rnGuardianEslintPlugin },
    baseConfig,
    extensions: exts,
    errorOnUnmatchedPattern: false,
  });
}

/** ESLint ≥ 9 is flat-config only; before that, default to eslintrc. */
function isFlat(ESLint: ESLintCtor, ctx: ProjectContext): boolean {
  const major = parseMajor(ESLint.version) ?? ctx.eslint.major;
  return major === undefined ? true : major >= 9;
}

function parseMajor(version: string | undefined): number | undefined {
  const m = version?.match(/^(\d+)\./);
  return m ? Number(m[1]) : undefined;
}

function toRel(abs: string, root: string): string {
  return abs.startsWith(root) ? abs.slice(root.length + 1) : abs;
}
