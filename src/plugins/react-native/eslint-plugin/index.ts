import { rules } from "./rules.js";
import { PLUGIN_NAME } from "./meta.js";

/**
 * The rn-guardian ESLint plugin: our React Native rules packaged as a real
 * ESLint plugin object. It is injected programmatically into an isolated run of
 * the *project's own* ESLint (see `../checks/eslint-rules.ts`) — never written to
 * the user's config — so it works identically under eslintrc (v8) and flat (v9).
 */
export const rnGuardianEslintPlugin = {
  meta: { name: PLUGIN_NAME, version: "0.1.0" },
  rules,
};

export { PLUGIN_NAME } from "./meta.js";
