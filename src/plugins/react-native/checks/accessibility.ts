import type { Check, Issue } from "../../../types.js";
import { readFileSafe, sourceFiles } from "../../../core/util/files.js";
import { docs } from "../../../core/docs.js";
import { scanJsxElements, hasProp, importsReactNative, hasTextChild } from "../jsx.js";

const TOUCHABLES = [
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "Pressable",
];

function isJsxFile(path: string): boolean {
  return path.endsWith(".tsx") || path.endsWith(".jsx");
}

/** Any of these props gives an element an accessible name. */
function hasLabel(attrs: string): boolean {
  return (
    hasProp(attrs, "accessibilityLabel") ||
    hasProp(attrs, "aria-label") ||
    hasProp(attrs, "accessibilityLabelledBy")
  );
}

/** Explicitly marked non-accessible / decorative — respect the author. */
function isOptedOut(attrs: string): boolean {
  return /accessible\s*=\s*\{\s*false\s*\}/.test(attrs) ||
    /importantForAccessibility\s*=\s*["']no/.test(attrs) ||
    /aria-hidden/.test(attrs);
}

export const accessibilityCheck: Check = {
  id: "rn-accessibility",
  inspector: "accessibility",
  tier: "commit",
  appliesTo: (ctx) => ctx.framework?.id === "react-native",
  async run(files) {
    const start = Date.now();
    const issues: Issue[] = [];

    for (const file of sourceFiles(files)) {
      if (!isJsxFile(file.path)) continue;
      const content = readFileSafe(file.absPath);
      if (content === null) continue;
      if (!importsReactNative(content)) continue;

      for (const el of scanJsxElements(content, TOUCHABLES)) {
        if (isOptedOut(el.attrs) || hasLabel(el.attrs)) continue;
        // A touchable wrapping a <Text> child gets its label from that text.
        if (hasTextChild(content, el)) continue;
        issues.push(touchableNoLabel(file.path, el.line, el.tag));
      }

      for (const el of scanJsxElements(content, ["Image"])) {
        if (isOptedOut(el.attrs) || hasLabel(el.attrs) || hasProp(el.attrs, "alt")) {
          continue;
        }
        issues.push(imageNoLabel(file.path, el.line));
      }
    }

    return {
      status: issues.length ? "warn" : "pass",
      issues,
      durationMs: Date.now() - start,
    };
  },
};

function touchableNoLabel(file: string, line: number, tag: string): Issue {
  return {
    ruleId: "accessibility/touchable-accessibility-label",
    inspector: "accessibility",
    severity: "warning",
    file,
    line,
    problem: `<${tag}> has no accessibilityLabel.`,
    why: "Screen readers (VoiceOver/TalkBack) announce a touchable by its label. Without one, the control is read as an unnamed 'button', so a blind user cannot tell what it does. An icon-only button is completely opaque to them.",
    impact: "The control is unusable with a screen reader.",
    fix: {
      description:
        "Add accessibilityLabel=\"…\" (and accessibilityRole=\"button\"). If the text child already names it, this may be a false positive — set accessible={false} on wrappers to silence.",
    },
    docsUrl: docs("touchable-accessibility-label"),
  };
}

function imageNoLabel(file: string, line: number): Issue {
  return {
    ruleId: "accessibility/image-accessibility",
    inspector: "accessibility",
    severity: "warning",
    file,
    line,
    problem: "<Image> has no accessibilityLabel.",
    why: "An image that carries meaning needs a text alternative, or screen-reader users miss the information it conveys. A purely decorative image should instead be explicitly hidden.",
    impact: "Informative images are silent to assistive tech.",
    fix: {
      description:
        "Add accessibilityLabel=\"…\" for meaningful images; for decorative ones set accessible={false} to opt out intentionally.",
    },
    docsUrl: docs("image-accessibility"),
  };
}
