import type { Plugin } from "../../types.js";
import { isReactNative, enrichReactNative } from "./detect.js";
import { secretsCheck } from "./checks/secrets.js";
import { largeAssetsCheck } from "./checks/large-assets.js";
import { performanceCheck } from "./checks/performance.js";
import { accessibilityCheck } from "./checks/accessibility.js";

/**
 * The React Native plugin — the first `Plugin` rn-guardian ships. Everything
 * RN-aware lives behind this boundary; the core never imports it directly.
 *
 * The performance and accessibility inspectors use a small brace-aware JSX
 * scanner (./jsx.ts) rather than full AST parsing — the right precision for a
 * fast advisory pre-commit check.
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
  ],
};
