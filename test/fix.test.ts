import { describe, it, expect } from "vitest";
import { consoleLogCheck } from "../src/core/checks/console-log.js";
import { makeStaged } from "./helpers.js";
import fs from "node:fs";
import type { CheckConfig, ProjectContext } from "../src/types.js";

const ctx = {} as ProjectContext;
const cfg: CheckConfig = { enabled: true, tier: "commit", options: {} };

/**
 * The fix command's core mechanic is: collect the unsafe (confirm-required)
 * autofix per file and apply it. These tests exercise that mechanic directly
 * (the interactive prompt itself is covered by manual/dogfood validation).
 */
describe("console-log unsafe fix (fix command mechanic)", () => {
  it("exposes exactly one unsafe, confirm-required fix per file", async () => {
    const { staged, cleanup } = makeStaged({
      "src/A.tsx": "a();\nconsole.log(1);\nconsole.log(2);\nb();\n",
    });
    const res = await consoleLogCheck.run(staged, ctx, cfg);
    const withFix = res.issues.filter((i) => i.fix.auto);
    expect(withFix.length).toBe(1); // one file-level fix
    expect(withFix[0]!.fix.auto!.safe).toBe(false); // confirm-required
    cleanup();
  });

  it("applying the fix removes all console lines and re-reports clean", async () => {
    const { staged, cleanup } = makeStaged({
      "src/A.tsx": "keep();\nconsole.log(1);\nconsole.warn(2);\ndebugger;\nkeep2();\n",
    });
    const first = await consoleLogCheck.run(staged, ctx, cfg);
    const fix = first.issues.find((i) => i.fix.auto)!.fix.auto!;
    expect(await fix.apply()).toBe(true);
    expect(fs.readFileSync(staged[0]!.absPath, "utf8")).toBe("keep();\nkeep2();\n");

    // Re-running finds nothing left to fix.
    const second = await consoleLogCheck.run(staged, ctx, cfg);
    expect(second.issues.length).toBe(0);
    expect(second.status).toBe("pass");
    cleanup();
  });
});
