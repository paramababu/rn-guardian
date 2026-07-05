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
 * It does NOT install React Native's native toolchain: rn-guardian detects RN
 * from package.json and its checks never import RN, so listing `react-native` as
 * a dependency is enough to activate the plugin. This keeps the harness fast
 * while still exercising the genuine cost drivers (ESLint + file scanning).
 *
 * Usage:
 *   node dogfood/harness.mjs [--files N] [--runs R] [--budget MS] [--keep] [--dir PATH]
 *
 *   --files N     number of staged source files to generate   (default 30)
 *   --runs R      timed pre-commit runs (first is cold)        (default 4)
 *   --budget MS   pre-commit wall-clock budget in ms           (default 3000)
 *   --keep        do not delete the workspace afterwards
 *   --dir PATH    workspace location (default: a temp dir)
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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
const FILES = Number(arg("--files", 30));
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

// A realistic RN screen component. `dirty` seeds genuine issues the checks find.
function componentSource(i, dirty) {
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
`;
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
  log(`files: ${FILES} · runs: ${RUNS} · budget: ${BUDGET}ms`);

  step("Building & packing rn-guardian");
  sh("npm", ["run", "build"], REPO);
  const tgz = execFileSync(
    "npm",
    ["pack", "--silent", "--pack-destination", ws],
    { cwd: REPO, encoding: "utf8" },
  ).trim();
  log(`packed ${tgz}`);

  step("Scaffolding RN-shaped project");
  scaffold(ws);
  generateFiles(ws, FILES);

  step("Installing toolchain (eslint, typescript-eslint, prettier)");
  sh("npm", ["install", "--no-audit", "--no-fund"], ws);
  sh("npm", ["install", "--no-save", "--no-audit", "--no-fund", path.join(ws, tgz)], ws);
  markReactNative(ws); // add react-native to the manifest for detection

  step("Initializing git & staging files");
  sh("git", ["init", "-q"], ws);
  sh("git", ["config", "user.email", "dogfood@local"], ws);
  sh("git", ["config", "user.name", "dogfood"], ws);
  sh("git", ["add", "-A"], ws);

  step("Configuring rn-guardian (standard profile)");
  const binDir = path.join(ws, "node_modules", ".bin");
  sh(process.execPath, [path.join(binDir, "rn-guardian"), "init", "--yes"], ws);
  // init writes a config file; restage so the timed run sees a clean stage set.
  sh("git", ["add", "-A"], ws);

  step(`Timing ${RUNS} pre-commit runs (autofix off in this non-TTY harness)`);
  const times = [];
  for (let r = 0; r < RUNS; r++) {
    const { wallMs, parsed, stdout, stderr, status, error } = timeRun(ws, binDir);
    if (!parsed) {
      log(`  run ${r + 1}: \x1b[31mFAILED\x1b[0m (exit ${status})`);
      log(`    stdout(${(stdout || "").length}b): ${JSON.stringify((stdout || "").slice(0, 200))}`);
      if (error) log(`    spawn error: ${error.message}`);
      if (stderr) log(`    stderr: ${stderr.split("\n").slice(0, 8).join(" | ")}`);
      throw new Error("pre-commit run did not produce JSON output");
    }
    times.push(wallMs);
    const label = r === 0 ? "cold" : "warm";
    log(
      `  run ${r + 1} (${label}): ${wallMs.toFixed(0)}ms wall · ` +
        `engine ${parsed.durationMs}ms · ${parsed.summary.remaining} findings in ${parsed.fileCount} files`,
    );
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
