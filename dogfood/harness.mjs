#!/usr/bin/env node
/**
 * Dogfood harness for rn-guardian.
 *
 * The one thing our unit tests and CI can't tell us is whether the pre-commit
 * path stays under its ≤3s budget on a *real* project — with the user's actual
 * ESLint config, Prettier, TypeScript, and a realistic number of staged files.
 * This harness builds exactly that: it scaffolds an RN-shaped TypeScript project
 * with a real ESLint flat config + Prettier, installs the packed rn-guardian
 * tarball, stages N generated source files (a fraction seeded with real issues),
 * and times the pre-commit run — reporting wall-clock (what a developer feels)
 * against the budget.
 *
 * Two modes:
 *
 *   synthetic (default) — an RN-shaped scaffold. It does NOT install React
 *   Native's native toolchain: rn-guardian detects RN from package.json and its
 *   checks never import RN, so listing `react-native` as a dependency is enough
 *   to activate the plugin. Fast, and still exercises the genuine cost drivers
 *   (ESLint + file scanning).
 *
 *   full — a REAL generated app (`create-expo-app`, or the community CLI with
 *   --app bare), with its own dependency install and its real ESLint config.
 *   Generated screens top the app up to `--files` total source files. Slow
 *   (one real `npm install`), but this is the run that validates the ≤3s
 *   promise for the 0.1.2 acceptance criterion.
 *
 * Usage:
 *   node dogfood/harness.mjs [--mode synthetic|full] [--app expo|bare]
 *                            [--files N] [--runs R] [--budget MS] [--keep] [--dir PATH]
 *
 *   --mode M      synthetic | full                             (default synthetic)
 *   --app A       full mode app template: expo | bare          (default expo)
 *   --files N     staged source files: generated count in synthetic mode,
 *                 total target in full mode        (default 30 / 220 in full)
 *   --staged N    full mode: files modified+staged for the timed delta commit
 *                 (the budget-gated scenario; the initial all-files stage is
 *                 timed once, informationally)                 (default 15)
 *   --runs R      timed pre-commit runs (first is cold)        (default 4)
 *   --budget MS   pre-commit wall-clock budget in ms           (default 3000)
 *   --keep        do not delete the workspace afterwards
 *   --dir PATH    workspace location (default: a temp dir)
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- args -----------------------------------------------------------------
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const MODE = String(arg("--mode", "synthetic")); // synthetic | full
const APP = String(arg("--app", "expo")); // full mode: expo | bare
const FILES = Number(arg("--files", MODE === "full" ? 220 : 30));
const STAGED = Number(arg("--staged", 15));
const RUNS = Number(arg("--runs", 4));
const BUDGET = Number(arg("--budget", 3000));
const KEEP = arg("--keep", false) === true;
const DIR = arg("--dir", null);

const log = (m) => process.stdout.write(m + "\n");
const step = (m) => log(`\n\x1b[1m▶ ${m}\x1b[0m`);
function sh(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // Surface the real failure instead of an opaque "Command failed".
    const detail = [e.stdout, e.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`\`${cmd} ${args.join(" ")}\` failed:\n${detail || e.message}`);
  }
}

// ---- workspace scaffold ---------------------------------------------------
function scaffold(ws) {
  mkdirSync(path.join(ws, "src"), { recursive: true });

  // Only the real toolchain is installed. `react-native` is added to the
  // manifest AFTER install (see markReactNative) so the plugin detects it
  // without pulling in RN's native dependency tree.
  writeFileSync(
    path.join(ws, "package.json"),
    JSON.stringify(
      {
        name: "dogfood-app",
        version: "1.0.0",
        private: true,
        devDependencies: {
          typescript: "^5.4.5",
          prettier: "^3.2.5",
          eslint: "^9.2.0",
          "typescript-eslint": "^8.0.0",
        },
      },
      null,
      2,
    ),
  );

  // Real ESLint v9 flat config (non-type-checked recommended: realistic + fast).
  writeFileSync(
    path.join(ws, "eslint.config.mjs"),
    `import tseslint from "typescript-eslint";
export default tseslint.config(...tseslint.configs.recommended, {
  rules: { "@typescript-eslint/no-unused-vars": "warn", "prefer-const": "error" },
});
`,
  );

  writeFileSync(
    path.join(ws, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-native",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["src"],
      },
      null,
      2,
    ),
  );

  writeFileSync(path.join(ws, ".prettierrc"), JSON.stringify({ semi: true }));
  writeFileSync(path.join(ws, ".gitignore"), "node_modules/\n");
}

/** Add react-native to the manifest so the RN plugin detects the project. */
function markReactNative(ws) {
  const p = path.join(ws, "package.json");
  const pkg = JSON.parse(readFileSync(p, "utf8"));
  pkg.dependencies = { react: "18.2.0", "react-native": "0.74.1" };
  writeFileSync(p, JSON.stringify(pkg, null, 2));
}

