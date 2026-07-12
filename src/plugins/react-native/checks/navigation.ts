import fs from "node:fs";
import path from "node:path";
import type { Check, Issue } from "../../../types.js";
import { importLocal } from "../../../core/util/resolve-local.js";
import { docs } from "../../../core/docs.js";

/**
 * React Navigation inspector (ROADMAP 0.2.0, deferred until AST): cross-checks
 * every screen *registration* (`<Stack.Screen name="…">`, or the v7 static
 * `create…Navigator({ screens: {…} })`) against every *navigation call*
 * (`navigation.navigate("…")` and friends) across the whole project.
 *
 *   - navigate to a name no navigator registers  → runtime no-op + console
 *     error, the classic silent broken button     (`unregistered-screen`)
 *   - the same name registered twice in one
 *     navigator → React Navigation throws         (`duplicate-screen`)
 *   - a stack screen nothing navigates to         (`unused-screen`)
 *
 * Accuracy over reach (PLAN.md principle: no noisy heuristics): only string
 * literals are tracked, and whenever the project registers screens with
 * dynamic names, the unregistered/unused analyses switch off entirely rather
 * than guess. Tab/drawer screens are always reachable from the chrome, so
 * `unused-screen` applies to stack navigators only, and initial routes are
 * exempt. Parsing uses the project's own `typescript` (resolve-local) — the
 * check skips with a note when it isn't installed.
 *
 * The whole project is parsed (registrations rarely live in the changed
 * files), but issues are only reported on files in the current scope, so a
 * push never nags about pre-existing problems elsewhere.
 */

// ---- minimal slices of the TypeScript API (see typescript.ts for rationale) --

interface TsNode {
  kind: number;
  getStart(sf?: unknown): number;
}
interface TsIdentifier extends TsNode {
  text: string;
}
interface TsStringLiteral extends TsNode {
  text: string;
}
interface TsPropertyAccess extends TsNode {
  expression: TsNode;
  name: TsIdentifier;
}
interface TsCallExpression extends TsNode {
  expression: TsNode;
  arguments: readonly TsNode[];
}
interface TsVariableDeclaration extends TsNode {
  name: TsNode;
  initializer?: TsNode;
}
interface TsObjectLiteral extends TsNode {
  properties: readonly TsNode[];
}
interface TsPropertyAssignment extends TsNode {
  name: TsNode;
  initializer: TsNode;
}
interface TsJsxAttribute extends TsNode {
  name: TsNode;
  initializer?: TsNode;
}
interface TsJsxAttributes extends TsNode {
  properties: readonly TsNode[];
}
interface TsJsxOpeningLike extends TsNode {
  tagName: TsNode;
  attributes: TsJsxAttributes;
}
interface TsJsxElement extends TsNode {
  openingElement: TsJsxOpeningLike;
}
interface TsSourceFile extends TsNode {
  getLineAndCharacterOfPosition(pos: number): { line: number; character: number };
}
interface TsApi {
  createSourceFile(
    name: string,
    text: string,
    target: number,
    parents?: boolean,
    kind?: number,
  ): TsSourceFile;
  forEachChild(node: TsNode, cb: (n: TsNode) => void): void;
  SyntaxKind: {
    Identifier: number;
    StringLiteral: number;
    PropertyAccessExpression: number;
    CallExpression: number;
    VariableDeclaration: number;
    ObjectLiteralExpression: number;
    PropertyAssignment: number;
    JsxElement: number;
    JsxSelfClosingElement: number;
    JsxAttribute: number;
  };
  ScriptTarget: { Latest: number };
  ScriptKind: { TS: number; TSX: number };
}

// ---- project model -----------------------------------------------------------

type NavigatorKind = "stack" | "menu" | "unknown";

interface Registration {
  name: string;
  navigatorId: string;
  kind: NavigatorKind;
  isInitial: boolean;
  file: string;
  line: number;
}

interface Target {
  name: string;
  file: string;
  line: number;
}

