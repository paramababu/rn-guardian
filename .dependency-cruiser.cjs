/**
 * Architectural guardrail (PLAN.md §3): the framework-agnostic core must never
 * depend on any framework plugin. This is what keeps the eventual v1.0 split
 * into @guardian/core + @guardian/react-native a clean extraction rather than a
 * refactor. If this rule ever fails the build, the boundary has leaked.
 */
module.exports = {
  forbidden: [
    {
      name: "core-independent-of-plugins",
      severity: "error",
      comment:
        "src/core/** must not import from src/plugins/**. The core is framework-agnostic; " +
        "React Native (and future frameworks) live behind the Plugin interface.",
      from: { path: "^src/core" },
      to: { path: "^src/plugins" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make the module graph fragile.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
