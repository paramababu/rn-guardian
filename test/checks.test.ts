import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { mergeMarkersCheck } from "../src/core/checks/merge-markers.js";
import { consoleLogCheck } from "../src/core/checks/console-log.js";
import { secretsCheck } from "../src/plugins/react-native/checks/secrets.js";
import { largeAssetsCheck } from "../src/plugins/react-native/checks/large-assets.js";
import { makeStaged } from "./helpers.js";
import type { CheckConfig, ProjectContext } from "../src/types.js";

const ctx = {} as ProjectContext;
const cfg = (options: Record<string, unknown> = {}): CheckConfig => ({
  enabled: true,
  tier: "commit",
  options,
});

describe("merge-markers", () => {
  it("flags conflict markers at column 0", async () => {
    const { staged, cleanup } = makeStaged({
      "src/A.ts": "const a = 1;\n<<<<<<< HEAD\nconst b = 2;\n=======\nconst b = 3;\n>>>>>>> feat\n",
    });
    const res = await mergeMarkersCheck.run(staged, ctx, cfg());
    expect(res.status).toBe("fail");
    expect(res.issues.length).toBe(3); // <<<, ===, >>>
    expect(res.issues[0]!.severity).toBe("error");
    cleanup();
  });

  it("passes clean files", async () => {
    const { staged, cleanup } = makeStaged({ "src/A.ts": "const a = 1;\n" });
    const res = await mergeMarkersCheck.run(staged, ctx, cfg());
    expect(res.status).toBe("pass");
    cleanup();
  });
});

describe("console-log", () => {
  it("flags standalone console/debugger and offers a removal fix", async () => {
    const { staged, cleanup } = makeStaged({
      "src/A.ts": "foo();\nconsole.log('x');\ndebugger;\nbar();\n",
    });
    const res = await consoleLogCheck.run(staged, ctx, cfg());
    expect(res.issues.length).toBe(2);
    const withFix = res.issues.find((i) => i.fix.auto);
    expect(withFix?.fix.auto?.safe).toBe(false); // confirm-only
    cleanup();
  });

  it("autofix removes the lines idempotently", async () => {
    const { staged, cleanup } = makeStaged({
      "src/A.ts": "keep1();\nconsole.log('x');\nkeep2();\ndebugger;\n",
    });
    const res = await consoleLogCheck.run(staged, ctx, cfg());
    const fix = res.issues.find((i) => i.fix.auto)!.fix.auto!;
    const changed = await fix.apply();
    expect(changed).toBe(true);
    const after = fs.readFileSync(staged[0]!.absPath, "utf8");
    expect(after).toBe("keep1();\nkeep2();\n");
    // second apply is a no-op
    expect(await fix.apply()).toBe(false);
    cleanup();
  });

  it("does not flag console.log inside a larger expression", async () => {
    const { staged, cleanup } = makeStaged({
      "src/A.ts": "const x = something(console.log);\n",
    });
    const res = await consoleLogCheck.run(staged, ctx, cfg());
    expect(res.issues.length).toBe(0);
    cleanup();
  });
});

describe("rn-secrets", () => {
  it("flags a sensitive value in AsyncStorage", async () => {
    const { staged, cleanup } = makeStaged({
      "src/auth.ts": "await AsyncStorage.setItem('authToken', token);\n",
    });
    const res = await secretsCheck.run(staged, ctx, cfg());
    expect(res.status).toBe("fail");
    expect(res.issues[0]!.ruleId).toBe("security/no-token-in-asyncstorage");
    cleanup();
  });

  it("flags a hardcoded JWT", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123456";
    const { staged, cleanup } = makeStaged({
      "src/c.ts": `const t = "${jwt}";\n`,
    });
    const res = await secretsCheck.run(staged, ctx, cfg());
    expect(res.issues.some((i) => i.ruleId === "security/hardcoded-jwt")).toBe(true);
    cleanup();
  });

  it("warns on plaintext http url but not localhost", async () => {
    const { staged, cleanup } = makeStaged({
      "src/a.ts": 'fetch("http://api.example.com/x");\n',
      "src/b.ts": 'fetch("http://localhost:3000/x");\n',
    });
    const res = await secretsCheck.run(staged, ctx, cfg());
    const httpIssues = res.issues.filter((i) => i.ruleId === "security/no-http-url");
    expect(httpIssues.length).toBe(1);
    expect(httpIssues[0]!.file).toBe("src/a.ts");
    cleanup();
  });
});

describe("large-assets", () => {
  it("flags images over the KB limit", async () => {
    const { staged, cleanup } = makeStaged({
      "assets/big.png": "x".repeat(400 * 1024),
      "assets/small.png": "x".repeat(10 * 1024),
    });
    const res = await largeAssetsCheck.run(staged, ctx, cfg({ maxKb: 300 }));
    expect(res.issues.length).toBe(1);
    expect(res.issues[0]!.file).toBe("assets/big.png");
    cleanup();
  });
});
