import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectProject } from "../src/core/project/detect.js";
import { isReactNative, enrichReactNative } from "../src/plugins/react-native/detect.js";

function scaffold(pkg: Record<string, unknown>, extra: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-guardian-detect-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  for (const [rel, content] of Object.entries(extra)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

describe("core project detection", () => {
  it("detects TypeScript, ESLint major, and package manager", async () => {
    const dir = scaffold(
      {
        name: "x",
        devDependencies: { eslint: "^9.2.0", typescript: "^5.4.0", prettier: "^3.0.0" },
      },
      { "yarn.lock": "" },
    );
    const ctx = await detectProject(dir);
    expect(ctx.hasTypeScript).toBe(true);
    expect(ctx.eslint.installed).toBe(true);
    expect(ctx.eslint.major).toBe(9);
    expect(ctx.prettierInstalled).toBe(true);
    expect(ctx.packageManager).toBe("yarn");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects husky as the hook manager", async () => {
    const dir = scaffold({ name: "x", devDependencies: { husky: "^9.0.0" } });
    const ctx = await detectProject(dir);
    expect(ctx.hookManager).toBe("husky");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("react-native plugin detection", () => {
  it("detects a bare RN app", async () => {
    const dir = scaffold({ name: "x", dependencies: { "react-native": "0.74.1" } });
    const ctx = await detectProject(dir);
    expect(isReactNative(ctx)).toBe(true);
    enrichReactNative(ctx);
    expect(ctx.framework?.id).toBe("react-native");
    expect(ctx.framework?.variant).toBe("bare");
    expect(ctx.framework?.version).toBe("0.74.1");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects an Expo app via the expo dependency", async () => {
    const dir = scaffold({ name: "x", dependencies: { expo: "^51.0.0", "react-native": "0.74.1" } });
    const ctx = await detectProject(dir);
    enrichReactNative(ctx);
    expect(ctx.framework?.variant).toBe("expo");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is not a false positive on a plain node project", async () => {
    const dir = scaffold({ name: "x", dependencies: { express: "^4.0.0" } });
    const ctx = await detectProject(dir);
    expect(isReactNative(ctx)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
