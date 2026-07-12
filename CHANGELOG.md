# Changelog

All notable changes to **rn-guardian** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
This file also carries the forward-looking **version plan** (the `Planned`
section) — it is kept up to date as the roadmap in [`PLAN.md`](./PLAN.md) is
delivered. Dates are ISO (YYYY-MM-DD).

## [Unreleased]

_Nothing yet._

## [0.2.2] — 2026-07-12

Closes the long-open **0.1.2 acceptance criterion**: the pre-commit promise is
now measured on a *real generated app*, not just the synthetic scaffold.

### Added
- **Dogfood harness full mode** (`node dogfood/harness.mjs --mode full`).
  Generates a real Expo app (`create-expo-app`, default template) — or a bare RN
  app with `--app bare` — installs its real dependencies, tops it up to 220
  source files with realistic screens, installs the packed tarball, runs `init`,
  and times two scenarios: the initial all-files stage (worst case,
  informational) and a typical `--staged` 15-file delta commit (budget-gated).

### Changed
- The **`eslint` check now uses ESLint's result cache**
  (`node_modules/.cache/rn-guardian/eslint-cache.json`), so unchanged files are
  not re-linted on the next commit attempt. On the dogfood Expo app (206 staged
  files, real `eslint-config-expo`), the check dropped from ~16s cold to ~4s on
  a repeat run — and ESLint invalidates the cache itself when file contents or
  the resolved config change. Best-effort: an uncreatable cache dir never breaks
  the check.

### Fixed
- **Installable in bare React Native apps.** The community-CLI template pins
  `prettier@2.8.8`, and our `prettier@">=3"` optional peer range made
  `npm install rn-guardian` fail outright there (found by the full-mode bare-app
  dogfood). The format check only uses `resolveConfig` / `getFileInfo` /
  `check` / `format`, which behave identically under `await` in Prettier 2's
  sync API — the peer range is now `">=2"`.

### Measured (0.1.2 acceptance)
Real generated apps, 220 source files each, standard profile, the app's own
lint setup, Apple M1 / 8 GB. Budget: warm delta-commit ≤ 3000ms.

| scenario (wall clock) | Expo (`create-expo-app`, flat config) | bare RN (community CLI, eslintrc + prettier 2) |
| --- | --- | --- |
| typical 15-file delta commit, warm median | **974ms** ✓ | **1063ms** ✓ |
| typical 15-file delta commit, cold | 2097ms | 1555ms |
| initial commit, every file staged (informational) | 9288ms (206 files) | 4500ms (266 files) |

False-positive noise check: across both apps the templates' own files produced
**one** finding total (a Prettier style disagreement on Expo) — every other
finding was deliberately seeded.

## [0.2.1] — 2026-07-09

First cut of the **0.3.0 "CI & reporting" milestone**: the `rn-guardian ci`
command. Still dependency-free (two runtime deps).

### Added
- **`rn-guardian ci`** (`src/commands/ci.ts`) — a tier-3 sweep with no time
  budget. Runs **every enabled check across all tiers at once** over the PR diff
  (`git diff <base>...HEAD`, merge-base scoped) — or the whole tree with `--all`.
  Base ref resolves from `--base`, then `GITHUB_BASE_REF`, then the usual main
  branches; a shallow checkout falls back to a full scan. Never autofixes.
- **GitHub Actions output** (`src/core/reporter/github.ts`). Each finding becomes
  an inline `::error`/`::warning` annotation on the PR diff (properly escaped
  workflow commands), and a markdown table is appended to `$GITHUB_STEP_SUMMARY`.
  Annotations turn on automatically inside Actions (`GITHUB_ACTIONS=true`) or with
  `--annotate`; `--json` emits the full machine-readable report.
- **Team-rule gates** from the config `"ci"` block (`src/core/ci/gates.ts`):
  `ci.failOn: "warning"` promotes any warning to a build failure, and
  `ci.maxWarnings: N` caps remaining warnings. A tripped gate exits non-zero and
  annotates the PR at the job level. (Coverage / no-any / bundle-size gates are
  still planned — they need heavier machinery.)

### Changed
- The runner gained a **multi-tier sweep** (`RunOptions.runTiers`) so `ci` can run
  commit + push + ci checks in one pass; the single-tier hook path is unchanged.
- `reportToObject` split out of `toJson` so `ci` can extend the report with its
  `scope` and `gates` result.

## [0.2.0] — 2026-07-09

Completes the **0.2.0 milestone**: the pre-push tier (shipped in 0.1.3/0.1.4) plus
the headline **AST-grade React Native rule pack**. Still zero network, still no
AI — ESLint and its parser are optional peer tools resolved from the project.

