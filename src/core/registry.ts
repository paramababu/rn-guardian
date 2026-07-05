import type { Check, Plugin, ProjectContext } from "../types.js";
import { prettierCheck } from "./checks/prettier.js";
import { eslintCheck } from "./checks/eslint.js";
import { consoleLogCheck } from "./checks/console-log.js";
import { mergeMarkersCheck } from "./checks/merge-markers.js";

/**
 * Framework-agnostic checks that always ship with the core. Ordered so the
 * reporter output reads naturally: format → lint → hygiene.
 *
 * NOTE: this file must never import from ../plugins (enforced by
 * .dependency-cruiser.cjs). Plugins are supplied to `assembleChecks` at runtime.
 */
export const CORE_CHECKS: Check[] = [
  prettierCheck,
  eslintCheck,
  consoleLogCheck,
  mergeMarkersCheck,
];

/**
 * Combine core checks with the checks from whichever plugins claim the project.
 * The caller passes detected plugins; the core stays ignorant of any specific
 * framework.
 */
export async function assembleChecks(
  ctx: ProjectContext,
  plugins: Plugin[],
): Promise<Check[]> {
  const checks = [...CORE_CHECKS];
  for (const plugin of plugins) {
    if (await plugin.detect(ctx)) {
      await plugin.enrich?.(ctx);
      checks.push(...plugin.checks);
    }
  }
  return checks;
}
