# rn-guardian — Future Version Implementation Plan

Implementation-level plan for upcoming versions. This is the **how to build it**
companion to the two other docs:

- [`CHANGELOG.md`](./CHANGELOG.md) — what shipped / what's planned (the *what & when*).
- [`PLAN.md`](./PLAN.md) — product vision & architecture (the *why*).

Keep this file updated: when a version ships, move its section's essence into the
CHANGELOG and delete or trim it here. Each entry lists concrete work items, the
files they touch, and an acceptance check.

Status legend: ⬜ not started · 🔶 in progress · ✅ done

---

## 0.1.2 — hardening & real-world validation

Goal: prove the tool on a genuinely large app and cut false-positive noise before
adding surface area.

### ✅ Real-world dogfood on a full app
- `dogfood/harness.mjs --mode full [--app expo|bare]` drives a real generated
  app (create-expo-app / community CLI): real dependency install, the app's own
  ESLint config, 220 source files, packed-tarball install, `init`, then times
  the initial all-files stage (informational) and a typical `--staged` 15-file
  delta commit (budget-gated).
- Follow-on fix it forced: the `eslint` check now uses ESLint's result cache
  (`src/core/checks/eslint.ts`) — repeat lints of unchanged files are free.
- Also surfaced (and fixed): the bare RN template pins `prettier@2.8.8`, which
  the old `prettier@">=3"` peer range refused — install failed outright.
- **Acceptance met:** warm delta-commit median **974ms** (Expo) / **1063ms**
  (bare RN) on real 220-file apps; numbers published in the CHANGELOG (0.2.2).

### ✅ Ignore file support
- `.rn-guardianignore` (gitignore syntax) honored by `core/git/staged.ts` when
  building the staged-file set, plus a `checks.<id>.exclude` glob option in
  config (applied per-check in the runner).
- Files: `src/core/util/ignore.ts` (dependency-free matcher), `staged.ts`,
  `config/load.ts`, `runner/runner.ts`, `types.ts`.
- Tests: `test/ignore.test.ts`, exclude case in `test/runner.test.ts`.

### ✅ Reduce heuristic false positives
- `rn-performance` / `rn-accessibility` skip files that don't import from
  `react-native`; a touchable with a `<Text>` child is treated as labeled.
- Files: `src/plugins/react-native/checks/{performance,accessibility}.ts`,
  `jsx.ts` (`importsReactNative`, `hasTextChild`, element bounds).
- Tests: new cases in `test/rn-checks.test.ts`.

### ✅ `explain` replay cache
- Persists the last run to `node_modules/.cache/rn-guardian/last-run.json`;
  `explain` replays it (labelled "(last run)") instead of re-scanning, falling
  back to a live scan when absent. The non-serializable autofix closure is
  stripped before writing.
- Files: new `src/core/cache.ts`, `commands/{run,explain}.ts`,
  `reporter/terminal.ts` (`printGroupedIssues`), `engine.ts` (`packageRoot`).
- Tests: `test/cache.test.ts`.

### ✅ TypeScript check _(was slated for 0.2.0; pulled forward)_
- Every profile referenced a `typescript` check that no code implemented — the
  strict/enterprise "TypeScript at pre-commit" promise was a no-op. Implemented
  `src/core/checks/typescript.ts` (`tsc --noEmit` via the compiler API, local
  resolution, staged-file-scoped diagnostics), registered in `registry.ts`.
- Tests: `test/typescript.test.ts`.

---

## 0.2.0 — pre-push tier & AST-grade RN rules

Goal: turn on the second tier and upgrade the RN rules where heuristics aren't
good enough.

### ✅ Pre-push tier wired end-to-end
Checks at `tier: "push"`, all dependency-free (stayed at 2 runtime deps):
- ✅ **Bundle Advisor** (moment, lodash barrel, full/compat firebase).
  `src/plugins/react-native/checks/bundle-advisor.ts`. (0.1.3)
- ✅ **Duplicate deps** (lockfile scan, npm v1/2/3 + classic yarn).
  `src/core/checks/duplicate-deps.ts`. (0.1.3)
- ✅ **TypeScript** — whole-program, staged-scoped, now **incremental** with a
  `.tsbuildinfo` cache under `node_modules/.cache/rn-guardian/`.
  `src/core/checks/typescript.ts`. (0.1.2 / 0.1.4)
- ✅ **Affected Jest** (`--findRelatedTests`, spawns the project's local jest,
  skips when absent). `src/core/checks/jest.ts`. (0.1.4)
- ✅ **Circular deps** — custom DFS over relative imports on the changed
  subgraph (chose this over the madge dependency).
  `src/core/checks/circular-deps.ts`. (0.1.4)
- Verified: `run --tier push` executes them; the commit path is untouched
  (push-only in every profile). Also added the Expo config inspector (below).

