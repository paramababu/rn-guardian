import { describe, it, expect } from "vitest";
import { resolveConfig } from "../src/core/config/load.js";
import type { Check } from "../src/types.js";

const fakeCheck = (id: string, tier: Check["tier"]): Check => ({
  id,
  inspector: "hygiene",
  tier,
  appliesTo: () => true,
  run: async () => ({ status: "pass", issues: [], durationMs: 0 }),
});

describe("config resolution", () => {
  it("defaults to the standard profile", () => {
    const cfg = resolveConfig({});
    expect(cfg.profile).toBe("standard");
  });

  it("standard profile puts TypeScript on the push tier", () => {
    const cfg = resolveConfig({});
    const ts = cfg.forCheck(fakeCheck("typescript", "commit"));
    expect(ts.tier).toBe("push");
    expect(ts.enabled).toBe(true);
  });

  it("user config overrides the profile", () => {
    const cfg = resolveConfig({
      profile: "standard",
      checks: { typescript: { tier: "commit" } },
    });
    expect(cfg.forCheck(fakeCheck("typescript", "commit")).tier).toBe("commit");
  });

  it("minimal profile disables console-log", () => {
    const cfg = resolveConfig({ profile: "minimal" });
    expect(cfg.forCheck(fakeCheck("console-log", "commit")).enabled).toBe(false);
  });

  it("merges options from profile and user", () => {
    const cfg = resolveConfig({
      profile: "standard",
      checks: { "large-assets": { options: { maxKb: 50 } } },
    });
    const resolved = cfg.forCheck(fakeCheck("large-assets", "commit"));
    expect(resolved.options.maxKb).toBe(50);
  });
});
