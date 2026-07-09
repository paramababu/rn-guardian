import type { Plugin } from "../../types.js";
import { isReactNative, enrichReactNative } from "./detect.js";
import { secretsCheck } from "./checks/secrets.js";
import { largeAssetsCheck } from "./checks/large-assets.js";
import { performanceCheck } from "./checks/performance.js";
import { accessibilityCheck } from "./checks/accessibility.js";
import { eslintRulesCheck } from "./checks/eslint-rules.js";
import { bundleAdvisorCheck } from "./checks/bundle-advisor.js";
import { expoConfigCheck } from "./checks/expo-config.js";

/**
 * The React Native plugin — the first `Plugin` rn-guardian ships. Everything
 * RN-aware lives behind this boundary; the core never imports it directly.
 *
 * The performance and accessibility inspectors ship in two forms: AST-grade
 * ESLint rules (./eslint-plugin) injected into the project's own ESLint when it
 * is available, and a small brace-aware JSX scanner (./jsx.ts) that stands in as
 * a zero-dependency fallback when ESLint (or a JSX parser) isn't installed. Only
 * one runs — `enrichReactNative` sets `framework.astRules` and the heuristic
 * checks defer when it's set.
 */
export const reactNativePlugin: Plugin = {
  id: "react-native",
  detect: (ctx) => isReactNative(ctx),
  enrich: (ctx) => enrichReactNative(ctx),
  checks: [
    secretsCheck,
    largeAssetsCheck,
    performanceCheck,
    accessibilityCheck,
    eslintRulesCheck,
    bundleAdvisorCheck,
    expoConfigCheck,
  ],
};