interface ProjectNav {
  registrations: Registration[];
  targets: Target[];
  /** A screen was registered with a non-literal name somewhere. */
  dynamicRegistration: boolean;
  /** A navigation call had a non-literal target somewhere. */
  dynamicNavigation: boolean;
}

const CREATOR_KIND: Record<string, NavigatorKind> = {
  createStackNavigator: "stack",
  createNativeStackNavigator: "stack",
  createBottomTabNavigator: "menu",
  createMaterialTopTabNavigator: "menu",
  createMaterialBottomTabNavigator: "menu",
  createDrawerNavigator: "menu",
};

/** Methods that take a screen name as their first argument. */
const NAV_METHODS = new Set(["navigate", "jumpTo"]);
/**
 * Methods that also exist on arrays/strings — only counted when called on a
 * receiver literally named `navigation` (or `nav`), so `list.push("x")` and
 * `str.replace("a","b")` never register as navigation.
 */
const NAV_ONLY_METHODS = new Set(["push", "replace", "popTo"]);
const NAV_RECEIVERS = new Set(["navigation", "nav"]);

const SKIP_DIRS = new Set([
  "node_modules",
  "ios",
  "android",
  "dist",
  "build",
  "coverage",
  "web-build",
]);
const FILE_CAP = 4000;

export const navigationCheck: Check = {
  id: "rn-navigation",
  inspector: "navigation",
  tier: "push",
  appliesTo: (ctx) => usesReactNavigation(ctx.packageRoot),
  async run(files, ctx) {
    const start = Date.now();
    const ts = await importLocal<TsApi>(ctx.packageRoot, "typescript");
    if (!ts) {
      return {
        status: "skipped",
        issues: [],
        durationMs: Date.now() - start,
        note: "typescript not resolvable in project (needed to parse navigators)",
      };
    }

    const { sources, capped } = projectSources(ctx.packageRoot);
    const nav: ProjectNav = {
      registrations: [],
      targets: [],
      dynamicRegistration: false,
      dynamicNavigation: false,
    };
    for (const abs of sources) {
      analyzeFile(ts, ctx.packageRoot, abs, nav);
    }

    // Only report on files in the current scope (the staged/changed set) —
    // the project-wide model is context, not a license to nag about old code.
    const inScope = new Set(files.map((f) => f.path));
    const issues: Issue[] = [
      ...duplicateIssues(nav),
      ...unregisteredIssues(nav),
      ...unusedIssues(nav),
    ].filter((i) => inScope.has(i.file));

    return {
      status: issues.length ? "warn" : "pass",
      issues,
      durationMs: Date.now() - start,
      note: capped ? `scanned first ${FILE_CAP} files only` : undefined,
    };
  },
};

function usesReactNavigation(packageRoot: string): boolean {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.keys(deps).some((d) => d.startsWith("@react-navigation/"));
  } catch {
    return false;
  }
}

/** All parseable source files under the package root (skipping build output). */
function projectSources(root: string): { sources: string[]; capped: boolean } {
  const out: string[] = [];
  let capped = false;
  const walk = (dir: string): void => {
    if (out.length >= FILE_CAP) {
      capped = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        out.push(p);
        if (out.length >= FILE_CAP) {
          capped = true;
          return;
        }
      }
    }
  };
  walk(root);
  return { sources: out, capped };
}

// ---- per-file AST extraction ---------------------------------------------------

