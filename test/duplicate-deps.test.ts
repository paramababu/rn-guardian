import { describe, it, expect } from "vitest";
import { duplicateDepsCheck } from "../src/core/checks/duplicate-deps.js";
import { makeStaged } from "./helpers.js";
import type { CheckConfig, ProjectContext } from "../src/types.js";

const cfg: CheckConfig = { enabled: true, tier: "push", options: {} };
const ctxFor = (dir: string) => ({ packageRoot: dir }) as ProjectContext;

describe("duplicate-deps", () => {
  it("flags a package resolved to two versions in package-lock v3", async () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "app" },
        "node_modules/lodash": { version: "4.17.21" },
        "node_modules/foo": { version: "1.0.0" },
        "node_modules/foo/node_modules/lodash": { version: "3.10.1" },
      },
    });
    const { staged, dir, cleanup } = makeStaged({ "package-lock.json": lock });
    const res = await duplicateDepsCheck.run(staged, ctxFor(dir), cfg);
    expect(res.status).toBe("warn");
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0]!.ruleId).toBe("dependency/duplicate-version");
    expect(res.issues[0]!.problem).toContain("lodash");
    expect(res.issues[0]!.problem).toContain("3.10.1");
    expect(res.issues[0]!.problem).toContain("4.17.21");
    cleanup();
  });

  it("passes when every package has a single version", async () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "app" },
        "node_modules/lodash": { version: "4.17.21" },
        "node_modules/react": { version: "18.2.0" },
      },
    });
    const { staged, dir, cleanup } = makeStaged({ "package-lock.json": lock });
    const res = await duplicateDepsCheck.run(staged, ctxFor(dir), cfg);
    expect(res.status).toBe("pass");
    expect(res.issues).toHaveLength(0);
    cleanup();
  });

  it("parses a classic yarn.lock with duplicate versions", async () => {
    const yarn = `# yarn lockfile v1

"@babel/core@^7.0.0":
  version "7.20.0"

lodash@^4.0.0:
  version "4.17.21"

lodash@^3.0.0:
  version "3.10.1"
`;
    const { staged, dir, cleanup } = makeStaged({ "yarn.lock": yarn });
    const res = await duplicateDepsCheck.run(staged, ctxFor(dir), cfg);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0]!.problem).toContain("lodash");
    cleanup();
  });

  it("does not run when no dependency file is staged", async () => {
    // A lockfile exists on disk, but the staged change is unrelated source.
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/lodash": { version: "4.17.21" },
        "node_modules/foo/node_modules/lodash": { version: "3.10.1" },
      },
    });
    const { staged, dir, cleanup } = makeStaged({
      "package-lock.json": lock,
      "src/app.ts": "export const x = 1;\n",
    });
    // Simulate only the source file being staged this push.
    const onlySrc = staged.filter((f) => f.path === "src/app.ts");
    const res = await duplicateDepsCheck.run(onlySrc, ctxFor(dir), cfg);
    expect(res.status).toBe("pass");
    expect(res.issues).toHaveLength(0);
    cleanup();
  });

  it("skips with a note when only a pnpm lock is present", async () => {
    const { staged, dir, cleanup } = makeStaged({
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    const res = await duplicateDepsCheck.run(staged, ctxFor(dir), cfg);
    expect(res.status).toBe("skipped");
    expect(res.note).toContain("pnpm");
    cleanup();
  });
});
