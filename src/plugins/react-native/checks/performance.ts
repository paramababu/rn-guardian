import type { Check, Issue } from "../../../types.js";
import { readFileSafe, sourceFiles, toLines } from "../../../core/util/files.js";
import { docs } from "../../../core/docs.js";
import { scanJsxElements, hasProp } from "../jsx.js";

const LIST_TAGS = ["FlatList", "SectionList", "FlashList", "VirtualizedList"];

// Only .tsx/.jsx can contain JSX; scanning .ts/.js avoids false positives.
function isJsxFile(path: string): boolean {
  return path.endsWith(".tsx") || path.endsWith(".jsx");
}

// An inline style object literal: style={{ … }} or contentContainerStyle={{ … }}.
const INLINE_STYLE = /\b[A-Za-z]*[sS]tyle\s*=\s*\{\{/;

// renderItem={() => …} / {function …} / {async …} — a new function each render.
const ANON_RENDER = /renderItem\s*=\s*\{\s*(\(|async\b|function\b)/;

export const performanceCheck: Check = {
  id: "rn-performance",
  inspector: "performance",
  tier: "commit",
  appliesTo: (ctx) => ctx.framework?.id === "react-native",
  async run(files) {
    const start = Date.now();
    const issues: Issue[] = [];

    for (const file of sourceFiles(files)) {
      if (!isJsxFile(file.path)) continue;
      const content = readFileSafe(file.absPath);
      if (content === null) continue;
      const lines = toLines(content);

      // 1. Inline style objects — line-accurate, robust regex.
      for (let i = 0; i < lines.length; i++) {
        if (INLINE_STYLE.test(lines[i]!)) {
          issues.push(inlineStyle(file.path, i + 1));
        }
      }

      // 2 & 3. List-element rules via the tag scanner.
      for (const el of scanJsxElements(content, LIST_TAGS)) {
        if (!hasProp(el.attrs, "keyExtractor")) {
          issues.push(missingKeyExtractor(file.path, el.line, el.tag));
        }
        if (ANON_RENDER.test(el.attrs)) {
          issues.push(anonRenderItem(file.path, el.line, el.tag));
        }
      }
    }

    return {
      status: issues.length ? "warn" : "pass",
      issues,
      durationMs: Date.now() - start,
    };
  },
};

function missingKeyExtractor(file: string, line: number, tag: string): Issue {
  return {
    ruleId: "performance/flatlist-key-extractor",
    inspector: "performance",
    severity: "warning",
    file,
    line,
    problem: `<${tag}> has no keyExtractor.`,
    why: "Without a stable key per row, React Native falls back to array index. When the data reorders or items are inserted, it re-mounts rows instead of moving them — throwing away their view state and re-rendering more than necessary.",
    impact:
      "Visible flicker and dropped frames while scrolling or updating long lists, worst on low-end Android.",
    fix: {
      description:
        "Add keyExtractor={(item) => item.id} returning a stable unique string for each row.",
    },
    docsUrl: docs("flatlist-key-extractor"),
  };
}

function anonRenderItem(file: string, line: number, tag: string): Issue {
  return {
    ruleId: "performance/no-anonymous-render-callback",
    inspector: "performance",
    severity: "warning",
    file,
    line,
    problem: `<${tag}> uses an inline renderItem function.`,
    why: "An arrow function defined in JSX is a brand-new reference on every render, so the list's memoization can never hit — every parent render re-renders every visible row.",
    impact: "Unnecessary row re-renders on each parent update; janky scrolling.",
    fix: {
      description:
        "Hoist renderItem to a stable reference with useCallback (or a module-level function) so it keeps the same identity between renders.",
    },
    docsUrl: docs("no-anonymous-render-callback"),
  };
}

function inlineStyle(file: string, line: number): Issue {
  return {
    ruleId: "performance/no-inline-style-object",
    inspector: "performance",
    severity: "warning",
    file,
    line,
    problem: "Inline style object literal.",
    why: "A `style={{…}}` literal allocates a new object on every render. That defeats the prop-equality checks RN uses to skip work, and pressures the garbage collector inside hot render paths.",
    impact: "Extra allocations and re-renders in frequently-rendered components.",
    fix: {
      description:
        "Move static styles to StyleSheet.create() outside the component; compute only the dynamic parts inline.",
    },
    docsUrl: docs("no-inline-style-object"),
  };
}
