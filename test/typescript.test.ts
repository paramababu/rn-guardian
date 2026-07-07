import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { typescriptCheck } from "../src/core/checks/typescript.js";
import { detectProject } from "../src/core/project/detect.js";
import type { CheckConfig, ProjectContext, StagedFile } from "../src/types.js";

const cfg: CheckConfig = { enabled: true, tier: "commit", options: {} };

/**
 * Build a throwaway TS project. `typescript` is resolved from the target
 * project's node_modules (resolve-local.ts), so we symlink this repo's
 * node_modules into the temp dir rather than reinstalling.
 */
function makeTsProject(files: Record<string, string>): {
  dir: string;
  staged(...rels: string[]): StagedFile[];
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-guardian-ts-"));
  fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "tmp" }));
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, module: "esnext", target: "es2020" },
      include: ["*.ts"],
    }),
  );
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return {
    dir,
    staged: (...rels) =>
      rels.map((rel) => ({
        path: rel,
        absPath: path.join(dir, rel),
        status: "M" as const,
        partiallyStaged: false,
      })),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe("typescript", () => {
  let project: ReturnType<typeof makeTsProject>;
  let ctx: ProjectContext;

  beforeAll(async () => {
    project = makeTsProject({
      "good.ts": "export const n: number = 1;\n",
      "bad.ts": "export const s: string = 42;\n",
    });
    ctx = await detectProject(project.dir);
  });
  afterAll(() => project.cleanup());

  it("passes a clean staged file", async () => {
    const res = await typescriptCheck.run(project.staged("good.ts"), ctx, cfg);
    expect(res.status).toBe("pass");
    expect(res.issues).toHaveLength(0);
  });

  it("fails on a type error in a staged file", async () => {
    const res = await typescriptCheck.run(project.staged("bad.ts"), ctx, cfg);
    expect(res.status).toBe("fail");
    expect(res.issues[0]!.severity).toBe("error");
    expect(res.issues[0]!.file).toBe("bad.ts");
    expect(res.issues[0]!.ruleId).toMatch(/^ts\/TS\d+$/);
    expect(res.issues[0]!.line).toBeGreaterThan(0);
  });

  it("does not report errors in files that are not staged", async () => {
    // bad.ts has an error but only good.ts is staged → nothing to report.
    const res = await typescriptCheck.run(project.staged("good.ts"), ctx, cfg);
    expect(res.issues).toHaveLength(0);
  });

  it("skips when the project has no staged source files", async () => {
    const res = await typescriptCheck.run([], ctx, cfg);
    expect(res.status).toBe("pass");
    expect(res.issues).toHaveLength(0);
  });

  it("only applies when the project uses TypeScript", () => {
    expect(typescriptCheck.appliesTo(ctx)).toBe(true);
    expect(typescriptCheck.appliesTo({ ...ctx, hasTypeScript: false })).toBe(false);
  });

  it("writes an incremental .tsbuildinfo cache", async () => {
    await typescriptCheck.run(project.staged("good.ts"), ctx, cfg);
    const info = path.join(
      project.dir,
      "node_modules/.cache/rn-guardian/typecheck.tsbuildinfo",
    );
    expect(fs.existsSync(info)).toBe(true);
  });
});
