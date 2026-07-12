import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ciCommand } from "../src/commands/ci.js";

/** Run git in the repo, quietly. */
function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

/** Capture everything written to stdout while `fn` runs. */
async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  let out = "";
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
  try {
    const code = await fn();
    return { code, out };
  } finally {
    spy.mockRestore();
  }
}

describe("rn-guardian ci (end-to-end on a temp git repo)", () => {
  let repo: string;

  beforeAll(() => {
    // `ci` auto-enables annotations + step summary inside GitHub Actions
    // (inGithubActions()), which would prepend `::warning …` lines to the
    // captured stdout and break JSON.parse — as it did when this suite itself
    // ran in Actions. Pin the env so the tests behave the same everywhere.
    vi.stubEnv("GITHUB_ACTIONS", "");
    vi.stubEnv("GITHUB_STEP_SUMMARY", "");

    repo = fs.mkdtempSync(path.join(os.tmpdir(), "rn-guardian-ci-"));
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t.dev");
    git(repo, "config", "user.name", "T");
    git(repo, "config", "commit.gpgsign", "false");
    git(repo, "checkout", "-q", "-b", "main");
    fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "t" }));
    fs.writeFileSync(path.join(repo, "a.js"), "export const a = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");

    // Feature branch introduces one warning-level issue (a console.log).
    git(repo, "checkout", "-q", "-b", "feature");
    fs.writeFileSync(path.join(repo, "b.js"), "console.log('hi');\nexport const b = 2;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "feat");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("scopes to the PR diff and reports the introduced warning", async () => {
    const { code, out } = await capture(() =>
      ciCommand({ cwd: repo, base: "main", all: false, json: true, annotate: false }),
    );
    const json = JSON.parse(out);
    expect(json.scope).toBe("changed vs main");
    expect(json.fileCount).toBe(1); // only b.js is in the diff
    const ids = json.issues.map((i: { ruleId: string }) => i.ruleId);
    expect(ids).toContain("hygiene/no-console");
    // A lone warning does not block by default.
    expect(json.blocked).toBe(false);
    expect(code).toBe(0);
  });

  it("emits GitHub annotations when asked", async () => {
    const { out } = await capture(() =>
      ciCommand({ cwd: repo, base: "main", all: false, json: false, annotate: true }),
    );
    expect(out).toContain("::warning ");
    expect(out).toContain("hygiene/no-console");
  });

  it("fails the build when a team-rule gate trips", async () => {
    fs.writeFileSync(
      path.join(repo, "guardian.config.json"),
      JSON.stringify({ ci: { maxWarnings: 0 } }),
    );
    try {
      const { code, out } = await capture(() =>
        ciCommand({ cwd: repo, base: "main", all: false, json: true, annotate: false }),
      );
      const json = JSON.parse(out);
      expect(json.gates.blocked).toBe(true);
      expect(json.gates.failures[0].title).toBe("ci.maxWarnings");
      expect(code).toBe(1);
    } finally {
      fs.rmSync(path.join(repo, "guardian.config.json"));
    }
  });

  it("--all scans every tracked source file", async () => {
    const { out } = await capture(() =>
      ciCommand({ cwd: repo, all: true, json: true, annotate: false }),
    );
    const json = JSON.parse(out);
    expect(json.scope).toBe("all tracked files");
    expect(json.fileCount).toBe(2); // a.js + b.js
  });
});
