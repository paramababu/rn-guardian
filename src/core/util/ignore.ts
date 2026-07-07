import fs from "node:fs";
import path from "node:path";

/**
 * A tiny gitignore-style path matcher — no dependency. Supports the practical
 * subset developers actually use: comments (`#`), blank lines, negation (`!`),
 * anchoring (leading `/` or an internal `/`), directory-only patterns (trailing
 * `/`), and the `*`, `**`, `?` wildcards. Later patterns override earlier ones,
 * so a `!` line can re-include a path a broader pattern excluded.
 *
 * Paths passed to `ignores()` are repo-relative and POSIX (forward slashes),
 * matching `StagedFile.path`.
 */
export interface Ignore {
  ignores(relPath: string): boolean;
  /** True when there are no active patterns (fast-path: skip filtering). */
  readonly empty: boolean;
}

interface Rule {
  negated: boolean;
  re: RegExp;
}

const EMPTY: Ignore = { ignores: () => false, empty: true };

/** Compile a list of gitignore-style pattern lines into a matcher. */
export function compileIgnore(lines: string[]): Ignore {
  const rules: Rule[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, ""); // trailing whitespace, per gitignore
    if (line === "" || line.startsWith("#")) continue;

    let body = line;
    const negated = body.startsWith("!");
    if (negated) body = body.slice(1);

    const dirOnly = body.endsWith("/");
    if (dirOnly) body = body.slice(0, -1);

    // Anchored if the pattern begins with `/` or contains an internal slash.
    const anchored = body.startsWith("/") || body.slice(0, -1).includes("/");
    if (body.startsWith("/")) body = body.slice(1);

    const prefix = anchored ? "^" : "^(?:.*/)?";
    const suffix = dirOnly ? "/.*$" : "(?:/.*)?$";
    rules.push({ negated, re: new RegExp(prefix + translate(body) + suffix) });
  }
  if (rules.length === 0) return EMPTY;

  return {
    empty: false,
    ignores(relPath: string): boolean {
      let ignored = false;
      for (const rule of rules) {
        if (rule.re.test(relPath)) ignored = !rule.negated;
      }
      return ignored;
    },
  };
}

/**
 * Load an ignore file (default `.rn-guardianignore`) from `root`. Returns an
 * empty matcher when the file is absent or unreadable.
 */
export function loadIgnoreFile(
  root: string,
  filename = ".rn-guardianignore",
): Ignore {
  try {
    const raw = fs.readFileSync(path.join(root, filename), "utf8");
    return compileIgnore(raw.split(/\r?\n/));
  } catch {
    return EMPTY;
  }
}

/** Translate one glob body (no anchoring/dir markers) to a regex fragment. */
function translate(glob: string): string {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?"; // `**/` — zero or more directory segments
        } else {
          re += ".*"; // `**` — anything, including slashes
        }
      } else {
        re += "[^/]*"; // `*` — anything within a segment
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return re;
}
