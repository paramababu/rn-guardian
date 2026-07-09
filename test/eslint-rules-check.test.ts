import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  eslintRulesCheck,
  astRulesAvailable,
} from "../src/plugins/react-native/checks/eslint-rules.js";
import { performanceCheck } from "../src/plugins/react-native/checks/performance.js";
import { accessibilityCheck } from "../src/plugins/react-native/checks/accessibility.js";
import type { CheckConfig, ProjectContext, StagedFile } from "../src/types.js";

// The check resolves ESLint + the parser from ctx.packageRoot and matches its
// `files` globs relative to that cwd, so the fixtures must live *inside* the repo
// (where eslint is a devDependency), not in the OS temp dir.
const repoRoot = process.cwd();
const dir = fs.mkdtempSync(path.join(repoRoot, "tmp-eslint-rules-"));

function stage(files: Record<string, string>): StagedFile[] {
  const staged: StagedFile[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    staged.push({
      path: path.relative(repoRoot, abs),
      absPath: abs,
      status: "M",
      partiallyStaged: false,
    });
  }
  return staged;
}

const ctx = {
  gitRoot: repoRoot,
  packageRoot: repoRoot,
  hasTypeScript: true,
  packageManager: "npm",
  eslint: { installed: true, major: 9 },
  prettierInstalled: false,
  hookManager: "none",
  framework: { id: "react-native", astRules: true },
} as ProjectContext;

const cfg: CheckConfig = { enabled: true, tier: "commit", options: {} };

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("rn-eslint-rules check (real ESLint injection)", () => {
  it("reports AST-grade issues with full five-part metadata", async () => {
    const staged = stage({
      "Bad.tsx": `import { FlatList, TouchableOpacity, Image, View } from "react-native";
export const Screen = () => (
  <View>
    <FlatList data={items} style={{ flex: 1 }} renderItem={({ item }: { item: any }) => <Row item={item} />} />
    <TouchableOpacity onPress={f}><Icon /></TouchableOpacity>
    <Image source={pic} />
  </View>
);`,
    });

    const res = await eslintRulesCheck.run(staged, ctx, cfg);
    const ids = res.issues.map((i) => i.ruleId);

    expect(ids).toContain("performance/flatlist-key-extractor");
    expect(ids).toContain("performance/no-inline-style-object");
    expect(ids).toContain("performance/no-anonymous-render-callback");
    expect(ids).toContain("accessibility/touchable-accessibility-label");
    expect(ids).toContain("accessibility/image-accessibility");
    expect(res.status).toBe("warn");

    // Every issue keeps the explainable shape (problem → why → impact → fix).
    for (const issue of res.issues) {
      expect(issue.problem.length).toBeGreaterThan(0);
      expect(issue.why.length).toBeGreaterThan(0);
      expect(issue.fix.description.length).toBeGreaterThan(0);
      expect(issue.severity).toBe("warning");
      expect(issue.line).toBeGreaterThan(0);
    }
  });

  it("catches a nested FlatList inside a ScrollView (new AST-only rule)", async () => {
    const staged = stage({
      "Nested.tsx": `import { ScrollView, FlatList } from "react-native";
export const S = () => (
  <ScrollView>
    <FlatList data={items} keyExtractor={(i: any) => i.id} renderItem={renderRow} />
  </ScrollView>
);`,
    });
    const res = await eslintRulesCheck.run(staged, ctx, cfg);
    expect(res.issues.map((i) => i.ruleId)).toContain(
      "performance/no-nested-scrollview",
    );
  });

  it("is clean on well-written TSX", async () => {
    const staged = stage({
      "Good.tsx": `import { FlatList } from "react-native";
const renderRow = ({ item }: { item: any }) => <Row item={item} />;
export const L = () => (
  <FlatList data={items} keyExtractor={(i: any) => i.id} renderItem={renderRow} />
);`,
    });
    const res = await eslintRulesCheck.run(staged, ctx, cfg);
    expect(res.issues.length).toBe(0);
    expect(res.status).toBe("pass");
  });

  it("skips files that never import react-native", async () => {
    const staged = stage({
      "Web.tsx": `export const L = () => <FlatList data={items} style={{ flex: 1 }} />;`,
    });
    const res = await eslintRulesCheck.run(staged, ctx, cfg);
    expect(res.issues.length).toBe(0);
  });
});

describe("astRulesAvailable + heuristic deferral", () => {
  it("detects the AST pack is available (eslint + parser installed here)", () => {
    expect(astRulesAvailable(ctx)).toBe(true);
  });

  it("heuristic checks defer when astRules is set, AST check activates", () => {
    expect(eslintRulesCheck.appliesTo(ctx)).toBe(true);
    expect(performanceCheck.appliesTo(ctx)).toBe(false);
    expect(accessibilityCheck.appliesTo(ctx)).toBe(false);
  });

  it("heuristics still run when the AST pack is unavailable", () => {
    const noAst = {
      framework: { id: "react-native", astRules: false },
    } as ProjectContext;
    expect(performanceCheck.appliesTo(noAst)).toBe(true);
    expect(accessibilityCheck.appliesTo(noAst)).toBe(true);
    expect(eslintRulesCheck.appliesTo(noAst)).toBe(false);
  });
});
