/**
 * AST-grade React Native rules, written against the standard ESTree JSX node
 * shape so they run under whichever parser the project already uses (espree for
 * .jsx, @typescript-eslint/parser for .tsx). These are the accurate upgrades of
 * the brace-aware JSX-scanner heuristics in ../checks/{performance,accessibility};
 * the scanner versions remain as the fallback when ESLint (or a JSX parser) isn't
 * available. Rule short-names and messages line up with `./meta.ts`.
 *
 * Node types are intentionally loose (`any`): pulling in estree/eslint type
 * packages would add a dependency, and these visitors only touch a handful of
 * well-known JSX fields.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Node = any;
type Rule = {
  meta: {
    type: "problem" | "suggestion";
    docs: { description: string };
    schema: [];
    messages: Record<string, string>;
  };
  create(context: any): Record<string, (node: Node) => void>;
};

const LIST_TAGS = new Set([
  "FlatList",
  "SectionList",
  "FlashList",
  "VirtualizedList",
]);
const TOUCHABLES = new Set([
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "Pressable",
]);
const RENDER_PROPS = new Set([
  "renderItem",
  "renderSectionHeader",
  "renderSectionFooter",
  "ListHeaderComponent",
  "ListFooterComponent",
  "ListEmptyComponent",
]);

/** Tag name of an opening element: `FlatList`, or `FlatList` from `Animated.FlatList`. */
function tagName(opening: Node): string | null {
  const n = opening?.name;
  if (!n) return null;
  if (n.type === "JSXIdentifier") return n.name;
  if (n.type === "JSXMemberExpression") return n.property?.name ?? null;
  return null;
}

function findAttr(opening: Node, name: string): Node | undefined {
  return opening.attributes.find(
    (a: Node) =>
      a.type === "JSXAttribute" &&
      a.name?.type === "JSXIdentifier" &&
      a.name.name === name,
  );
}

/** A `{...props}` spread could supply any prop — makes "is X missing?" unknowable. */
function hasSpread(opening: Node): boolean {
  return opening.attributes.some((a: Node) => a.type === "JSXSpreadAttribute");
}

function hasAccessibleName(opening: Node): boolean {
  return (
    !!findAttr(opening, "accessibilityLabel") ||
    !!findAttr(opening, "aria-label") ||
    !!findAttr(opening, "accessibilityLabelledBy")
  );
}

/** Explicitly marked non-accessible / decorative — respect the author. */
function isOptedOut(opening: Node): boolean {
  const accessible = findAttr(opening, "accessible");
  if (
    accessible?.value?.type === "JSXExpressionContainer" &&
    accessible.value.expression?.type === "Literal" &&
    accessible.value.expression.value === false
  ) {
    return true;
  }
  const important = findAttr(opening, "importantForAccessibility");
  if (
    important?.value?.type === "Literal" &&
    typeof important.value.value === "string" &&
    important.value.value.startsWith("no")
  ) {
    return true;
  }
  return !!findAttr(opening, "aria-hidden");
}

/** Does a JSXElement contain a `<Text>` descendant? (RN derives a label from it.) */
function hasTextDescendant(element: Node): boolean {
  const children: Node[] = element.children ?? [];
  for (const child of children) {
    if (child.type === "JSXElement") {
      if (tagName(child.openingElement) === "Text") return true;
      if (hasTextDescendant(child)) return true;
    }
  }
  return false;
}

const flatlistKeyExtractor: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Require keyExtractor on virtualized lists." },
    schema: [],
    messages: { missing: "<{{tag}}> has no keyExtractor." },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const tag = tagName(node);
        if (!tag || !LIST_TAGS.has(tag)) return;
        if (hasSpread(node)) return;
        if (findAttr(node, "keyExtractor")) return;
        context.report({ node, messageId: "missing", data: { tag } });
      },
    };
  },
};

const noInlineStyleObject: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow inline style object literals." },
    schema: [],
    messages: { inline: "Inline style object literal." },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.type !== "JSXIdentifier") return;
        if (!/style$/i.test(node.name.name)) return;
        const value = node.value;
        if (!value || value.type !== "JSXExpressionContainer") return;
        const expr = value.expression;
        const inline =
          expr?.type === "ObjectExpression" ||
          (expr?.type === "ArrayExpression" &&
            expr.elements.some(
              (el: Node) => el && el.type === "ObjectExpression",
            ));
        if (inline) context.report({ node, messageId: "inline" });
      },
    };
  },
};

const noAnonymousRenderCallback: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow inline list render callbacks." },
    schema: [],
    messages: {
      anon: "<{{tag}}> uses an inline {{prop}} function.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.type !== "JSXIdentifier") return;
        const prop = node.name.name;
        if (!RENDER_PROPS.has(prop)) return;
        const value = node.value;
        if (!value || value.type !== "JSXExpressionContainer") return;
        const t = value.expression?.type;
        if (t !== "ArrowFunctionExpression" && t !== "FunctionExpression")
          return;
        const opening = node.parent;
        const tag =
          (opening?.type === "JSXOpeningElement" && tagName(opening)) || "List";
        context.report({ node, messageId: "anon", data: { tag, prop } });
      },
    };
  },
};

const noNestedScrollview: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow virtualized lists inside a ScrollView." },
    schema: [],
    messages: { nested: "<{{tag}}> is nested inside a <ScrollView>." },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const tag = tagName(node);
        if (!tag || !LIST_TAGS.has(tag)) return;
        // Walk ancestors looking for an enclosing ScrollView.
        let p = node.parent;
        while (p) {
          if (
            p.type === "JSXElement" &&
            p.openingElement !== node &&
            tagName(p.openingElement) === "ScrollView"
          ) {
            context.report({ node, messageId: "nested", data: { tag } });
            return;
          }
          p = p.parent;
        }
      },
    };
  },
};

const touchableAccessibilityLabel: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Require an accessible name on touchables." },
    schema: [],
    messages: { touchable: "<{{tag}}> has no accessibilityLabel." },
  },
  create(context) {
    return {
      JSXElement(node) {
        const opening = node.openingElement;
        const tag = tagName(opening);
        if (!tag || !TOUCHABLES.has(tag)) return;
        if (hasSpread(opening)) return;
        if (hasAccessibleName(opening) || isOptedOut(opening)) return;
        if (hasTextDescendant(node)) return;
        context.report({ node: opening, messageId: "touchable", data: { tag } });
      },
    };
  },
};

const imageAccessibility: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Require an accessible name (or opt-out) on images." },
    schema: [],
    messages: { image: "<Image> has no accessibilityLabel." },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (tagName(node) !== "Image") return;
        if (hasSpread(node)) return;
        if (
          hasAccessibleName(node) ||
          findAttr(node, "alt") ||
          isOptedOut(node)
        ) {
          return;
        }
        context.report({ node, messageId: "image" });
      },
    };
  },
};

/** All rules keyed by short-name (matches `./meta.ts`). */
export const rules: Record<string, Rule> = {
  "flatlist-key-extractor": flatlistKeyExtractor,
  "no-inline-style-object": noInlineStyleObject,
  "no-anonymous-render-callback": noAnonymousRenderCallback,
  "no-nested-scrollview": noNestedScrollview,
  "touchable-accessibility-label": touchableAccessibilityLabel,
  "image-accessibility": imageAccessibility,
};
