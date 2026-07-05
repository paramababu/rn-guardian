import type { Plugin } from "./types.js";
import { reactNativePlugin } from "./plugins/react-native/index.js";

/**
 * All framework plugins bundled with rn-guardian. The CLI wires these into the
 * core at runtime — the core itself never references any plugin (enforced by
 * .dependency-cruiser.cjs). Adding React/Next/Node later means appending here.
 */
export const BUNDLED_PLUGINS: Plugin[] = [reactNativePlugin];
