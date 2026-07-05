/**
 * Public API surface. In v0.1 the plugin API is exported but not yet frozen —
 * it stabilizes at v1.0 alongside the @guardian/core package split (PLAN.md
 * roadmap). Framework-plugin authors implement `Plugin` / `Check`.
 */
export type {
  Plugin,
  Check,
  CheckConfig,
  CheckResult,
  CheckStatus,
  Issue,
  AutoFix,
  ProjectContext,
  StagedFile,
  Tier,
  Severity,
  InspectorId,
  InspectorMeta,
} from "./types.js";

export { INSPECTORS, inspectorTitle } from "./core/inspectors.js";
export { PROFILES, DEFAULT_PROFILE } from "./core/config/profiles.js";
export type { ProfileName, ProfileDefinition } from "./core/config/profiles.js";
export { runEngine } from "./engine.js";
export type { EngineOptions, EngineResult } from "./engine.js";
export { reactNativePlugin } from "./plugins/react-native/index.js";
