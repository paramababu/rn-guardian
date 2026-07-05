import { describe, it, expect } from "vitest";
import { runChecks } from "../src/core/runner/runner.js";
import { resolveConfig } from "../src/core/config/load.js";
import type { Check, ProjectContext, StagedFile } from "../src/types.js";

const ctx = {} as ProjectContext;
const files: StagedFile[] = [
  { path: "a.ts", absPath: "/a.ts", status: "M", partiallyStaged: false },
];

function check(id: string, tier: Check["tier"], produce: () => Awaited<ReturnType<Check["run"]>>): Check {
  return { id, inspector: "hygiene", tier, appliesTo: () => true, run: async () => produce() };
}

describe("runner", () => {
  it("only runs checks matching the requested tier", async () => {
    const ran: string[] = [];
    const checks: Check[] = [
      check("commit-one", "commit", () => {
        ran.push("commit-one");
        return { status: "pass", issues: [], durationMs: 0 };
      }),
      check("push-one", "push", () => {
        ran.push("push-one");
        return { status: "pass", issues: [], durationMs: 0 };
      }),
    ];
    await runChecks(checks, files, ctx, resolveConfig({ profile: "standard" }), {
      tier: "commit",
      autofix: false,
    });
    expect(ran).toEqual(["commit-one"]);
  });

  it("reports blocked when an unfixable error exists", async () => {
    const checks: Check[] = [
      check("boom", "commit", () => ({
        status: "fail",
        durationMs: 0,
        issues: [
          {
            ruleId: "x/err",
            inspector: "hygiene",
            severity: "error",
            file: "a.ts",
            line: 1,
            problem: "p",
            why: "w",
            fix: { description: "f" },
          },
        ],
      })),
    ];
    // merge-markers is disabled implicitly since it's not in the list; use a custom check id
    const report = await runChecks(checks, files, ctx, resolveConfig({}), {
      tier: "commit",
      autofix: false,
    });
    expect(report.blocked).toBe(true);
    expect(report.issues.length).toBe(1);
  });

  it("applies safe autofixes and records fixed paths", async () => {
    let applied = false;
    const checks: Check[] = [
      check("fixme", "commit", () => ({
        status: "fixed",
        durationMs: 0,
        issues: [
          {
            ruleId: "x/fix",
            inspector: "format",
            severity: "error",
            file: "a.ts",
            line: 1,
            problem: "p",
            why: "w",
            fix: {
              description: "f",
              auto: {
                safe: true,
                description: "fix",
                apply: async () => {
                  applied = true;
                  return true;
                },
              },
            },
          },
        ],
      })),
    ];
    const report = await runChecks(checks, files, ctx, resolveConfig({}), {
      tier: "commit",
      autofix: true,
    });
    expect(applied).toBe(true);
    expect(report.fixedPaths).toEqual(["a.ts"]);
    // A safe-fixed error should not block, and drops out of `remaining`.
    expect(report.blocked).toBe(false);
    expect(report.remaining.length).toBe(0);
    expect(report.fixedIssues.size).toBe(1);
  });

  it("BLOCKS a fixable error when autofix is OFF (CI / check path)", async () => {
    // Regression: a fixable error must not pass just because a fix *exists* —
    // it only stops blocking once the fix has actually run.
    const fixableError = (): Awaited<ReturnType<Check["run"]>> => ({
      status: "fail",
      durationMs: 0,
      issues: [
        {
          ruleId: "format/prettier",
          inspector: "format",
          severity: "error",
          file: "a.ts",
          line: 1,
          problem: "unformatted",
          why: "w",
          fix: {
            description: "f",
            auto: { safe: true, description: "fmt", apply: async () => true },
          },
        },
      ],
    });
    const checks: Check[] = [check("fmt", "commit", fixableError)];

    const off = await runChecks(checks, files, ctx, resolveConfig({}), {
      tier: "commit",
      autofix: false,
    });
    expect(off.blocked).toBe(true); // not fixed => still blocks
    expect(off.remaining.length).toBe(1);
    expect(off.fixedIssues.size).toBe(0);

    const on = await runChecks(checks, files, ctx, resolveConfig({}), {
      tier: "commit",
      autofix: true,
    });
    expect(on.blocked).toBe(false); // fixed this run => allowed
  });

  it("still blocks when the safe fix reports no change", async () => {
    const checks: Check[] = [
      check("noop-fix", "commit", () => ({
        status: "fail",
        durationMs: 0,
        issues: [
          {
            ruleId: "x/err",
            inspector: "format",
            severity: "error",
            file: "a.ts",
            line: 1,
            problem: "p",
            why: "w",
            fix: {
              description: "f",
              auto: { safe: true, description: "fix", apply: async () => false },
            },
          },
        ],
      })),
    ];
    const report = await runChecks(checks, files, ctx, resolveConfig({}), {
      tier: "commit",
      autofix: true,
    });
    // apply() returned false => nothing fixed => still blocked.
    expect(report.blocked).toBe(true);
    expect(report.fixedIssues.size).toBe(0);
  });

  it("survives a check that throws", async () => {
    const checks: Check[] = [
      {
        id: "thrower",
        inspector: "hygiene",
        tier: "commit",
        appliesTo: () => true,
        run: async () => {
          throw new Error("kaboom");
        },
      },
    ];
    const report = await runChecks(checks, files, ctx, resolveConfig({}), {
      tier: "commit",
      autofix: false,
    });
    expect(report.runs[0]!.result.status).toBe("fail");
    expect(report.runs[0]!.result.note).toContain("kaboom");
  });
});
