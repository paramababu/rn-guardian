import type { InspectorId, InspectorMeta } from "../types.js";

/** User-facing Inspector labels (PLAN.md §3, two-level naming). */
export const INSPECTORS: Record<InspectorId, InspectorMeta> = {
  format: { id: "format", title: "Formatting" },
  lint: { id: "lint", title: "Lint" },
  hygiene: { id: "hygiene", title: "Hygiene" },
  performance: { id: "performance", title: "Performance Inspector" },
  accessibility: { id: "accessibility", title: "Accessibility Inspector" },
  security: { id: "security", title: "Security Inspector" },
  dependency: { id: "dependency", title: "Dependency Advisor" },
  types: { id: "types", title: "Type Checking" },
  tests: { id: "tests", title: "Affected Tests" },
};

export function inspectorTitle(id: InspectorId): string {
  return INSPECTORS[id]?.title ?? id;
}
