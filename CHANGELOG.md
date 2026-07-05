# Changelog

All notable changes to **rn-guardian** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
This file also carries the forward-looking **version plan** (the `Planned`
section) — it is kept up to date as the roadmap in [`PLAN.md`](./PLAN.md) is
delivered. Dates are ISO (YYYY-MM-DD).

## [Unreleased]

_Nothing yet._

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

### [0.1.2] — hardening
- Real-world dogfood on a large Expo/bare app; publish measured timings.
- Reduce false positives in the heuristic RN rules; `.rn-guardianignore` support.
- `explain` replay cache (re-print the last hook run without re-scanning).

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

[Unreleased]: https://github.com/paramababu/rn-guardian/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/paramababu/rn-guardian/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/paramababu/rn-guardian/releases/tag/v0.1.0
