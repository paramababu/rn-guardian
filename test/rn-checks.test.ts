import { describe, it, expect } from "vitest";
import { performanceCheck } from "../src/plugins/react-native/checks/performance.js";
import { accessibilityCheck } from "../src/plugins/react-native/checks/accessibility.js";
import { makeStaged } from "./helpers.js";
import type { CheckConfig, ProjectContext } from "../src/types.js";

const rnCtx = { framework: { id: "react-native" } } as ProjectContext;
const cfg: CheckConfig = { enabled: true, tier: "commit", options: {} };

function ids(issues: { ruleId: string }[]): string[] {
  return issues.map((i) => i.ruleId);
}

describe("rn-performance", () => {
  it("flags FlatList without keyExtractor, inline styles, and anon renderItem", async () => {
    const { staged, cleanup } = makeStaged({
      "src/List.tsx": `import { FlatList } from "react-native";
export const L = () => (
  <FlatList
    data={items}
    style={{ flex: 1 }}
    renderItem={({ item }) => <Row item={item} />}
  />
);`,
    });
    const res = await performanceCheck.run(staged, rnCtx, cfg);
    const found = ids(res.issues);
    expect(found).toContain("performance/flatlist-key-extractor");
    expect(found).toContain("performance/no-inline-style-object");
    expect(found).toContain("performance/no-anonymous-render-callback");
    cleanup();
  });

  it("is clean when the list is written well", async () => {
    const { staged, cleanup } = makeStaged({
      "src/Good.tsx": `import { FlatList } from "react-native";
export const L = () => (
  <FlatList data={items} keyExtractor={(i) => i.id} renderItem={renderRow} />
);`,
    });
    const res = await performanceCheck.run(staged, rnCtx, cfg);
    expect(res.issues.length).toBe(0);
    expect(res.status).toBe("pass");
    cleanup();
  });

  it("does not scan plain .ts files for JSX", async () => {
    const { staged, cleanup } = makeStaged({
      "src/util.ts": `const style = {{ not: 'jsx' }};`,
    });
    const res = await performanceCheck.run(staged, rnCtx, cfg);
    expect(res.issues.length).toBe(0);
    cleanup();
  });

  it("skips a .tsx file that never imports react-native", async () => {
    // A web/React component with the same shape must not trip RN heuristics.
    const { staged, cleanup } = makeStaged({
      "src/Web.tsx": `export const L = () => (
  <FlatList data={items} style={{ flex: 1 }} renderItem={({ item }) => <Row />} />
);`,
    });
    const res = await performanceCheck.run(staged, rnCtx, cfg);
    expect(res.issues.length).toBe(0);
    cleanup();
  });
});

describe("rn-accessibility", () => {
  it("flags a touchable and an image with no label", async () => {
    const { staged, cleanup } = makeStaged({
      "src/Btn.tsx": `import { TouchableOpacity, Image } from "react-native";
export const B = () => (
  <>
    <TouchableOpacity onPress={f}><Icon /></TouchableOpacity>
    <Image source={pic} />
  </>
);`,
    });
    const res = await accessibilityCheck.run(staged, rnCtx, cfg);
    const found = ids(res.issues);
    expect(found).toContain("accessibility/touchable-accessibility-label");
    expect(found).toContain("accessibility/image-accessibility");
    cleanup();
  });

  it("respects labels and explicit opt-out", async () => {
    const { staged, cleanup } = makeStaged({
      "src/Ok.tsx": `import { TouchableOpacity, Image } from "react-native";
export const B = () => (
  <>
    <TouchableOpacity accessibilityLabel="Save" onPress={f}><Icon /></TouchableOpacity>
    <Image source={pic} accessible={false} />
  </>
);`,
    });
    const res = await accessibilityCheck.run(staged, rnCtx, cfg);
    expect(res.issues.length).toBe(0);
    cleanup();
  });

  it("treats a touchable with a <Text> child as labeled", async () => {
    const { staged, cleanup } = makeStaged({
      "src/Save.tsx": `import { TouchableOpacity, Text } from "react-native";
export const B = () => (
  <TouchableOpacity onPress={f}><Text>Save</Text></TouchableOpacity>
);`,
    });
    const res = await accessibilityCheck.run(staged, rnCtx, cfg);
    expect(ids(res.issues)).not.toContain("accessibility/touchable-accessibility-label");
    cleanup();
  });

  it("skips a .tsx file that never imports react-native", async () => {
    const { staged, cleanup } = makeStaged({
      "src/Web.tsx": `export const B = () => <TouchableOpacity onPress={f}><Icon /></TouchableOpacity>;`,
    });
    const res = await accessibilityCheck.run(staged, rnCtx, cfg);
    expect(res.issues.length).toBe(0);
    cleanup();
  });
});

describe("appliesTo gating", () => {
  it("performance check does not apply to non-RN projects", () => {
    expect(performanceCheck.appliesTo({} as ProjectContext)).toBe(false);
    expect(accessibilityCheck.appliesTo(rnCtx)).toBe(true);
  });
});