// A realistic RN screen component. `dirty` seeds genuine issues the checks
// find. `rev` marks edited revisions so a delta rewrite actually changes the
// file content relative to the committed version.
function componentSource(i, dirty, rev = 0) {
  const issues = dirty
    ? `
    console.log("render", props.id);
    return (
      <FlatList
        data={props.items}
        style={{ flex: 1, padding: 8 }}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => props.onPress(item)}>
            <Image source={{ uri: item.icon }} />
            <Text>{item.title}</Text>
          </TouchableOpacity>
        )}
      />
    );`
    : `
    return (
      <FlatList
        data={props.items}
        keyExtractor={keyOf}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
      />
    );`;

  return `import React from "react";
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface Item { id: string; title: string; icon: string; }
interface Props { id: string; items: Item[]; onPress: (i: Item) => void; }

const keyOf = (i: Item) => i.id;

export function Screen${i}(props: Props): React.ReactElement {
  const renderRow = React.useCallback(
    ({ item }: { item: Item }) => (
      <View><Text>{item.title}</Text></View>
    ),
    [],
  );
${issues}
}

const styles = StyleSheet.create({ list: { paddingVertical: 12 } });
${rev ? `// rev ${rev}\n` : ""}`;
}

function generateFiles(ws, n) {
  for (let i = 0; i < n; i++) {
    // ~1 in 4 files carries real issues, like a normal commit.
    writeFileSync(
      path.join(ws, "src", `Screen${i}.tsx`),
      componentSource(i, i % 4 === 0),
    );
  }
}

// ---- full mode: real generated apps ----------------------------------------
const SKIP_DIRS = new Set(["node_modules", ".git", ".expo", "android", "ios", "dist"]);

function listSourceFiles(dir, root = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) listSourceFiles(path.join(dir, e.name), root, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
      out.push(path.relative(root, path.join(dir, e.name)));
    }
  }
  return out;
}

/** Generate a real Expo app in ws; returns { appDir, genDir }. */
function scaffoldFullExpo(ws) {
  step("Generating real Expo app (create-expo-app)");
  sh("npx", ["--yes", "create-expo-app@latest", "dogfood-app", "--template", "default", "--no-install"], ws);
  const appDir = path.join(ws, "dogfood-app");

  step("Installing the app's dependencies (the slow part)");
  sh("npm", ["install", "--no-audit", "--no-fund"], appDir);

  // The app's REAL ESLint config. Recent default templates ship
  // eslint.config.js (eslint-config-expo); if this template version doesn't,
  // write exactly what `npx expo lint` scaffolds.
  if (!existsSync(path.join(appDir, "eslint.config.js"))) {
    sh("npm", ["install", "-D", "--no-audit", "--no-fund", "eslint", "eslint-config-expo"], appDir);
    writeFileSync(
      path.join(appDir, "eslint.config.js"),
      `// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([expoConfig, { ignores: ["dist/*"] }]);
`,
    );
  }

  // Prettier, like most real teams run it.
  sh("npm", ["install", "-D", "--no-audit", "--no-fund", "prettier"], appDir);
  writeFileSync(path.join(appDir, ".prettierrc"), JSON.stringify({ semi: true }));

  return { appDir, genDir: path.join("components", "generated") };
}

