import { describe, it, expect } from "vitest";
import { toHtml } from "../src/core/reporter/html.js";
import type { RunReport } from "../src/core/runner/runner.js";
import type { Check, Issue } from "../src/types.js";

const check: Check = {
  id: "console-log",
  inspector: "hygiene",
  tier: "commit",
  appliesTo: () => true,
  run: async () => ({ status: "pass", issues: [], durationMs: 0 }),
};

function fakeReport(issues: Issue[]): RunReport {
  return {
    tier: "ci",
    files: [],
    runs: [
      {
        check,
        result: { status: issues.length ? "warn" : "pass", issues, durationMs: 12 },
      },
    ],
    fixedPaths: [],
    fixedIssues: new Set(),
    totalDurationMs: 34,
    get issues() {
      return issues;
    },
    get remaining() {
      return issues;
    },
    get blocked() {
      return issues.some((i) => i.severity === "error");
    },
  };
}

const meta = {
  profile: "standard",
  scope: "changed vs origin/main",
  generatedAt: new Date("2026-07-12T00:00:00Z"),
};

describe("toHtml", () => {
  it("renders a passing report with meta, tiles and check table", () => {
    const html = toHtml(fakeReport([]), { blocked: false, failures: [] }, meta);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("passed");
    expect(html).toContain("standard");
    expect(html).toContain("changed vs origin/main");
    expect(html).toContain("console-log");
    expect(html).toContain("No remaining issues");
    // Self-contained: no external references.
    expect(html).not.toMatch(/src=|href="http(?!s?:\/\/[^"]*docs)/);
  });

  it("renders issues with the five-part shape and escapes HTML", () => {
    const issue: Issue = {
      ruleId: "hygiene/no-console",
      inspector: "hygiene",
      severity: "error",
      file: "src/<evil>.tsx",
      line: 3,
      column: 5,
      problem: 'console.log("<script>alert(1)</script>")',
      why: "Ships debug output & noise",
      impact: "Logs leak to release builds",
      fix: { description: "Remove it" },
      docsUrl: "https://example.com/docs?a=1&b=2",
    };
    const html = toHtml(
      fakeReport([issue]),
      {
        blocked: true,
        failures: [{ title: "ci.noAny", message: "2 explicit `any` <types>" }],
      },
      meta,
    );
    expect(html).toContain("blocked");
    expect(html).toContain("ci.noAny");
    // Escaped, never raw.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("src/&lt;evil&gt;.tsx:3:5");
    expect(html).toContain("2 explicit `any` &lt;types&gt;");
    // Five parts present.
    expect(html).toContain("Why:");
    expect(html).toContain("Impact:");
    expect(html).toContain("Fix:");
    expect(html).toContain("https://example.com/docs?a=1&amp;b=2");
  });

  it("clamps runaway issue text so one generated file can't bloat the report", () => {
    const issue: Issue = {
      ruleId: "lint/no-unused-expressions",
      inspector: "lint",
      severity: "error",
      file: "build/app.js",
      line: 1,
      problem: "x".repeat(3 * 1024 * 1024),
      why: "w",
      fix: { description: "f" },
    };
    const html = toHtml(fakeReport([issue]), { blocked: true, failures: [] }, meta);
    expect(html.length).toBeLessThan(50_000);
    expect(html).toContain("…");
  });
});