### Added
- **Injectable RN ESLint rule pack** (`rn-eslint-rules`, RN plugin). The RN
  performance and accessibility inspectors now ship as real ESLint rules
  (`src/plugins/react-native/eslint-plugin/`) — `flatlist-key-extractor`,
  `no-inline-style-object`, `no-anonymous-render-callback`, `no-nested-scrollview`
  (new), `touchable-accessibility-label`, `image-accessibility`. They run in an
  isolated instance of the **project's own ESLint** (resolved locally, so your
  exact version and parser), giving true AST accuracy in place of the JSX-scanner
  heuristics. Findings keep the full five-part shape (problem → why → impact →
  fix) — the rule renders the problem, `eslint-plugin/meta.ts` supplies the rest.
- **`no-nested-scrollview`** — a virtualized list (FlatList/SectionList/…) nested
  inside a same-axis `ScrollView` silently disables windowing (RN warns about this
  at runtime); the AST rule catches it statically. No heuristic equivalent.

### Changed
- **Heuristics defer to the AST rules when available.** `enrichReactNative`
  probes for ESLint + a JSX-capable parser and sets `framework.astRules`; when
  set, the `rn-performance` / `rn-accessibility` JSX-scanner checks stand down and
  the AST pack runs instead — no double-reporting. When ESLint (or, for a
  TypeScript project, `@typescript-eslint/parser`) isn't resolvable, the
  dependency-free heuristics run exactly as before. Enabled in standard / strict /
  enterprise; off in minimal.
- Works under both ESLint config systems: flat config (v9+) and legacy eslintrc
  (v8), injected programmatically — nothing is written to the user's config.

## [0.1.4] — 2026-07-06

Completes the **pre-push tier** (the first half of the 0.2.0 milestone) — all
dependency-free, keeping the tool at two runtime dependencies. The remaining
0.2.0 headline, the AST-grade injectable ESLint rule pack, is still to come.

### Added
- **Affected tests** (`affected-tests`, core, `tests` inspector). Runs the
  project's own Jest against only the tests related to the staged files
  (`jest --findRelatedTests`), at the `push` tier. Resolves and spawns the user's
  local Jest — no dependency added — and skips cleanly when Jest isn't installed.
- **Circular-import detector** (`circular-deps`, core, `hygiene` inspector). Walks
  relative imports out from the staged files and reports any import cycle
  (`a → b → a`), with a guarded node cap. Dependency-free; deliberately scoped to
  relative imports (bare/aliased specifiers need a full resolver — the madge
  dependency we chose not to take).
- **Expo config inspector** (`expo-config`, RN plugin, `security` inspector).
  Cross-checks `app.json`: a sensitive Android permission (CAMERA, RECORD_AUDIO,
  location, contacts, …) with no matching iOS usage-description string in
  `ios.infoPlist` is flagged — that combination crashes the iOS build or fails
  App Review. Runs when `app.json` is staged; `app.config.js/ts` is noted, not
  evaluated.

### Changed
- **TypeScript check is now incremental.** Uses `createIncrementalProgram` with a
  `.tsbuildinfo` cache under `node_modules/.cache/rn-guardian`, so a repeat push
  only re-checks what changed. The build-info is persisted via a write hook that
  keeps only the `.tsbuildinfo` and discards all JS/`.d.ts` — nothing lands in
  your tree. Falls back to a plain program when unavailable.

## [0.1.3] — 2026-07-06

First cut of the **Dependency Advisor** and the pre-push tier — the start of the
0.2.0 milestone. Both checks default to the `push` tier (bundle weight and
duplicate versions are "before it leaves your machine" concerns, not per-commit).

### Added
- **Bundle Advisor** (`bundle-advisor`, RN plugin, `dependency` inspector). Flags
  import patterns that bloat the JS bundle: `moment` (→ day.js / date-fns), a
  barrel `import … from "lodash"` (→ per-method or `lodash-es`), and the full /
  `firebase/compat` SDK surface (→ modular v9+). Pure source scan; warnings only.
- **Duplicate-dependency advisor** (`duplicate-deps`, core, `dependency`
  inspector). Reads `package-lock.json` (lockfileVersion 1/2/3) or a classic
  `yarn.lock` and warns when one package resolves to multiple versions (bundle
  bloat + singleton bugs like "invalid hook call"). Runs only when a lockfile or
  `package.json` is part of the staged change; pnpm's YAML lock is skipped with a
  note rather than mis-parsed.
- Both wired into the profiles: enabled at `push` for standard / strict /
  enterprise, disabled in minimal.

## [0.1.2] — 2026-07-06

### Added
- **TypeScript check.** `tsc --noEmit` via the project's own TypeScript compiler
  (resolved locally, no hard dependency). Compiles the program once, then reports
  only the diagnostics that land in the **staged** files — so a commit is never
  blocked by pre-existing errors elsewhere. Defaults to the `push` tier; `strict`
  and `enterprise` promote it to `commit`. This closes the gap where every
  profile advertised a `typescript` check that no code implemented.