### ✅ RN ESLint rule pack (injectable) _(0.2.0)_
- Heuristic rules shipped as real ESLint rules under
  `src/plugins/react-native/eslint-plugin/` (rules + shared `meta.ts`), injected
  into an isolated run of the project's own ESLint by a new `rn-eslint-rules`
  check (`checks/eslint-rules.ts`) — flat (v9) and eslintrc (v8) both supported.
  The JSX-scanner versions remain the fallback when ESLint/parser isn't
  resolvable.
- Rules: `flatlist-key-extractor`, `no-inline-style-object`,
  `no-anonymous-render-callback`, `no-nested-scrollview`,
  `touchable-accessibility-label`, `image-accessibility`.
- Deferral: `enrichReactNative` sets `framework.astRules`; `rn-performance` /
  `rn-accessibility` `appliesTo` returns false when it's set, so exactly one form
  runs. Enabled in standard/strict/enterprise profiles.
- Tests: `test/eslint-rules.test.ts` (RuleTester per rule),
  `test/eslint-rules-check.test.ts` (real ESLint injection + deferral).

### 🔶 Navigation & Expo inspectors
- ✅ **Expo** `app.json` — cross-checks sensitive Android permissions against
  missing iOS usage-description strings.
  `src/plugins/react-native/checks/expo-config.ts`. (0.1.4)
- ✅ React Navigation _(0.4.0)_: `rn-navigation` check
  (`src/plugins/react-native/checks/navigation.ts`, push tier) — whole-project
  TS-AST cross-check of screen registrations (JSX + v7 static API) vs
  navigation calls. Rules: `unregistered-screen` (warn), `duplicate-screen`
  (error), `unused-screen` (warn; stacks only, initial routes exempt). Dynamic
  names switch the affected analyses off — accuracy over reach. New
  "Navigation Inspector" grouping. Tests: `test/navigation.test.ts`.

---

## 0.3.0 — CI command & reporting

### 🔶 `rn-guardian ci`
- ✅ Tier-3 runner (no budget): sweeps every enabled check across all tiers over
  the PR diff (`git diff <base>...HEAD`) or the full tree (`--all`). Base ref
  resolves from `--base` / `GITHUB_BASE_REF` / main branches, with a full-scan
  fallback. `src/commands/ci.ts`, runner `runTiers`, git `getChangedFiles` /
  `getAllSourceFiles` / `resolveBaseRef`. (0.2.1)
- ✅ Output: JSON + **GitHub Actions annotations** (`::error file=…,line=…::`) +
  `$GITHUB_STEP_SUMMARY` table. `src/core/reporter/github.ts`. (0.2.1)
- ✅ Team-rule gates `ci.failOn` / `ci.maxWarnings`. `src/core/ci/gates.ts`. A
  tripped gate exits non-zero and annotates the PR. **Acceptance met.** (0.2.1)
- ✅ Remaining gates (0.3.0): `ci.coverage` reads the project's own
  `coverage/coverage-summary.json` (number = overall lines, object = per
  metric); `ci.noAny` AST-scans changed TS files via the project's `typescript`
  and reports `file:line`; `ci.maxBundleMb` stats the built bundle
  (`ci.bundlePath` or auto-detected Expo/bare locations, maps excluded).
  Artifact-backed gates fail with instructions when their artifact is missing —
  an enabled gate never silently passes.
- Tests: `test/{ci-command,ci-gates,github-reporter}.test.ts`.

### ✅ HTML report _(0.3.0)_
- `src/core/reporter/html.ts` — one self-contained file (inline CSS, no
  scripts), summary tiles + gates + per-check table + five-part issues grouped
  by Inspector. `ci --html [path]`, default `rn-guardian-report.html`.
  Issue text is clamped so a minified file in the diff can't balloon the report
  (found by dogfooding: one ESLint message quoted a 3 MB expression).

---

## 0.5.0 — quality score

### ⬜ Score model
- Per-inspector sub-scores (0–100) → weighted overall; **every number traceable
  to the specific issues that reduced it** (store the deductions).
- Deliberately deferred until the rule base is broad enough to be credible.
- Files: new `src/core/score.ts`, surfaced in terminal + HTML + JSON reporters.

---

## 1.0.0 — stable platform

### ⬜ Freeze the plugin API
- Finalize `Plugin` / `Check` / `Issue`; document; semver-guarantee them.

### ⬜ Package split
- Extract `@guardian/core` + `@guardian/react-native` from the enforced module
  boundary (the dependency-cruiser rule already guarantees the seam is clean).
- Convert `rn-guardian` into a thin meta-package depending on both.

### ⬜ Docs site & links
- Stand up the docs site and set `RN_GUARDIAN_DOCS_BASE` (see `src/core/docs.ts`)
  so every rule's `docsUrl` activates.
- Husky + lint-staged migration guide.

---

## 2.0.0 — beyond React Native

### ⬜ Second framework plugin
- Add `@guardian/next` or `@guardian/node` implementing the `Plugin` interface —
  the real proof the core is framework-agnostic.

### ⬜ Quality-trend tracking
- Persist scores per commit; show deltas over time.
