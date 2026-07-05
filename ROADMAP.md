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

### ⬜ Real-world dogfood on a full app
- Generate a real Expo app (`npx create-expo-app`) and a bare RN app; install the
  packed tarball; run `init` and real commits.
- Extend `dogfood/harness.mjs` with a `--mode full` that (optionally) drives a
  real generated app instead of the synthetic scaffold.
- **Acceptance:** measured warm pre-commit ≤ 3s on ≥ 200 source files with the
  app's real ESLint config; publish the numbers in the CHANGELOG.

### ⬜ Ignore file support
- Add `.rn-guardianignore` (gitignore syntax) honored by `core/git/staged.ts`
  when building the staged-file set, plus a `checks.<id>.exclude` glob option in
  config.
- Files: `src/core/git/staged.ts`, `src/core/config/load.ts`, new
  `src/core/util/ignore.ts` (tiny glob matcher, no dep).
- **Acceptance:** a path in `.rn-guardianignore` never appears in any check.

### ⬜ Reduce heuristic false positives
- `rn-performance` / `rn-accessibility`: skip files that don't import from
  `react-native`; treat a touchable with a `<Text>` child as labeled.
- Files: `src/plugins/react-native/checks/{performance,accessibility}.ts`,
  `src/plugins/react-native/jsx.ts` (add a cheap child-text scan).
- **Acceptance:** new fixtures for the false-positive cases pass clean.

### ⬜ `explain` replay cache
- Persist the last run's report JSON to
  `node_modules/.cache/rn-guardian/last-run.json`; `explain` reads it instead of
  re-scanning.
- Files: `src/commands/{run,explain}.ts`, new `src/core/cache.ts`.
- **Acceptance:** `explain` after a `run` prints the same findings without
  re-executing checks (assert via a timing/marker).

---

## 0.2.0 — pre-push tier & AST-grade RN rules

Goal: turn on the second tier and upgrade the RN rules where heuristics aren't
good enough.

### ⬜ Pre-push tier wired end-to-end
- Implement checks at `tier: "push"`: incremental TypeScript
  (`tsc --noEmit --incremental`, cache under `node_modules/.cache/rn-guardian/`),
  affected Jest (`--findRelatedTests --changedSince`), circular deps (madge on
  the changed subgraph), duplicate deps (lockfile scan), Bundle Advisor
  (moment→dayjs, lodash→lodash-es, full firebase imports).
- Files: new `src/core/checks/typescript.ts`, `src/plugins/react-native/checks/`
  (bundle-advisor, jest, circular), register in `registry.ts` / plugin.
- The pre-push hook block already exists (`core/hooks/install.ts`) — just needs
  these checks enabled at the push tier.
- **Acceptance:** `run --tier push` executes them; commit path stays untouched
  and under budget.

### ⬜ RN ESLint rule pack (injectable)
- Ship the heuristic rules as real ESLint rules under
  `src/plugins/react-native/eslint-plugin/`, injected into the user's ESLint run
  (already the plan in `eslint.ts`), giving AST accuracy. Keep the JSX-scanner
  versions as a fallback when ESLint isn't installed.
- Rules: `flatlist-key-extractor`, `no-inline-style-object`,
  `no-anonymous-render-callback`, `no-nested-scrollview`,
  `touchable-accessibility-label`, `image-accessibility`.
- **Acceptance:** rules fire through the project's ESLint; `rn-performance`
  heuristic check defers to them when present.

### ⬜ Navigation & Expo inspectors
- React Navigation: unregistered / duplicate / unused screen detection by parsing
  navigator definitions and `navigation.navigate("…")` call sites.
- Expo: `app.json` / `app.config.*` — unused Android permissions, missing iOS
  usage-description strings.
- Files: new checks under `src/plugins/react-native/checks/`.

---

## 0.3.0 — CI command & reporting

### ⬜ `rn-guardian ci`
- Tier-3 runner (no budget): full ESLint/tsc/Jest with coverage, dead code
  (knip), dependency audit, bundle-size estimate + diff vs. base branch.
- Output: JSON + **GitHub Actions annotations** (`::error file=…,line=…::`).
- Enterprise team-rule gates from config: `ci.coverage`, `ci.noAny`,
  `ci.maxBundleMb`.
- Files: new `src/commands/ci.ts`, `src/core/reporter/github.ts`.
- **Acceptance:** a failing gate exits non-zero and annotates the PR.

### ⬜ HTML report
- `src/core/reporter/html.ts` — self-contained HTML (inline CSS) summarizing a
  run, written to `rn-guardian-report.html`.

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
