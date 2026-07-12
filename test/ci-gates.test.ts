import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readGateConfig,
  evaluateGates,
  type GateEnv,
} from "../src/core/ci/gates.js";
import type { Issue, StagedFile } from "../src/types.js";
import { makeStaged } from "./helpers.js";

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

/** Env for gates that never touch the project. */
const noEnv: GateEnv = { packageRoot: "/nonexistent", files: [] };

describe("readGateConfig", () => {
  it("keeps valid fields and drops the rest", () => {
    expect(readGateConfig({ failOn: "warning", maxWarnings: 3, junk: 1 })).toEqual({
      failOn: "warning",
      maxWarnings: 3,
    });
  });

  it("ignores invalid values", () => {
    expect(
      readGateConfig({ failOn: "nope", maxWarnings: -2, coverage: 0, maxBundleMb: -1 }),
    ).toEqual({});
    expect(readGateConfig(undefined)).toEqual({});
  });

  it("normalizes the new gates", () => {
    expect(
      readGateConfig({
        coverage: 80,
        noAny: true,
        maxBundleMb: 5,
        bundlePath: "dist/app.js",
      }),
    ).toEqual({ coverage: 80, noAny: true, maxBundleMb: 5, bundlePath: "dist/app.js" });
    expect(readGateConfig({ coverage: { lines: 90, branches: 70, junk: 5 } })).toEqual({
      coverage: { lines: 90, branches: 70 },
    });
    expect(readGateConfig({ noAny: "yes" })).toEqual({});
  });
});

describe("evaluateGates: warning gates", () => {
  const warnings = [issue("warning"), issue("warning"), issue("warning")];

  it("does not block when no gate is configured", async () => {
    expect((await evaluateGates(warnings, {}, noEnv)).blocked).toBe(false);
  });

  it("blocks when failOn=warning and warnings remain", async () => {
    const res = await evaluateGates(warnings, { failOn: "warning" }, noEnv);
    expect(res.blocked).toBe(true);
    expect(res.failures[0]!.title).toBe("ci.failOn");
  });

  it("blocks when warnings exceed maxWarnings", async () => {
    const res = await evaluateGates(warnings, { maxWarnings: 2 }, noEnv);
    expect(res.blocked).toBe(true);
    expect(res.failures[0]!.title).toBe("ci.maxWarnings");
  });

  it("passes when warnings are within maxWarnings", async () => {
    expect((await evaluateGates(warnings, { maxWarnings: 5 }, noEnv)).blocked).toBe(false);
  });
});

