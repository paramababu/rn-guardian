import fs from "node:fs";
import path from "node:path";
import type { Check, CheckConfig, Tier } from "../../types.js";
import {
  DEFAULT_PROFILE,
  PROFILES,
  type ProfileName,
} from "./profiles.js";

/**
 * Shape of guardian.config.json. Everything is optional — a profile alone is a
 * complete configuration. Any field here overrides the chosen profile.
 */
export interface GuardianConfig {
  profile?: ProfileName;
  tiers?: Partial<Record<Tier, boolean>>;
  checks?: Record<
    string,
    Partial<{ enabled: boolean; tier: Tier; options: Record<string, unknown> }>
  >;
  rules?: Record<string, "off" | "warn" | "error">;
  ci?: Record<string, unknown>;
}

const CONFIG_NAMES = [
  "guardian.config.json",
  ".guardianrc",
  ".guardianrc.json",
];

export function loadConfig(packageRoot: string): GuardianConfig {
  for (const name of CONFIG_NAMES) {
    const p = path.join(packageRoot, name);
    try {
      const raw = fs.readFileSync(p, "utf8");
      return JSON.parse(raw) as GuardianConfig;
    } catch {
      // try next
    }
  }
  return {};
}

export interface ResolvedConfig {
  profile: ProfileName;
  tiers: Record<Tier, boolean>;
  raw: GuardianConfig;
  /** Resolve the effective settings for a given check. */
  forCheck(check: Check): CheckConfig;
}

/**
 * Merge profile defaults, the check's own default tier, and user overrides into
 * a single resolver. Precedence (low → high): check default → profile → config.
 */
export function resolveConfig(cfg: GuardianConfig): ResolvedConfig {
  const profile: ProfileName = cfg.profile ?? DEFAULT_PROFILE;
  const profileDef = PROFILES[profile];

  const tiers: Record<Tier, boolean> = {
    commit: cfg.tiers?.commit ?? true,
    push: cfg.tiers?.push ?? true,
    ci: cfg.tiers?.ci ?? true,
  };

  return {
    profile,
    tiers,
    raw: cfg,
    forCheck(check: Check): CheckConfig {
      const fromProfile = profileDef.checks[check.id];
      const fromUser = cfg.checks?.[check.id];

      const enabled = fromUser?.enabled ?? fromProfile?.enabled ?? true;
      const tier = fromUser?.tier ?? fromProfile?.tier ?? check.tier;
      const options = {
        ...(fromProfile?.options ?? {}),
        ...(fromUser?.options ?? {}),
      };

      return { enabled, tier, options };
    },
  };
}
