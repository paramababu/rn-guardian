# Changelog

All notable changes to **rn-guardian** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
This file also carries the forward-looking **version plan** (the `Planned`
section) — it is kept up to date as the roadmap in [`PLAN.md`](./PLAN.md) is
delivered. Dates are ISO (YYYY-MM-DD).

## [Unreleased]

_Nothing yet._

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

### [0.2.0] — pre-push tier & more RN rules
- Pre-push tier wired: incremental TypeScript, affected Jest, circular deps
  (madge), duplicate deps, the Bundle Advisor.
- Custom RN ESLint rule pack shipped as an injectable plugin (upgrading the
  current heuristic checks to AST-grade where it pays off).
- Navigation (React Navigation) and Expo-config inspectors.

### [0.3.0] — CI & reporting
- `rn-guardian ci`: full suite, JSON + GitHub annotations, coverage/team-rule
  gates (no-any, max bundle).
- HTML report.

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

[Unreleased]: https://github.com/paramababu/rn-guardian/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/paramababu/rn-guardian/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/paramababu/rn-guardian/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/paramababu/rn-guardian/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/paramababu/rn-guardian/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/paramababu/rn-guardian/releases/tag/v0.1.0