describe("evaluateGates: ci.coverage", () => {
  function withSummary(total: Record<string, { pct: number }>): {
    env: GateEnv;
    cleanup: () => void;
  } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-guardian-cov-"));
    fs.mkdirSync(path.join(dir, "coverage"));
    fs.writeFileSync(
      path.join(dir, "coverage", "coverage-summary.json"),
      JSON.stringify({ total }),
    );
    return {
      env: { packageRoot: dir, files: [] },
      cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    };
  }

  it("fails with guidance when the summary file is missing", async () => {
    const res = await evaluateGates([], { coverage: 80 }, noEnv);
    expect(res.blocked).toBe(true);
    expect(res.failures[0]!.title).toBe("ci.coverage");
    expect(res.failures[0]!.message).toContain("coverage-summary.json");
    expect(res.failures[0]!.message).toContain("json-summary");
  });

  it("passes when overall lines meet a numeric threshold", async () => {
    const { env, cleanup } = withSummary({ lines: { pct: 85.2 } });
    try {
      expect((await evaluateGates([], { coverage: 80 }, env)).blocked).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("fails and names each metric below its threshold", async () => {
    const { env, cleanup } = withSummary({
      lines: { pct: 91 },
      branches: { pct: 60 },
      functions: { pct: 50 },
    });
    try {
      const res = await evaluateGates(
        [],
        { coverage: { lines: 90, branches: 75, functions: 40 } },
        env,
      );
      expect(res.blocked).toBe(true);
      expect(res.failures[0]!.message).toContain("branches: 60% < 75%");
      expect(res.failures[0]!.message).not.toContain("lines");
      expect(res.failures[0]!.message).not.toContain("functions");
    } finally {
      cleanup();
    }
  });
});

describe("evaluateGates: ci.noAny", () => {
  /** Temp project where `typescript` resolves (symlinked node_modules). */
  function tsProject(files: Record<string, string>): {
    env: GateEnv;
    cleanup: () => void;
  } {
    const { dir, staged, cleanup } = makeStaged(files);
    fs.symlinkSync(
      path.join(process.cwd(), "node_modules"),
      path.join(dir, "node_modules"),
      "dir",
    );
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "tmp" }));
    return { env: { packageRoot: dir, files: staged }, cleanup };
  }

  it("passes on files without any", async () => {
    const { env, cleanup } = tsProject({
      "clean.ts": "export const n: number = 1;\nconst s = 'any'; // any in a string/comment\nexport default s;\n",
    });
    try {
      expect((await evaluateGates([], { noAny: true }, env)).blocked).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("fails with file:line locations for explicit any", async () => {
    const { env, cleanup } = tsProject({
      "bad.ts": "export function f(x: any): void {}\n",
      "cast.tsx": "export const v = (1 as any) + 1;\n",
    });
    try {
      const res = await evaluateGates([], { noAny: true }, env);
      expect(res.blocked).toBe(true);
      expect(res.failures[0]!.title).toBe("ci.noAny");
      expect(res.failures[0]!.message).toContain("bad.ts:1");
      expect(res.failures[0]!.message).toContain("cast.tsx:1");
    } finally {
      cleanup();
    }
  });

  it("skips .d.ts files and non-TS files", async () => {
    const { env, cleanup } = tsProject({
      "types.d.ts": "declare const x: any;\n",
      "plain.js": "// any\n",
    });
    try {
      expect((await evaluateGates([], { noAny: true }, env)).blocked).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("fails with guidance when typescript is not resolvable", async () => {
    const { dir, staged, cleanup } = makeStaged({ "a.ts": "const x: any = 1;\n" });
    try {
      const res = await evaluateGates(
        [],
        { noAny: true },
        { packageRoot: dir, files: staged },
      );
      expect(res.blocked).toBe(true);
      expect(res.failures[0]!.message).toContain("typescript is not resolvable");
    } finally {
      cleanup();
    }
  });
});

describe("evaluateGates: ci.maxBundleMb", () => {
  function project(files: Record<string, string>): {
    env: GateEnv;
    cleanup: () => void;
  } {
    const { dir, cleanup } = makeStaged(files);
    return { env: { packageRoot: dir, files: [] }, cleanup };
  }

  it("fails with guidance when no artifact exists", async () => {
    const { env, cleanup } = project({});
    try {
      const res = await evaluateGates([], { maxBundleMb: 5 }, env);
      expect(res.blocked).toBe(true);
      expect(res.failures[0]!.title).toBe("ci.maxBundleMb");
      expect(res.failures[0]!.message).toContain("expo export");
    } finally {
      cleanup();
    }
  });

  it("passes when the auto-detected bundle is under the limit", async () => {
    const { env, cleanup } = project({
      "ios/main.jsbundle": "x".repeat(1024),
    });
    try {
      expect((await evaluateGates([], { maxBundleMb: 1 }, env)).blocked).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("fails when the bundle at ci.bundlePath is over the limit", async () => {
    const { env, cleanup } = project({
      "build/app.js": "x".repeat(2 * 1024 * 1024),
    });
    try {
      const res = await evaluateGates(
        [],
        { maxBundleMb: 1, bundlePath: "build/app.js" },
        env,
      );
      expect(res.blocked).toBe(true);
      expect(res.failures[0]!.message).toContain("2.00 MB");
      expect(res.failures[0]!.message).toContain("1 MB limit");
    } finally {
      cleanup();
    }
  });

  it("sums bundle files in a directory, ignoring source maps", async () => {
    const { env, cleanup } = project({
      "dist/_expo/static/js/a.hbc": "x".repeat(600 * 1024),
      "dist/_expo/static/js/b.js": "x".repeat(600 * 1024),
      "dist/_expo/static/js/a.hbc.map": "x".repeat(5 * 1024 * 1024),
    });
    try {
      const over = await evaluateGates([], { maxBundleMb: 1 }, env);
      expect(over.blocked).toBe(true); // 1.17 MB of real bundle > 1 MB
      const under = await evaluateGates([], { maxBundleMb: 2 }, env);
      expect(under.blocked).toBe(false); // maps' 5 MB were ignored
    } finally {
      cleanup();
    }
  });
});
