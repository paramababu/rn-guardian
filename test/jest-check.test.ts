import { describe, it, expect } from "vitest";
import { parseJestJson, affectedTestsCheck } from "../src/core/checks/jest.js";
import { makeStaged } from "./helpers.js";
import type { CheckConfig, ProjectContext } from "../src/types.js";

const cfg: CheckConfig = { enabled: true, tier: "push", options: {} };

describe("parseJestJson", () => {
  it("extracts failing suites with a first message", () => {
    const out = JSON.stringify({
      numFailedTests: 1,
      testResults: [
        {
          name: "/repo/src/a.test.ts",
          status: "failed",
          assertionResults: [
            { status: "passed", failureMessages: [] },
            { status: "failed", failureMessages: ["expect(1).toBe(2)\n  at line 3"] },
          ],
        },
        {
          name: "/repo/src/b.test.ts",
          status: "passed",
          assertionResults: [{ status: "passed", failureMessages: [] }],
        },
      ],
    });
    const summary = parseJestJson(out)!;
    expect(summary.numFailedTests).toBe(1);
    expect(summary.failedFiles).toHaveLength(1);
    expect(summary.failedFiles[0]!.file).toBe("/repo/src/a.test.ts");
    expect(summary.failedFiles[0]!.firstMessage).toContain("toBe(2)");
  });

  it("treats a suite that failed to run as one failure", () => {
    const out = JSON.stringify({
      testResults: [{ name: "/x/broken.test.ts", status: "failed", message: "SyntaxError", assertionResults: [] }],
    });
    const summary = parseJestJson(out)!;
    expect(summary.failedFiles).toHaveLength(1);
    expect(summary.failedFiles[0]!.failures).toBe(1);
  });

  it("returns an empty list when everything passes", () => {
    const out = JSON.stringify({
      numFailedTests: 0,
      testResults: [{ name: "/x/ok.test.ts", status: "passed", assertionResults: [] }],
    });
    expect(parseJestJson(out)!.failedFiles).toHaveLength(0);
  });

  it("returns null for unparseable output", () => {
    expect(parseJestJson("not json at all")).toBeNull();
  });

  it("tolerates leading log noise before the JSON", () => {
    const out = `Determining test suites to run...\n{"testResults":[]}`;
    expect(parseJestJson(out)).not.toBeNull();
  });
});

describe("affected-tests check", () => {
  it("skips cleanly when jest is not installed", async () => {
    const { staged, dir, cleanup } = makeStaged({ "src/a.ts": "export const a = 1;\n" });
    const res = await affectedTestsCheck.run(staged, { packageRoot: dir } as ProjectContext, cfg);
    expect(res.status).toBe("skipped");
    expect(res.note).toContain("jest");
    cleanup();
  });

  it("passes when there are no staged source files", async () => {
    const res = await affectedTestsCheck.run([], {} as ProjectContext, cfg);
    expect(res.status).toBe("pass");
  });
});
