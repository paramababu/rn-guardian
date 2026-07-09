import { describe, it, expect } from "vitest";
import { readGateConfig, evaluateGates } from "../src/core/ci/gates.js";
import type { Issue } from "../src/types.js";

function issue(severity: "error" | "warning"): Issue {
  return {
    ruleId: "r",
    inspector: "hygiene",
    severity,
    file: "a.ts",
    line: 1,
    problem: "p",
    why: "w",
    fix: { description: "f" },
  };
}

describe("readGateConfig", () => {
  it("keeps valid fields and drops the rest", () => {
    expect(readGateConfig({ failOn: "warning", maxWarnings: 3, junk: 1 })).toEqual({
      failOn: "warning",
      maxWarnings: 3,
    });
  });

  it("ignores invalid values", () => {
    expect(readGateConfig({ failOn: "nope", maxWarnings: -2 })).toEqual({});
    expect(readGateConfig(undefined)).toEqual({});
  });
});

describe("evaluateGates", () => {
  const warnings = [issue("warning"), issue("warning"), issue("warning")];

  it("does not block when no gate is configured", () => {
    expect(evaluateGates(warnings, {}).blocked).toBe(false);
  });

  it("blocks when failOn=warning and warnings remain", () => {
    const res = evaluateGates(warnings, { failOn: "warning" });
    expect(res.blocked).toBe(true);
    expect(res.failures[0]!.title).toBe("ci.failOn");
  });

  it("blocks when warnings exceed maxWarnings", () => {
    const res = evaluateGates(warnings, { maxWarnings: 2 });
    expect(res.blocked).toBe(true);
    expect(res.failures[0]!.title).toBe("ci.maxWarnings");
  });

  it("passes when warnings are within maxWarnings", () => {
    expect(evaluateGates(warnings, { maxWarnings: 5 }).blocked).toBe(false);
  });
});