/** Generate a bare RN app in ws (exercises the eslintrc/v8 path); returns { appDir, genDir }. */
function scaffoldFullBare(ws) {
  step("Generating bare React Native app (@react-native-community/cli)");
  sh(
    "npx",
    [
      "--yes",
      "@react-native-community/cli@latest",
      "init",
      "DogfoodBare",
      "--skip-install",
      "--skip-git-init",
      "--install-pods",
      "false",
    ],
    ws,
  );
  const appDir = path.join(ws, "DogfoodBare");

  step("Installing the app's dependencies (the slow part)");
  sh("npm", ["install", "--no-audit", "--no-fund"], appDir);

  return { appDir, genDir: path.join("src", "generated") };
}

/**
 * Rewrite the first `n` generated screens (same 1-in-4 dirty mix) and stage
 * them — a typical developer commit against an already-committed base.
 */
function stageDelta(appDir, genDir, n) {
  const files = [];
  for (let i = 0; i < n; i++) {
    const rel = path.join(genDir, `Screen${i}.tsx`);
    writeFileSync(path.join(appDir, rel), componentSource(i, i % 4 === 0, 1));
    files.push(rel);
  }
  sh("git", ["add", ...files], appDir);
}

/** Top the real app up to `target` total source files with generated screens. */
function topUpFiles(appDir, genDir, target) {
  const existing = listSourceFiles(appDir).length;
  const need = Math.max(0, target - existing);
  mkdirSync(path.join(appDir, genDir), { recursive: true });
  for (let i = 0; i < need; i++) {
    writeFileSync(
      path.join(appDir, genDir, `Screen${i}.tsx`),
      componentSource(i, i % 4 === 0), // ~1 in 4 dirty, like a normal commit
    );
  }
  log(`app has ${existing} source files; generated ${need} more → ${existing + need} total`);
}

