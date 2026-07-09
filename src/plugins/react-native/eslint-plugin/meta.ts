import type { InspectorId } from "../../../types.js";

/**
 * Metadata that turns a bare ESLint message from one of our rules back into a
 * full five-part rn-guardian `Issue` (problem → why → impact → fix). The rule
 * itself renders the **problem** (with the concrete tag name); everything else —
 * the why/impact/fix prose, the user-facing inspector, and the public ruleId —
 * lives here so it is identical to the JSX-scanner heuristics the AST rules
 * replace. See `../checks/eslint-rules.ts` for the mapping.
 */

/** ESLint plugin name our rules are registered under. */
export const PLUGIN_NAME = "rn-guardian";

export interface RuleMeta {
  /** Public ruleId surfaced on the Issue (matches the heuristic checks'). */
  ruleId: string;
  inspector: InspectorId;
  why: string;
  impact: string;
  /** Prose fix description. */
  fix: string;
  /** Docs slug (activates when a docs base is configured). */
  docsSlug: string;
}

/** Keyed by the rule's short name (no plugin prefix). */
export const RULE_META: Record<string, RuleMeta> = {
  "flatlist-key-extractor": {
    ruleId: "performance/flatlist-key-extractor",
    inspector: "performance",
    why: "Without a stable key per row, React Native falls back to array index. When the data reorders or items are inserted, it re-mounts rows instead of moving them — throwing away their view state and re-rendering more than necessary.",
    impact:
      "Visible flicker and dropped frames while scrolling or updating long lists, worst on low-end Android.",
    fix: "Add keyExtractor={(item) => item.id} returning a stable unique string for each row.",
    docsSlug: "flatlist-key-extractor",
  },
  "no-inline-style-object": {
    ruleId: "performance/no-inline-style-object",
    inspector: "performance",
    why: "A `style={{…}}` literal allocates a new object on every render. That defeats the prop-equality checks RN uses to skip work, and pressures the garbage collector inside hot render paths.",
    impact:
      "Extra allocations and re-renders in frequently-rendered components.",
    fix: "Move static styles to StyleSheet.create() outside the component; compute only the dynamic parts inline.",
    docsSlug: "no-inline-style-object",
  },
  "no-anonymous-render-callback": {
    ruleId: "performance/no-anonymous-render-callback",
    inspector: "performance",
    why: "An arrow function defined in JSX is a brand-new reference on every render, so the list's memoization can never hit — every parent render re-renders every visible row.",
    impact: "Unnecessary row re-renders on each parent update; janky scrolling.",
    fix: "Hoist the callback to a stable reference with useCallback (or a module-level function) so it keeps the same identity between renders.",
    docsSlug: "no-anonymous-render-callback",
  },
  "no-nested-scrollview": {
    ruleId: "performance/no-nested-scrollview",
    inspector: "performance",
    why: "A virtualized list windows its rows by measuring its own scroll offset. Nested inside a ScrollView of the same axis, it is handed unbounded height, so it renders every row at once — virtualization is silently disabled. React Native logs exactly this as a warning at runtime.",
    impact:
      "The whole list mounts eagerly: memory spikes and a long blank/janky first paint on large datasets.",
    fix: "Don't nest a FlatList/SectionList inside a same-axis ScrollView. Use the list's own scrolling, and move surrounding content into ListHeaderComponent / ListFooterComponent.",
    docsSlug: "no-nested-scrollview",
  },
  "touchable-accessibility-label": {
    ruleId: "accessibility/touchable-accessibility-label",
    inspector: "accessibility",
    why: "Screen readers (VoiceOver/TalkBack) announce a touchable by its label. Without one, the control is read as an unnamed 'button', so a blind user cannot tell what it does. An icon-only button is completely opaque to them.",
    impact: "The control is unusable with a screen reader.",
    fix: 'Add accessibilityLabel="…" (and accessibilityRole="button"). Decorative wrappers can set accessible={false} to opt out.',
    docsSlug: "touchable-accessibility-label",
  },
  "image-accessibility": {
    ruleId: "accessibility/image-accessibility",
    inspector: "accessibility",
    why: "An image that carries meaning needs a text alternative, or screen-reader users miss the information it conveys. A purely decorative image should instead be explicitly hidden.",
    impact: "Informative images are silent to assistive tech.",
    fix: 'Add accessibilityLabel="…" for meaningful images; for decorative ones set accessible={false} to opt out intentionally.',
    docsSlug: "image-accessibility",
  },
};

/** All rule short-names, in reporter-friendly order. */
export const RULE_NAMES = Object.keys(RULE_META);
