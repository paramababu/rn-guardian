import type { Tier } from "../../types.js";

/**
 * Profiles (PLAN.md §5) are the primary interface — most developers never open
 * the config file. A profile is a named bundle of per-check settings. Framework
 * (Expo vs. bare) is auto-detected and is a separate axis from the profile.
 */
export type ProfileName = "minimal" | "standard" | "strict" | "enterprise";

export interface CheckSetting {
  enabled: boolean;
  tier: Tier;
  options?: Record<string, unknown>;
}

export interface ProfileDefinition {
  name: ProfileName;
  description: string;
  /** Keyed by check id. Checks absent here fall back to their own default. */
  checks: Record<string, CheckSetting>;
}

export const PROFILES: Record<ProfileName, ProfileDefinition> = {
  minimal: {
    name: "minimal",
    description:
      "formatting + lint + secrets. The 3s floor. Good for legacy repos.",
    checks: {
      prettier: { enabled: true, tier: "commit" },
      eslint: { enabled: true, tier: "commit" },
      "merge-markers": { enabled: true, tier: "commit" },
      "rn-secrets": { enabled: true, tier: "commit" },
      "console-log": { enabled: false, tier: "commit" },
      "large-assets": { enabled: false, tier: "commit" },
      "rn-performance": { enabled: false, tier: "commit" },
      "rn-accessibility": { enabled: false, tier: "commit" },
      "rn-eslint-rules": { enabled: false, tier: "commit" },
      typescript: { enabled: false, tier: "push" },
      "bundle-advisor": { enabled: false, tier: "push" },
      "duplicate-deps": { enabled: false, tier: "push" },
      "circular-deps": { enabled: false, tier: "push" },
      "affected-tests": { enabled: false, tier: "push" },
      "expo-config": { enabled: false, tier: "push" },
    },
  },
  standard: {
    name: "standard",
    description:
      "+ RN performance & a11y, console.log, large assets. The default.",
    checks: {
      prettier: { enabled: true, tier: "commit" },
      eslint: { enabled: true, tier: "commit" },
      "merge-markers": { enabled: true, tier: "commit" },
      "console-log": { enabled: true, tier: "commit" },
      "rn-secrets": { enabled: true, tier: "commit" },
      "large-assets": { enabled: true, tier: "commit", options: { maxKb: 300 } },
      "rn-performance": { enabled: true, tier: "commit" },
      "rn-accessibility": { enabled: true, tier: "commit" },
      "rn-eslint-rules": { enabled: true, tier: "commit" },
      typescript: { enabled: true, tier: "push" },
      "bundle-advisor": { enabled: true, tier: "push" },
      "duplicate-deps": { enabled: true, tier: "push" },
      "circular-deps": { enabled: true, tier: "push" },
      "affected-tests": { enabled: true, tier: "push" },
      "expo-config": { enabled: true, tier: "push" },
    },
  },
  strict: {
    name: "strict",
    description:
      "+ TypeScript at pre-commit, stricter thresholds, no warnings-as-pass.",
    checks: {
      prettier: { enabled: true, tier: "commit" },
      eslint: { enabled: true, tier: "commit" },
      "merge-markers": { enabled: true, tier: "commit" },
      "console-log": { enabled: true, tier: "commit" },
      "rn-secrets": { enabled: true, tier: "commit" },
      "large-assets": { enabled: true, tier: "commit", options: { maxKb: 200 } },
      "rn-performance": { enabled: true, tier: "commit" },
      "rn-accessibility": { enabled: true, tier: "commit" },
      "rn-eslint-rules": { enabled: true, tier: "commit" },
      typescript: { enabled: true, tier: "commit" },
      "bundle-advisor": { enabled: true, tier: "push" },
      "duplicate-deps": { enabled: true, tier: "push" },
      "circular-deps": { enabled: true, tier: "push" },
      "affected-tests": { enabled: true, tier: "push" },
      "expo-config": { enabled: true, tier: "push" },
    },
  },
  enterprise: {
    name: "enterprise",
    description: "Strict + CI team-rule gates (coverage, no-any, max bundle).",
    checks: {
      prettier: { enabled: true, tier: "commit" },
      eslint: { enabled: true, tier: "commit" },
      "merge-markers": { enabled: true, tier: "commit" },
      "console-log": { enabled: true, tier: "commit" },
      "rn-secrets": { enabled: true, tier: "commit" },
      "large-assets": { enabled: true, tier: "commit", options: { maxKb: 150 } },
      "rn-performance": { enabled: true, tier: "commit" },
      "rn-accessibility": { enabled: true, tier: "commit" },
      "rn-eslint-rules": { enabled: true, tier: "commit" },
      typescript: { enabled: true, tier: "commit" },
      "bundle-advisor": { enabled: true, tier: "push" },
      "duplicate-deps": { enabled: true, tier: "push" },
      "circular-deps": { enabled: true, tier: "push" },
      "affected-tests": { enabled: true, tier: "push" },
      "expo-config": { enabled: true, tier: "push" },
    },
  },
};

export const DEFAULT_PROFILE: ProfileName = "standard";
