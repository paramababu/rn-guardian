import fs from "node:fs";
import type { AutoFix, Check, CheckConfig, Issue } from "../../types.js";
import { readFileSafe, sourceFiles, toLines } from "../util/files.js";
import { docs } from "../docs.js";

// A whole line that is just a console.<method>(...) or debugger statement.
// Kept intentionally conservative: only matches standalone statements so the
// autofix can safely delete the whole line without breaking an expression.
const STANDALONE_CONSOLE = /^\s*console\.(log|debug|info|warn|error)\s*\(.*\)\s*;?\s*$/;
const DEBUGGER = /^\s*debugger\s*;?\s*$/;

function isTargetLine(line: string): boolean {
  return STANDALONE_CONSOLE.test(line) || DEBUGGER.test(line);
}

/**
 * Idempotent whole-file autofix: re-reads the file and drops every standalone
 * console/debugger line. Idempotent means line-shift from earlier removals
 * never corrupts later ones. Not `safe` — it edits source, so it is confirm-only
 * and never runs in CI (PLAN.md §2, principle 4).
 */
function makeFix(absPath: string): AutoFix {
  return {
    safe: false,
    description: "remove the console/debugger statement",
    async apply() {
      const content = readFileSafe(absPath);
      if (content === null) return false;
      const lines = toLines(content);
      const kept = lines.filter((l) => !isTargetLine(l));
      if (kept.length === lines.length) return false;
      fs.writeFileSync(absPath, kept.join("\n"));
      return true;
    },
  };
}

export const consoleLogCheck: Check = {
  id: "console-log",
  inspector: "hygiene",
  tier: "commit",
  appliesTo: () => true,
  async run(files, _ctx, config: CheckConfig) {
    const start = Date.now();
    const issues: Issue[] = [];
    const loggerModule =
      typeof config.options.logger === "string"
        ? (config.options.logger as string)
        : undefined;

    for (const file of sourceFiles(files)) {
      const content = readFileSafe(file.absPath);
      if (content === null) continue;
      const lines = toLines(content);
      let flagged = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!isTargetLine(line)) continue;
        flagged = true;
        const isDebugger = DEBUGGER.test(line);
        issues.push({
          ruleId: isDebugger ? "hygiene/debugger" : "hygiene/no-console",
          inspector: "hygiene",
          severity: "warning",
          file: file.path,
          line: i + 1,
          problem: isDebugger
            ? "Leftover `debugger` statement."
            : "Leftover `console` statement.",
          why: isDebugger
            ? "A `debugger` shipped to a device pauses execution whenever devtools are attached and is never intended for production."
            : "Console calls ship to release builds, leak internal state to anyone with a log viewer, and add noise that hides real errors.",
          impact: isDebugger
            ? "Unexpected pauses during debugging sessions on real devices."
            : "Slower release logging and potential leakage of user data.",
          fix: {
            description: loggerModule
              ? `Remove it, or route through your logger (\`${loggerModule}\`) if the message is intentional.`
              : "Remove it before committing.",
            // Only attach the removal fix to the first flagged line per file;
            // the fix rewrites the whole file idempotently.
            auto: flagged && !issueAlreadyHasFix(issues, file.path)
              ? makeFix(file.absPath)
              : undefined,
          },
          docsUrl: docs("no-console"),
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

function issueAlreadyHasFix(issues: Issue[], filePath: string): boolean {
  return issues.some((i) => i.file === filePath && i.fix.auto);
}
