import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { navigationCheck } from "../src/plugins/react-native/checks/navigation.js";
import type {
  CheckConfig,
  ProjectContext,
  StagedFile,
} from "../src/types.js";

const cfg: CheckConfig = { enabled: true, tier: "push", options: {} };

/**
 * A throwaway RN project with @react-navigation deps and this repo's
 * node_modules symlinked in (so the project's `typescript` resolves — the same
 * trick typescript.test.ts uses).
 */
function makeNavProject(files: Record<string, string>): {
  dir: string;
  ctx: ProjectContext;
  staged(...rels: string[]): StagedFile[];
  all(): StagedFile[];
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-guardian-nav-"));
  fs.symlinkSync(
    path.join(process.cwd(), "node_modules"),
    path.join(dir, "node_modules"),
    "dir",
  );
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "tmp",
      dependencies: {
        "react-native": "0.74.0",
        "@react-navigation/native": "^6.0.0",
        "@react-navigation/native-stack": "^6.0.0",
      },
    }),
  );
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const toStaged = (rel: string): StagedFile => ({
    path: rel,
    absPath: path.join(dir, rel),
    status: "M",
    partiallyStaged: false,
  });
  return {
    dir,
    ctx: { packageRoot: dir, gitRoot: dir } as ProjectContext,
    staged: (...rels) => rels.map(toStaged),
    all: () => Object.keys(files).map(toStaged),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const NAVIGATOR = `import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
const Stack = createNativeStackNavigator();
const Home = () => null, Details = () => null, Orphan = () => null;
export function App() {
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen name="Home" component={Home} />
      <Stack.Screen name="Details" component={Details} />
      <Stack.Screen name="Orphan" component={Orphan} />
    </Stack.Navigator>
  );
}
`;

describe("rn-navigation", () => {
  it("applies only to projects with @react-navigation deps", () => {
    const p = makeNavProject({});
    try {
      expect(navigationCheck.appliesTo(p.ctx)).toBe(true);
      fs.writeFileSync(
        path.join(p.dir, "package.json"),
        JSON.stringify({ name: "tmp", dependencies: { "react-native": "0.74.0" } }),
      );
      expect(navigationCheck.appliesTo(p.ctx)).toBe(false);
    } finally {
      p.cleanup();
    }
  });

  it("flags navigate() to a name no navigator registers", async () => {
    const p = makeNavProject({
      "App.tsx": NAVIGATOR,
      "Screen.tsx": `export const go = (navigation: any) => {
  navigation.navigate("Details");
  navigation.navigate("Detials");
};
`,
    });
    try {
      const res = await navigationCheck.run(p.all(), p.ctx, cfg);
      const unreg = res.issues.filter((i) => i.ruleId === "navigation/unregistered-screen");
      expect(unreg).toHaveLength(1);
      expect(unreg[0]!.problem).toContain('"Detials"');
      expect(unreg[0]!.file).toBe("Screen.tsx");
      expect(unreg[0]!.line).toBe(3);
    } finally {
      p.cleanup();
    }
  });

  it("flags a duplicate name in one navigator, not across navigators", async () => {
    const p = makeNavProject({
      "App.tsx": `import { createNativeStackNavigator } from "@react-navigation/native-stack";
const Stack = createNativeStackNavigator();
const A = () => null;
export const One = () => (
  <Stack.Navigator>
    <Stack.Screen name="Home" component={A} />
    <Stack.Screen name="Home" component={A} />
  </Stack.Navigator>
);
`,
      "Other.tsx": `import { createNativeStackNavigator } from "@react-navigation/native-stack";
const S = createNativeStackNavigator();
const B = () => null;
export const Two = () => (
  <S.Navigator>
    <S.Screen name="Home" component={B} />
  </S.Navigator>
);
export const go = (navigation: any) => navigation.navigate("Home");
`,
    });
    try {
      const res = await navigationCheck.run(p.all(), p.ctx, cfg);
      const dups = res.issues.filter((i) => i.ruleId === "navigation/duplicate-screen");
      expect(dups).toHaveLength(1);
      expect(dups[0]!.severity).toBe("error");
      expect(dups[0]!.file).toBe("App.tsx");
    } finally {
      p.cleanup();
    }
  });

  it("flags an unnavigated stack screen but never the initial route", async () => {
    const p = makeNavProject({
      "App.tsx": NAVIGATOR,
      "Screen.tsx": `export const go = (navigation: any) => navigation.navigate("Details");\n`,
    });
    try {
      const res = await navigationCheck.run(p.all(), p.ctx, cfg);
      const unused = res.issues.filter((i) => i.ruleId === "navigation/unused-screen");
      expect(unused).toHaveLength(1);
      expect(unused[0]!.problem).toContain('"Orphan"');
    } finally {
      p.cleanup();
    }
  });

  it("never flags tab screens as unused (always reachable from the chrome)", async () => {
    const p = makeNavProject({
      "Tabs.tsx": `import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
const Tab = createBottomTabNavigator();
const A = () => null, B = () => null;
export const Tabs = () => (
  <Tab.Navigator>
    <Tab.Screen name="Feed" component={A} />
    <Tab.Screen name="Settings" component={B} />
  </Tab.Navigator>
);
`,
    });
    try {
      const res = await navigationCheck.run(p.all(), p.ctx, cfg);
      expect(res.issues).toHaveLength(0);
    } finally {
      p.cleanup();
    }
  });

  it("suppresses unregistered/unused when screen names are dynamic", async () => {
    const p = makeNavProject({
      "App.tsx": `import { createNativeStackNavigator } from "@react-navigation/native-stack";
const Stack = createNativeStackNavigator();
const A = () => null;
export const App = (routes: { name: string }[]) => (
  <Stack.Navigator>
    {routes.map((r) => <Stack.Screen key={r.name} name={r.name} component={A} />)}
    <Stack.Screen name="Fixed" component={A} />
  </Stack.Navigator>
);
export const go = (navigation: any) => navigation.navigate("MaybeDynamic");
`,
    });
    try {
      const res = await navigationCheck.run(p.all(), p.ctx, cfg);
      expect(res.issues).toHaveLength(0);
    } finally {
      p.cleanup();
    }
  });

  it("suppresses unused when navigation targets are dynamic", async () => {
    const p = makeNavProject({
      "App.tsx": NAVIGATOR,
      "Screen.tsx": `export const go = (navigation: any, target: string) => {
  navigation.navigate("Details");
  navigation.navigate(target);
};
`,
    });
    try {
      const res = await navigationCheck.run(p.all(), p.ctx, cfg);
      expect(res.issues.filter((i) => i.ruleId === "navigation/unused-screen")).toHaveLength(0);
    } finally {
      p.cleanup();
    }
  });

  it("ignores array.push and string.replace", async () => {
    const p = makeNavProject({
      "App.tsx": NAVIGATOR,
      "Util.ts": `export const f = (xs: string[], s: string, navigation: any) => {
  xs.push("NotAScreen");
  s.replace("AlsoNot", "AScreen");
  navigation.push("Details");
  navigation.navigate("Details");
};
`,
    });
    try {
      const res = await navigationCheck.run(p.all(), p.ctx, cfg);
      expect(
        res.issues.filter((i) => i.ruleId === "navigation/unregistered-screen"),
      ).toHaveLength(0);
    } finally {
      p.cleanup();
    }
  });

  it("understands the v7 static screens API and nested screen params", async () => {
    const p = makeNavProject({
      "App.tsx": `import { createNativeStackNavigator } from "@react-navigation/native-stack";
const Home = () => null, Profile = () => null;
const Stack = createNativeStackNavigator({ screens: { Home: Home, Profile: Profile } });
export default Stack;
`,
      "Go.ts": `export const go = (navigation: any) => {
  navigation.navigate("Home", { screen: "Profile" });
  navigation.navigate("Nowhere");
};
`,
    });
    try {
      const res = await navigationCheck.run(p.all(), p.ctx, cfg);
      const unreg = res.issues.filter((i) => i.ruleId === "navigation/unregistered-screen");
      expect(unreg).toHaveLength(1);
      expect(unreg[0]!.problem).toContain('"Nowhere"');
    } finally {
      p.cleanup();
    }
  });

  it("reports only on files in the current scope", async () => {
    const p = makeNavProject({
      "App.tsx": NAVIGATOR,
      "Screen.tsx": `export const go = (navigation: any) => navigation.navigate("Typo");\n`,
    });
    try {
      // Whole project parsed, but only App.tsx is in scope — the Typo issue
      // (which lives in Screen.tsx) must not be reported.
      const res = await navigationCheck.run(p.staged("App.tsx"), p.ctx, cfg);
      expect(
        res.issues.filter((i) => i.ruleId === "navigation/unregistered-screen"),
      ).toHaveLength(0);
      const res2 = await navigationCheck.run(p.staged("Screen.tsx"), p.ctx, cfg);
      expect(
        res2.issues.filter((i) => i.ruleId === "navigation/unregistered-screen"),
      ).toHaveLength(1);
    } finally {
      p.cleanup();
    }
  });

  it("skips with a note when typescript is not resolvable", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-guardian-nav-nots-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "tmp",
        dependencies: { "@react-navigation/native": "^6.0.0" },
      }),
    );
    try {
      const ctx = { packageRoot: dir, gitRoot: dir } as ProjectContext;
      const res = await navigationCheck.run([], ctx, cfg);
      expect(res.status).toBe("skipped");
      expect(res.note).toContain("typescript");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
