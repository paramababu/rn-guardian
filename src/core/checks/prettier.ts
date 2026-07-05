import fs from "node:fs";
import type { AutoFix, Check, Issue } from "../../types.js";
import { importLocal } from "../util/resolve-local.js";
import { docs } from "../docs.js";

/** Minimal shape of the Prettier API we use. */
interface PrettierApi {
  resolveConfig(filePath: string): Promise<unknown>;
  getFileInfo(
    filePath: string,
  ): Promise<{ ignored: boolean; inferredParser: string | null }>;
  check(source: string, options: Record<string, unknown>): Promise<boolean>;
  format(source: string, options: Record<string, unknown>): Promise<string>;
}

export const prettierCheck: Check = {
  id: "prettier",
  inspector: "format",
  tier: "commit",
  appliesTo: (ctx) => ctx.prettierInstalled,
  async run(files, ctx) {
    const start = Date.now();
    const prettier = await importLocal<PrettierApi>(ctx.packageRoot, "prettier");
    if (!prettier) {
      return {
        status: "skipped",
        issues: [],
        durationMs: Date.now() - start,
        note: "prettier not resolvable in project",
      };
    }

    const issues: Issue[] = [];

    for (const file of files) {
      const info = await prettier.getFileInfo(file.absPath);
      if (info.ignored || !info.inferredParser) continue;

      const source = fs.readFileSync(file.absPath, "utf8");
      const options = {
        ...((await prettier.resolveConfig(file.absPath)) as object),
        filepath: file.absPath,
      };

      const formatted = await prettier.check(source, options);
      if (formatted) continue;

      issues.push({
        ruleId: "format/prettier",
        inspector: "format",
        severity: "error",
        file: file.path,
        line: 1,
        problem: "File is not formatted to the project's Prettier config.",
        why: "Consistent formatting keeps diffs small and reviews focused on logic instead of whitespace.",
        fix: {
          description: "Run Prettier — rn-guardian does this for you and re-stages.",
          auto: makeFix(prettier, file.absPath, options),
        },
        docsUrl: docs("prettier"),
      });
    }

    return {
      status: issues.length ? "fail" : "pass",
      issues,
      durationMs: Date.now() - start,
    };
  },
};

function makeFix(
  prettier: PrettierApi,
  absPath: string,
  options: Record<string, unknown>,
): AutoFix {
  return {
    safe: true, // reformatting never changes program behavior
    description: "format with Prettier",
    async apply() {
      const source = fs.readFileSync(absPath, "utf8");
      const formatted = await prettier.format(source, options);
      if (formatted === source) return false;
      fs.writeFileSync(absPath, formatted);
      return true;
    },
  };
}