// ---- timing ---------------------------------------------------------------
function timeRun(ws, binDir) {
  const start = process.hrtime.bigint();
  const res = spawnSync(
    process.execPath,
    [path.join(binDir, "rn-guardian"), "run", "--tier", "commit", "--json"],
    { cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6;
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    // leave null; we'll surface stderr
  }
  return {
    wallMs,
    parsed,
    stdout: res.stdout,
    stderr: res.stderr,
    status: res.status,
    error: res.error,
  };
}

// ---- main -----------------------------------------------------------------
const ws = DIR
  ? (mkdirSync(DIR, { recursive: true }), DIR)
  : mkdtempSync(path.join(tmpdir(), "rn-guardian-dogfood-"));

let ok = false;
try {
  log(`\x1b[1mrn-guardian dogfood harness\x1b[0m`);
  log(`workspace: ${ws}`);
  log(
    `mode: ${MODE}${MODE === "full" ? ` (${APP})` : ""} · files: ${FILES} · runs: ${RUNS} · budget: ${BUDGET}ms`,
  );

  step("Building & packing rn-guardian");
  sh("npm", ["run", "build"], REPO);
  const tgz = execFileSync(
    "npm",
    ["pack", "--silent", "--pack-destination", ws],
    { cwd: REPO, encoding: "utf8" },
  ).trim();
  log(`packed ${tgz}`);

  let app = ws; // the project rn-guardian runs in (a subdir of ws in full mode)
  let genDir; // where full mode's generated screens live (delta commits reuse it)
  if (MODE === "full") {
    const scaffolded = APP === "bare" ? scaffoldFullBare(ws) : scaffoldFullExpo(ws);
    app = scaffolded.appDir;
    genDir = scaffolded.genDir;
    topUpFiles(app, genDir, FILES);
  } else {
    step("Scaffolding RN-shaped project");
    scaffold(ws);
    generateFiles(ws, FILES);

    step("Installing toolchain (eslint, typescript-eslint, prettier)");
    sh("npm", ["install", "--no-audit", "--no-fund"], ws);
  }

  step("Installing packed rn-guardian tarball");
  sh("npm", ["install", "--no-save", "--no-audit", "--no-fund", path.join(ws, tgz)], app);
  if (MODE !== "full") markReactNative(ws); // add react-native to the manifest for detection

  step("Initializing git & staging files");
  if (!existsSync(path.join(app, ".git"))) sh("git", ["init", "-q"], app);
  sh("git", ["config", "user.email", "dogfood@local"], app);
  sh("git", ["config", "user.name", "dogfood"], app);
  sh("git", ["add", "-A"], app);

  step("Configuring rn-guardian (standard profile)");
  const binDir = path.join(app, "node_modules", ".bin");
  sh(process.execPath, [path.join(binDir, "rn-guardian"), "init", "--yes"], app);
  // init writes a config file; restage so the timed run sees a clean stage set.
  sh("git", ["add", "-A"], app);

  function timedRuns(runs, coldLabel) {
    const collected = [];
    for (let r = 0; r < runs; r++) {
      const { wallMs, parsed, stdout, stderr, status, error } = timeRun(app, binDir);
      if (!parsed) {
        log(`  run ${r + 1}: \x1b[31mFAILED\x1b[0m (exit ${status})`);
        log(`    stdout(${(stdout || "").length}b): ${JSON.stringify((stdout || "").slice(0, 200))}`);
        if (error) log(`    spawn error: ${error.message}`);
        if (stderr) log(`    stderr: ${stderr.split("\n").slice(0, 8).join(" | ")}`);
        throw new Error("pre-commit run did not produce JSON output");
      }
      collected.push(wallMs);
      const label = r === 0 ? (coldLabel ?? "cold") : "warm";
      log(
        `  run ${r + 1} (${label}): ${wallMs.toFixed(0)}ms wall · ` +
          `engine ${parsed.durationMs}ms · ${parsed.summary.remaining} findings in ${parsed.fileCount} files`,
      );
    }
    return collected;
  }

  let times;
  if (MODE === "full") {
    // Worst case first: the initial commit stages every file. Informational —
    // it also warms rn-guardian's ESLint result cache, exactly like a real
    // repo where the base has been committed before.
    step("Timing initial full-stage run (every file staged — worst case, informational)");
    timedRuns(1, "full stage");

    step(`Committing base & staging a typical ${STAGED}-file delta`);
    sh("git", ["commit", "-q", "-m", "base", "--no-verify"], app);
    stageDelta(app, genDir, STAGED);

    step(`Timing ${RUNS} pre-commit runs on the delta (the budget-gated scenario)`);
    times = timedRuns(RUNS);
  } else {
    step(`Timing ${RUNS} pre-commit runs (autofix off in this non-TTY harness)`);
    times = timedRuns(RUNS);
  }

  const warm = times.slice(1);
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const warmMedian = warm.length ? median(warm) : times[0];
  const worst = Math.max(...times);

  step("Verdict");
  log(`  cold start   : ${times[0].toFixed(0)}ms`);
  log(`  warm median  : ${warmMedian.toFixed(0)}ms`);
  log(`  worst        : ${worst.toFixed(0)}ms`);
  log(`  budget       : ${BUDGET}ms (warm)`);
  if (warmMedian <= BUDGET) {
    log(`\n  \x1b[32m✓ within budget\x1b[0m (warm median ${warmMedian.toFixed(0)}ms ≤ ${BUDGET}ms)`);
    ok = true;
  } else {
    log(`\n  \x1b[31m✗ over budget\x1b[0m (warm median ${warmMedian.toFixed(0)}ms > ${BUDGET}ms)`);
  }
} finally {
  if (KEEP) {
    log(`\nworkspace kept at: ${ws}`);
  } else {
    rmSync(ws, { recursive: true, force: true });
  }
}

process.exit(ok ? 0 : 1);