function analyzeFile(
  ts: TsApi,
  packageRoot: string,
  absPath: string,
  nav: ProjectNav,
): void {
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return;
  }
  // Cheap pre-filter: files without a navigation-shaped token don't need a parse.
  if (!/Navigator|navigate|jumpTo|<[A-Z]/.test(text)) return;

  const rel = path.relative(packageRoot, absPath).split(path.sep).join("/");
  const sf = ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    absPath.endsWith(".tsx") || absPath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
  const K = ts.SyntaxKind;
  const lineOf = (node: TsNode): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  /** Navigator variables declared in this file: varName → kind. */
  const creators = new Map<string, NavigatorKind>();

  // JSX ancestry: the navigator element a <X.Screen> belongs to.
  const navigatorStack: {
    id: string;
    kind: NavigatorKind;
    initialRouteName?: string;
    screens: Registration[];
  }[] = [];

  const finishNavigator = (n: (typeof navigatorStack)[number]): void => {
    // Initial route: explicit initialRouteName, else the first screen.
    const initial = n.initialRouteName ?? n.screens[0]?.name;
    for (const s of n.screens) {
      s.isInitial = s.name === initial;
      nav.registrations.push(s);
    }
  };

  const visit = (node: TsNode): void => {
    // const Stack = createNativeStackNavigator(...)
    if (node.kind === K.VariableDeclaration) {
      const decl = node as TsVariableDeclaration;
      const init = decl.initializer;
      if (init && init.kind === K.CallExpression) {
        const call = init as TsCallExpression;
        if (call.expression.kind === K.Identifier) {
          const fn = (call.expression as TsIdentifier).text;
          const kind = CREATOR_KIND[fn];
          if (kind && decl.name.kind === K.Identifier) {
            creators.set((decl.name as TsIdentifier).text, kind);
            collectStaticScreens(ts, call, kind, rel, lineOf, nav);
          }
        }
      }
    }

    // navigation.navigate("Name") / navigate("Name") / navigation.push("Name")
    if (node.kind === K.CallExpression) {
      collectNavigateCall(ts, node as TsCallExpression, rel, lineOf, nav);
    }

    // <Stack.Navigator> … <Stack.Screen name="…"> … </Stack.Navigator>
    const opening = jsxOpening(ts, node);
    if (opening) {
      const tag = jsxTagParts(ts, opening.tagName);
      if (tag?.member === "Navigator") {
        const navigator = {
          id: `${rel}:${tag.object}:${node.getStart(sf)}`,
          kind: creators.get(tag.object) ?? ("unknown" as NavigatorKind),
          initialRouteName: literalAttr(ts, opening, "initialRouteName"),
          screens: [],
        };
        navigatorStack.push(navigator);
        ts.forEachChild(node, visit);
        navigatorStack.pop();
        finishNavigator(navigator);
        return;
      }
      if (tag?.member === "Screen") {
        const parent = navigatorStack[navigatorStack.length - 1];
        const name = literalAttr(ts, opening, "name");
        if (name === undefined && hasAttr(ts, opening, "name")) {
          nav.dynamicRegistration = true;
        } else if (name !== undefined && parent) {
          parent.screens.push({
            name,
            navigatorId: parent.id,
            kind: parent.kind,
            isInitial: false,
            file: rel,
            line: lineOf(node),
          });
        } else if (name !== undefined && !parent) {
          // A Screen outside any visible Navigator (e.g. built via a helper) —
          // register it against an unknown navigator so navigate() to it passes.
          nav.registrations.push({
            name,
            navigatorId: `${rel}:detached`,
            kind: "unknown",
            isInitial: true,
            file: rel,
            line: lineOf(node),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/** v7 static API: createNativeStackNavigator({ screens: { Home: … } }). */
function collectStaticScreens(
  ts: TsApi,
  call: TsCallExpression,
  kind: NavigatorKind,
  rel: string,
  lineOf: (n: TsNode) => number,
  nav: ProjectNav,
): void {
  const K = ts.SyntaxKind;
  const arg = call.arguments[0];
  if (!arg || arg.kind !== K.ObjectLiteralExpression) return;
  for (const prop of (arg as TsObjectLiteral).properties) {
    if (prop.kind !== K.PropertyAssignment) continue;
    const pa = prop as TsPropertyAssignment;
    if (propName(ts, pa.name) !== "screens") continue;
    if (pa.initializer.kind !== K.ObjectLiteralExpression) {
      nav.dynamicRegistration = true;
      continue;
    }
    const navigatorId = `${rel}:static:${call.getStart()}`;
    const screens = (pa.initializer as TsObjectLiteral).properties;
    let first = true;
    for (const s of screens) {
      if (s.kind !== K.PropertyAssignment) {
        nav.dynamicRegistration = true; // spread / computed — can't enumerate
        continue;
      }
      const name = propName(ts, (s as TsPropertyAssignment).name);
      if (name === undefined) {
        nav.dynamicRegistration = true;
        continue;
      }
      nav.registrations.push({
        name,
        navigatorId,
        kind,
        isInitial: first,
        file: rel,
        line: lineOf(s),
      });
      first = false;
    }
  }
}

function collectNavigateCall(
  ts: TsApi,
  call: TsCallExpression,
  rel: string,
  lineOf: (n: TsNode) => number,
  nav: ProjectNav,
): void {
  const K = ts.SyntaxKind;
  let method: string | undefined;
  if (call.expression.kind === K.PropertyAccessExpression) {
    const pa = call.expression as TsPropertyAccess;
    const m = pa.name.text;
    if (NAV_METHODS.has(m)) {
      method = m;
    } else if (NAV_ONLY_METHODS.has(m) && pa.expression.kind === K.Identifier) {
      // push/replace also live on arrays & strings — require a receiver
      // actually named like a navigation object.
      if (NAV_RECEIVERS.has((pa.expression as TsIdentifier).text)) method = m;
    }
  } else if (call.expression.kind === K.Identifier) {
    if ((call.expression as TsIdentifier).text === "navigate") method = "navigate";
  }
  if (!method) return;

  const first = call.arguments[0];
  if (!first) return;
  if (first.kind === K.StringLiteral) {
    nav.targets.push({
      name: (first as TsStringLiteral).text,
      file: rel,
      line: lineOf(call),
    });
  } else {
    nav.dynamicNavigation = true;
  }

  // navigate("Parent", { screen: "Child" }) — the nested name is a target too.
  const second = call.arguments[1];
  if (second && second.kind === K.ObjectLiteralExpression) {
    for (const prop of (second as TsObjectLiteral).properties) {
      if (prop.kind !== K.PropertyAssignment) continue;
      const pa = prop as TsPropertyAssignment;
      if (propName(ts, pa.name) !== "screen") continue;
      if (pa.initializer.kind === K.StringLiteral) {
        nav.targets.push({
          name: (pa.initializer as TsStringLiteral).text,
          file: rel,
          line: lineOf(call),
        });
      } else {
        nav.dynamicNavigation = true;
      }
    }
  }
}

// ---- AST helpers ---------------------------------------------------------------

function jsxOpening(ts: TsApi, node: TsNode): TsJsxOpeningLike | null {
  const K = ts.SyntaxKind;
  if (node.kind === K.JsxSelfClosingElement) return node as unknown as TsJsxOpeningLike;
  if (node.kind === K.JsxElement) return (node as unknown as TsJsxElement).openingElement;
  return null;
}

/** `<Stack.Screen>` → { object: "Stack", member: "Screen" }. */
function jsxTagParts(
  ts: TsApi,
  tagName: TsNode,
): { object: string; member: string } | null {
  if (tagName.kind !== ts.SyntaxKind.PropertyAccessExpression) return null;
  const pa = tagName as TsPropertyAccess;
  if (pa.expression.kind !== ts.SyntaxKind.Identifier) return null;
  return { object: (pa.expression as TsIdentifier).text, member: pa.name.text };
}

function findAttr(
  ts: TsApi,
  opening: TsJsxOpeningLike,
  name: string,
): TsJsxAttribute | undefined {
  const K = ts.SyntaxKind;
  for (const prop of opening.attributes.properties) {
    if (prop.kind !== K.JsxAttribute) continue;
    const attr = prop as TsJsxAttribute;
    if (propName(ts, attr.name) === name) return attr;
  }
  return undefined;
}

function hasAttr(ts: TsApi, opening: TsJsxOpeningLike, name: string): boolean {
  return findAttr(ts, opening, name) !== undefined;
}

/** The attribute's value when it is a plain string literal, else undefined. */
function literalAttr(
  ts: TsApi,
  opening: TsJsxOpeningLike,
  name: string,
): string | undefined {
  const attr = findAttr(ts, opening, name);
  if (!attr?.initializer) return undefined;
  if (attr.initializer.kind !== ts.SyntaxKind.StringLiteral) return undefined;
  return (attr.initializer as TsStringLiteral).text;
}

function propName(ts: TsApi, name: TsNode): string | undefined {
  if (name.kind === ts.SyntaxKind.Identifier) return (name as TsIdentifier).text;
  if (name.kind === ts.SyntaxKind.StringLiteral) return (name as TsStringLiteral).text;
  return undefined;
}

// ---- issue builders --------------------------------------------------------------

function duplicateIssues(nav: ProjectNav): Issue[] {
  const seen = new Map<string, Registration>();
  const issues: Issue[] = [];
  for (const reg of nav.registrations) {
    const key = `${reg.navigatorId} ${reg.name}`;
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, reg);
      continue;
    }
    issues.push({
      ruleId: "navigation/duplicate-screen",
      inspector: "navigation",
      severity: "error",
      file: reg.file,
      line: reg.line,
      problem: `Screen "${reg.name}" is registered twice in the same navigator (first at ${prior.file}:${prior.line}).`,
      why: "React Navigation throws at runtime when two screens in one navigator share a name — this crashes the app on that navigator's first render.",
      impact: "Crash on screen mount.",
      fix: {
        description: "Rename one of the screens, or delete the duplicate registration.",
      },
      docsUrl: docs("navigation"),
    });
  }
  return issues;
}

function unregisteredIssues(nav: ProjectNav): Issue[] {
  // Dynamic registration anywhere → the registry is incomplete; guessing here
  // would be noise. Likewise a project with no visible registrations at all
  // (expo-router, navigators built in a shared package).
  if (nav.dynamicRegistration || nav.registrations.length === 0) return [];
  const registered = new Set(nav.registrations.map((r) => r.name));
  const issues: Issue[] = [];
  const reported = new Set<string>();
  for (const t of nav.targets) {
    if (registered.has(t.name)) continue;
    const key = `${t.file}:${t.line}:${t.name}`;
    if (reported.has(key)) continue;
    reported.add(key);
    issues.push({
      ruleId: "navigation/unregistered-screen",
      inspector: "navigation",
      severity: "warning",
      file: t.file,
      line: t.line,
      problem: `navigate("${t.name}") — but no navigator registers a screen named "${t.name}".`,
      why: 'React Navigation logs "The action NAVIGATE … was not handled" and does nothing — the button silently breaks, usually noticed only in production.',
      impact: "Dead navigation: the tap does nothing for the user.",
      fix: {
        description: `Register "${t.name}" in a navigator, or fix the name (did a screen get renamed?).`,
      },
      docsUrl: docs("navigation"),
    });
  }
  return issues;
}

function unusedIssues(nav: ProjectNav): Issue[] {
  // Dynamic navigation anywhere → any screen might be reached; say nothing.
  if (nav.dynamicNavigation || nav.dynamicRegistration) return [];
  const targeted = new Set(nav.targets.map((t) => t.name));
  const issues: Issue[] = [];
  for (const reg of nav.registrations) {
    if (reg.kind !== "stack") continue; // tab/drawer screens are always reachable
    if (reg.isInitial) continue;
    if (targeted.has(reg.name)) continue;
    issues.push({
      ruleId: "navigation/unused-screen",
      inspector: "navigation",
      severity: "warning",
      file: reg.file,
      line: reg.line,
      problem: `Screen "${reg.name}" is registered but nothing navigates to it.`,
      why: "An unreachable screen is dead code that still ships in the bundle — often left behind after a flow was removed or renamed.",
      impact: "Dead code in the bundle; misleading navigation map.",
      fix: {
        description: `Delete the registration if the flow is gone — or keep it and exclude this file via checks["rn-navigation"].exclude if it is reached by deep link only.`,
      },
      docsUrl: docs("navigation"),
    });
  }
  return issues;
}
