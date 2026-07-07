import { describe, it, expect } from "vitest";
import { expoConfigCheck } from "../src/plugins/react-native/checks/expo-config.js";
import { makeStaged } from "./helpers.js";
import type { CheckConfig, ProjectContext } from "../src/types.js";

const cfg: CheckConfig = { enabled: true, tier: "push", options: {} };
const expoCtx = { framework: { id: "react-native", variant: "expo" } } as ProjectContext;

describe("expo-config", () => {
  it("flags an Android permission with no matching iOS usage string", async () => {
    const appJson = JSON.stringify({
      expo: { android: { permissions: ["android.permission.CAMERA", "android.permission.RECORD_AUDIO"] }, ios: { infoPlist: {} } },
    });
    const { staged, cleanup } = makeStaged({ "app.json": appJson });
    const res = await expoConfigCheck.run(staged, expoCtx, cfg);
    expect(res.status).toBe("warn");
    const problems = res.issues.map((i) => i.problem).join(" ");
    expect(problems).toContain("NSCameraUsageDescription");
    expect(problems).toContain("NSMicrophoneUsageDescription");
    cleanup();
  });

  it("passes when the iOS usage strings are present", async () => {
    const appJson = JSON.stringify({
      expo: {
        android: { permissions: ["android.permission.CAMERA"] },
        ios: { infoPlist: { NSCameraUsageDescription: "We use the camera to scan receipts." } },
      },
    });
    const { staged, cleanup } = makeStaged({ "app.json": appJson });
    const res = await expoConfigCheck.run(staged, expoCtx, cfg);
    expect(res.status).toBe("pass");
    expect(res.issues).toHaveLength(0);
    cleanup();
  });

  it("skips when app.json is not staged", async () => {
    const { staged, cleanup } = makeStaged({ "src/a.ts": "export const a = 1;\n" });
    const res = await expoConfigCheck.run(staged, expoCtx, cfg);
    expect(res.status).toBe("pass");
    expect(res.issues).toHaveLength(0);
    cleanup();
  });

  it("notes that app.config.js cannot be statically analyzed", async () => {
    const { staged, cleanup } = makeStaged({ "app.config.js": "module.exports = {};" });
    const res = await expoConfigCheck.run(staged, expoCtx, cfg);
    expect(res.status).toBe("skipped");
    expect(res.note).toContain("app.config");
    cleanup();
  });

  it("only applies to Expo projects", () => {
    expect(expoConfigCheck.appliesTo(expoCtx)).toBe(true);
    expect(
      expoConfigCheck.appliesTo({ framework: { id: "react-native", variant: "bare" } } as ProjectContext),
    ).toBe(false);
    expect(expoConfigCheck.appliesTo({} as ProjectContext)).toBe(false);
  });
});
