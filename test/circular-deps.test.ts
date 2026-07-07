import { describe, it, expect } from "vitest";
import { circularDepsCheck } from "../src/core/checks/circular-deps.js";
import { makeStaged } from "./helpers.js";
import type { CheckConfig, ProjectContext } from "../src/types.js";

const cfg: CheckConfig = { enabled: true, tier: "push", options: {} };
const ctxFor = (dir: string) => ({ gitRoot: dir }) as ProjectContext;

describe("circular-deps", () => {
  it("detects a two-file relative-import cycle", async () => {
    const { staged, dir, cleanup } = makeStaged({
      "src/a.ts": `import { b } from "./b";\nexport const a = () => b;\n`,
      "src/b.ts": `import { a } from "./a";\nexport const b = () => a;\n`,
    });
    const res = await circularDepsCheck.run(staged, ctxFor(dir), cfg);
    expect(res.status).toBe("warn");
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0]!.ruleId).toBe("hygiene/circular-import");
    expect(res.issues[0]!.problem).toMatch(/a\.ts → b\.ts → a\.ts/);
    cleanup();
  });

  it("passes an acyclic graph", async () => {
    const { staged, dir, cleanup } = makeStaged({
      "src/a.ts": `import { b } from "./b";\nexport const a = () => b;\n`,
      "src/b.ts": `export const b = 1;\n`,
    });
    const res = await circularDepsCheck.run(staged, ctxFor(dir), cfg);
    expect(res.status).toBe("pass");
    expect(res.issues).toHaveLength(0);
    cleanup();
  });

  it("resolves index files and finds a three-file cycle", async () => {
    const { staged, dir, cleanup } = makeStaged({
      "src/a.ts": `import "./b";\n`,
      "src/b/index.ts": `import "../c";\n`,
      "src/c.ts": `import "./a";\n`,
    });
    const res = await circularDepsCheck.run(staged, ctxFor(dir), cfg);
    expect(res.issues).toHaveLength(1);
    cleanup();
  });

  it("dedupes the same cycle reached from multiple entries", async () => {
    const { staged, dir, cleanup } = makeStaged({
      "src/a.ts": `import "./b";\n`,
      "src/b.ts": `import "./a";\n`,
    });
    // Both files are staged → the A↔B cycle is reachable from each, but reported once.
    const res = await circularDepsCheck.run(staged, ctxFor(dir), cfg);
    expect(res.issues).toHaveLength(1);
    cleanup();
  });

  it("ignores unresolvable bare (node_modules) imports", async () => {
    const { staged, dir, cleanup } = makeStaged({
      "src/a.ts": `import React from "react";\nimport "./b";\n`,
      "src/b.ts": `export const b = 1;\n`,
    });
    const res = await circularDepsCheck.run(staged, ctxFor(dir), cfg);
    expect(res.status).toBe("pass");
    cleanup();
  });
});
