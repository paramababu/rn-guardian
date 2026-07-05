/**
 * A tiny, dependency-free JSX opening-tag scanner.
 *
 * Full AST parsing is overkill for the handful of RN rules we run at pre-commit,
 * but naive regex breaks on the two things JSX attributes are full of: `=>` in
 * arrow callbacks and `>` inside `{expressions}`. The trick that makes this
 * robust without a parser: an opening tag only ends at a `>` seen at brace-depth
 * zero and outside any string. Every `>` inside `style={{ a: b > c }}` or
 * `renderItem={() => <X/>}` lives at depth ≥ 1, so it is skipped correctly.
 *
 * This is heuristic (it does not understand comments inside expressions, and it
 * matches by tag name, not by resolved import), which is the right precision for
 * a fast advisory check. AST-grade rules can arrive later as ESLint rules.
 */

export interface JsxElement {
  tag: string;
  /** 1-based line of the opening `<`. */
  line: number;
  /** Text of the attributes (between the tag name and the closing `>`). */
  attrs: string;
  selfClosing: boolean;
}

const IDENT = /[A-Za-z0-9_$]/;

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && IDENT.test(ch);
}

/** Find all opening tags whose name is in `tagNames`. */
export function scanJsxElements(
  content: string,
  tagNames: string[],
): JsxElement[] {
  const out: JsxElement[] = [];
  const names = new Set(tagNames);

  for (let i = 0; i < content.length; i++) {
    if (content[i] !== "<") continue;

    // Read the tag name immediately after `<`.
    let j = i + 1;
    while (j < content.length && isIdentChar(content[j])) j++;
    const tag = content.slice(i + 1, j);
    if (tag.length === 0 || !names.has(tag)) continue;
    // The char ending the name must be a boundary (space, /, >, newline) so
    // `<Image` does not match inside `<ImageBackground`.
    if (isIdentChar(content[j])) continue;

    const end = findTagEnd(content, j);
    if (end === -1) continue;

    let attrs = content.slice(j, end);
    const selfClosing = attrs.trimEnd().endsWith("/");
    if (selfClosing) attrs = attrs.trimEnd().slice(0, -1);

    out.push({
      tag,
      line: lineAt(content, i),
      attrs,
      selfClosing,
    });

    i = end; // continue scanning after this tag
  }

  return out;
}

/** Index of the `>` that closes the opening tag starting at `from`, or -1. */
function findTagEnd(content: string, from: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = from; i < content.length; i++) {
    const c = content[i]!;
    if (str) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/** Does the attribute text contain a given prop (e.g. "keyExtractor")? */
export function hasProp(attrs: string, prop: string): boolean {
  return new RegExp(`(^|\\s)${prop}\\s*[=}]`).test(attrs) || new RegExp(`(^|\\s)${prop}(\\s|$)`).test(attrs);
}
