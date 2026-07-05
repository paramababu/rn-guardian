import type { Check, Issue } from "../../types.js";
import { readFileSafe, sourceFiles, toLines } from "../util/files.js";
import { docs } from "../docs.js";

// Conflict markers at column 0. `|||||||` is the diff3 base marker.
const MARKER = /^(<{7}|={7}|>{7}|\|{7})(\s|$)/;

export const mergeMarkersCheck: Check = {
  id: "merge-markers",
  inspector: "hygiene",
  tier: "commit",
  appliesTo: () => true,
  async run(files) {
    const start = Date.now();
    const issues: Issue[] = [];

    for (const file of sourceFiles(files)) {
      const content = readFileSafe(file.absPath);
      if (content === null) continue;
      const lines = toLines(content);
      for (let i = 0; i < lines.length; i++) {
        if (MARKER.test(lines[i]!)) {
          issues.push({
            ruleId: "hygiene/merge-marker",
            inspector: "hygiene",
            severity: "error",
            file: file.path,
            line: i + 1,
            problem: "Unresolved merge conflict marker.",
            why: "A line beginning with <<<<<<<, =======, |||||||, or >>>>>>> means a merge or rebase was never finished. Committing it ships syntactically broken source.",
            impact:
              "The file will fail to parse — builds, Metro, and tests break immediately.",
            fix: {
              description:
                "Resolve the conflict: keep the intended code and delete all marker lines.",
            },
            docsUrl: docs("merge-marker"),
          });
        }
      }
    }

    return {
      status: issues.length ? "fail" : "pass",
      issues,
      durationMs: Date.now() - start,
    };
  },
};