- **`.rn-guardianignore`** (gitignore syntax) — paths matched here are removed
  from every check. Plus a per-check `checks.<id>.exclude` glob array in config.
  Backed by a tiny dependency-free matcher (`core/util/ignore.ts`).
- **`explain` replay cache.** `run` now persists the report to
  `node_modules/.cache/rn-guardian/last-run.json`; `explain` replays it instantly
  (labelled *"(last run)"*) instead of re-scanning, falling back to a live scan
  when no cache exists.

### Fixed
- **Fewer RN heuristic false positives.** `rn-performance` and
  `rn-accessibility` now skip files that never import from `react-native`, and a
  touchable wrapping a `<Text>` child is treated as labeled (RN derives the
  accessibility label from it).

## [0.1.1] — 2026-07-05

### Added
- **`rn-guardian fix` command.** Applies safe fixes (Prettier, ESLint)
  automatically, then interactively confirms and applies the *unsafe* ones —
  `console.log` / `debugger` removal — in a real terminal, and re-stages. Use
  `--yes` to apply everything non-interactively (CI/scripts).
- Reporter now hints `→ N files with auto-fixable issues — run rn-guardian fix`
  in the pre-commit summary.
- `gitRoot` exposed on the engine result so commands can re-stage after applying
  their own fixes.

### Fixed
- **Piped `--json` output truncation.** `cli.ts` called `process.exit()` before
  a large async stdout write could flush, so reports over ~64 KB were cut off
  when captured by a pipe (CI or another tool). Now sets `process.exitCode` and
  lets Node drain stdout. _(Found by the dogfood harness.)_

### Notes
- `console.log` / `debugger` are now genuinely fixable (via `fix`), closing the
  main v0.1.0 functional gap. They remain confirm-only, never auto-removed
  during a commit, per the safe-autofix principle.

## [0.1.0] — 2026-07-05

Initial public release.

### Added
- CLI: `init` (with Profiles), `install` / `uninstall` (Husky-chaining),
  `run` (hook target), `check`, `explain`.
- Tiered git hooks with a ≤ 3s pre-commit budget (commit / push / ci).
- Profiles: Minimal / Standard / Strict / Enterprise, chosen at `init`.
- Generic checks: Prettier, ESLint (v8 & v9), console.log/debugger, merge
  markers.
- React Native plugin: secrets in AsyncStorage, hardcoded keys/JWTs, plaintext
  `http://`, oversized assets, and heuristic performance + accessibility
  inspectors via a brace-aware JSX scanner.
- Explainable output (Problem → Why → Impact → Fix) grouped by Inspector;
  `--json` for tooling.
- Safe autofix that applies and re-stages, with correct CI blocking semantics.
- Framework-agnostic core with React Native as the first plugin; boundary
  enforced by dependency-cruiser.
- Dogfood harness (`npm run dogfood`) measuring the pre-commit budget on a real
  ESLint/Prettier/TypeScript toolchain (~750ms for 38 files).

---

## Planned

Forward-looking version plan. Subject to change; tracked against
[`PLAN.md`](./PLAN.md).

### [0.1.2] — hardening _(shipped, see above)_
- Remaining: real-world dogfood on a large Expo/bare app with published timings
  (`dogfood/harness.mjs --mode full`).

### [0.2.0] — pre-push tier & more RN rules _(shipped, see above)_
- Remaining: React Navigation inspector (unregistered / duplicate / unused
  screens) — deferred; it wants the same AST that the ESLint rule pack now
  establishes, so it slots in next.

### [0.3.0] — CI & reporting
- ✅ `rn-guardian ci`: full suite over the PR diff, JSON + GitHub annotations,
  `failOn` / `maxWarnings` team-rule gates. _(shipped in 0.2.1, see above)_
- Remaining: coverage / no-any / max-bundle gates, and the self-contained HTML
  report (`src/core/reporter/html.ts`).

### [0.5.0] — quality score
- Per-inspector sub-scores → overall score, each number traceable to specific
  issues (deliberately deferred until the rule base is credible).

### [1.0.0] — stable platform
- Public, frozen plugin API (`Plugin` / `Check`).
- Package split into `@guardian/core` + `@guardian/react-native`.
- Docs site (activates the per-rule `docsUrl` links) and a Husky+lint-staged
  migration guide.

### [2.0.0] — beyond React Native
- A second framework plugin (Next.js or Node) proving the core is truly generic.
- Quality-trend tracking across commits.

[Unreleased]: https://github.com/paramababu/rn-guardian/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/paramababu/rn-guardian/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/paramababu/rn-guardian/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/paramababu/rn-guardian/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/paramababu/rn-guardian/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/paramababu/rn-guardian/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/paramababu/rn-guardian/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/paramababu/rn-guardian/releases/tag/v0.1.0
