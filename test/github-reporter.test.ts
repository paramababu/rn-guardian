import { describe, it, expect } from "vitest";
import {
  formatAnnotation,
  issueToAnnotation,
  renderStepSummary,
  type Annotation,
} from "../src/core/reporter/github.js";
import type { Issue } from "../src/types.js";

describe("github annotations", () => {
  it("formats a file-anchored annotation with escaped props", () => {
    const a: Annotation = {
      severity: "warning",
      file: "src/a.tsx",
      line: 12,
      column: 3,
      title: "performance/no-inline-style-object",
      message: "Inline style object literal.",
    };
    expect(formatAnnotation(a)).toBe(
      "::warning file=src/a.tsx,title=performance/no-inline-style-object,line=12,col=3::Inline style object literal.",
    );
  });

  it("escapes newlines in the message and commas/colons in props", () => {
    const a: Annotation = {
      severity: "error",
      file: "a,b:c.ts",
      line: 1,
      title: "x",
      message: "line one\nline two",
    };
    const out = formatAnnotation(a);
    expect(out).toContain("file=a%2Cb%3Ac.ts");
    expect(out).toContain("line one%0Aline two");
    expect(out).not.toContain("\n");
  });

  it("emits a job-level (fileless) annotation for a gate failure", () => {
    const a: Annotation = {
      severity: "error",
      title: "ci.maxWarnings",
      message: "12 warnings exceed the limit of 5.",
    };
    expect(formatAnnotation(a)).toBe(
      "::error title=ci.maxWarnings::12 warnings exceed the limit of 5.",
    );
  });

  it("maps an Issue to an annotation carrying problem + fix", () => {
    const issue: Issue = {
      ruleId: "hygiene/no-console",
      inspector: "hygiene",
      severity: "warning",
      file: "src/x.ts",
      line: 4,
      column: 2,
      problem: "console.log left in.",
      why: "noise",
      impact: "ships debug output",
      fix: { description: "remove it" },
    };
    const a = issueToAnnotation(issue);
    expect(a.title).toBe("hygiene/no-console");
    expect(a.file).toBe("src/x.ts");
    expect(a.severity).toBe("warning");
    expect(a.message).toContain("console.log left in.");
    expect(a.message).toContain("Fix: remove it");
  });

  it("renders a markdown step summary with a verdict and gate list", () => {
    const md = renderStepSummary({
      errors: 1,
      warnings: 2,
      fileCount: 10,
      durationMs: 42,
      blocked: true,
      gateFailures: ["**ci.maxWarnings** — too many"],
    });
    expect(md).toContain("## rn-guardian");
    expect(md).toContain("Failed");
    expect(md).toContain("| Errors | 1 |");
    expect(md).toContain("ci.maxWarnings");
  });
});
