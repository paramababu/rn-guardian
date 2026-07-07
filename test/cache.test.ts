import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeLastRun, readLastRun } from "../src/core/cache.js";
import type { Issue } from "../src/types.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rn-guardian-cache-"));
}

const issue: Issue = {
  ruleId: "x/err",
  inspector: "hygiene",
  severity: "error",
  file: "src/a.ts",
  line: 3,
  problem: "p",
  why: "w",
  fix: {
    description: "f",
    auto: { safe: true, description: "fix", apply: async () => true },
  },
};

describe("last-run cache", () => {
  it("round-trips a report and creates the cache dir", () => {
    const dir = tmp();
    writeLastRun(dir, { tier: "commit", fileCount: 2, blocked: true, issues: [issue] });

    const back = readLastRun(dir);
    expect(back).not.toBeNull();
    expect(back!.tier).toBe("commit");
    expect(back!.fileCount).toBe(2);
    expect(back!.blocked).toBe(true);
    expect(back!.issues[0]!.problem).toBe("p");
    // The autofix function is not serializable and must drop out cleanly.
    expect(back!.issues[0]!.fix.auto).toBeUndefined();
    expect(back!.issues[0]!.fix.description).toBe("f");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when there is no cache", () => {
    expect(readLastRun(tmp())).toBeNull();
  });

  it("rejects a cache with a mismatched version", () => {
    const dir = tmp();
    writeLastRun(dir, { tier: "commit", fileCount: 1, blocked: false, issues: [] });
    const p = path.join(dir, "node_modules", ".cache", "rn-guardian", "last-run.json");
    const bumped = { ...JSON.parse(fs.readFileSync(p, "utf8")), version: 999 };
    fs.writeFileSync(p, JSON.stringify(bumped));
    expect(readLastRun(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("never throws when the target path is unwritable", () => {
    // A path whose parent is a file, not a dir — mkdir will fail; must be swallowed.
    const dir = tmp();
    const asFile = path.join(dir, "node_modules");
    fs.writeFileSync(asFile, "not a dir");
    expect(() =>
      writeLastRun(dir, { tier: "commit", fileCount: 0, blocked: false, issues: [] }),
    ).not.toThrow();
    expect(readLastRun(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
