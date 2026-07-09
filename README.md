# rn-guardian

[![CI](https://github.com/paramababu/rn-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/paramababu/rn-guardian/actions/workflows/ci.yml)

A fast, **fully local** developer quality engine for React Native. One tool that
replaces the Husky + lint-staged + assorted-scripts stack, understands your
project, fixes what it safely can, and explains the rest.

**No AI. No network. No API keys.** Every check is deterministic static analysis
that runs on your machine — reproducible, auditable, and enterprise-friendly.

> Status: **v0.1** — the foundation. See [`PLAN.md`](./PLAN.md) for the full
> product and technical plan and the roadmap beyond this release.

---

## Why not just Husky + lint-staged?

Those run commands and dump raw errors. rn-guardian *understands* the project:
it groups findings into **Inspectors**, and every issue answers four questions —
**Problem → Why it matters → Impact → How to fix** — so a failed commit teaches
instead of just blocking. (A hosted `Docs` link per rule is wired in but
disabled until the docs site is live, so no dead links ship.)

```
✗ Security Inspector — 1 issue

  src/Login.tsx:4  error
  ────────────────────────────────────────
  Problem A sensitive value is being written to AsyncStorage.
  Why     AsyncStorage is unencrypted plain text — on Android it is a
          world-readable file inside the app sandbox…
  Impact  A stolen device can exfiltrate the user's session token.
  Fix     Use expo-secure-store (Keychain/Keystore) or react-native-keychain.
```

## Install

```bash
npm install --save-dev rn-guardian
npx rn-guardian init
```

`init` detects your project (Expo vs. bare, TypeScript, ESLint/Prettier, package
manager), asks one question — the **Profile** — writes `guardian.config.json`,
adds a `prepare` script, and installs the git hooks. Commit as usual.

## Profiles

Most developers never edit config. Pick a profile and go:

| Profile | What runs |
|---|---|
| **Minimal** | formatting + lint + secrets. The 3-second floor. |
| **Standard** (default) | + RN performance & a11y, console.log, large assets. |
| **Strict** | + TypeScript at pre-commit, tighter thresholds. |
| **Enterprise** | Strict + CI team-rule gates (coverage, no-any, max bundle). |

Override anything in `guardian.config.json` when you outgrow a profile.

## The tiers (protecting the 3-second promise)

A slow hook gets `--no-verify`'d into the grave, so work is split by budget:

- **pre-commit** (≤ 3s): Prettier, ESLint, console.log, merge markers, secrets,
  large assets — staged files only.
- **pre-push** (~30s): TypeScript, tests, circular deps, the Bundle Advisor.
- **`rn-guardian ci`**: the full sweep, no budget.

TypeScript is deliberately **not** at pre-commit by default — opt in with
`checks.typescript.tier: "commit"`.

## Commands

```bash
rn-guardian init         # detect, pick a profile, install hooks
rn-guardian install      # (re)install hooks (the prepare-script target)
rn-guardian uninstall    # remove rn-guardian's managed hook blocks
rn-guardian run          # run a tier's checks (the hook calls this)
rn-guardian check        # read-only "what would fail?" scan of staged changes
rn-guardian ci           # full sweep over the PR diff, gates + GitHub annotations
rn-guardian fix          # apply safe fixes; confirm & apply suggested ones (console.log, …)
rn-guardian explain      # full problem→why→fix for each staged issue
```

Add `--json` to `run`/`check`/`ci` for machine-readable output.

### In CI (GitHub Actions)

`rn-guardian ci` runs every check across all tiers (no time budget) over the PR
diff — `git diff <base>...HEAD` by default, or the whole tree with `--all` — and
prints inline `::error`/`::warning` annotations plus a job-summary table.
Annotations turn on automatically inside Actions.

```yaml
- run: npx rn-guardian ci        # exits non-zero on an error or a tripped gate
```

Team-rule gates live in the config's `"ci"` block:

```json
{ "ci": { "failOn": "warning", "maxWarnings": 0 } }
```

`failOn: "warning"` makes any warning fail the build; `maxWarnings: N` caps them.

## What it checks today

Generic (any JS/TS project): **Prettier**, **ESLint** (your config + version,
v8 or v9), **console.log / debugger**, **merge conflict markers**.

React Native plugin:

- **Security** — tokens/secrets in AsyncStorage, hardcoded JWTs & API keys,
  plaintext `http://` endpoints.
- **Performance** — `FlatList` missing `keyExtractor`, inline `style={{…}}`
  objects, anonymous inline `renderItem`, a virtualized list nested inside a
  `ScrollView`, oversized bundled images.
- **Accessibility** — touchables and images with no `accessibilityLabel`.

The performance/accessibility rules ship as real **ESLint rules** (AST-grade) and
run through your project's own ESLint when it's installed — so they see the true
syntax tree, not text. When ESLint (or a JSX parser) isn't resolvable they fall
back to a small brace-aware JSX scanner that still correctly ignores `=>` and `>`
inside expressions. Either way they're advisory (warnings) and honor explicit
opt-outs like `accessible={false}`.

Coming next (see `PLAN.md`): the React Navigation inspector, richer `ci` gates
(coverage, no-any, max bundle), and a self-contained HTML report.

### v0.1 limitations (read before relying on it)

- **Safe fixes auto-apply; unsafe ones are confirm-only.** Prettier and ESLint
  `--fix` run automatically during a commit and re-stage. `console.log` /
  `debugger` removal alters code, so it's applied through **`rn-guardian fix`**
  (interactive confirmation in a real terminal, since git hooks don't get a TTY
  on stdin) rather than silently during the commit. The pre-commit summary
  points you to it.
- **RN performance/accessibility rules are AST-grade when ESLint is present**,
  falling back to a fast brace-aware JSX scan otherwise. The fallback can throw
  the occasional false positive; either way they're warnings, never commit
  blockers, and honor opt-outs.
- **Rule docs links are disabled** until the docs site exists.
- **Not yet dogfooded on a large app** — the ≤ 3s pre-commit budget is designed
  for and verified on small fixtures, but not yet measured against a big
  real-world React Native project.

## Design principles

1. **≤ 3 second** pre-commit budget, always.
2. **Fully local and deterministic** — no AI, no network, no keys.
3. **Every issue is explainable** — never a bare error string.
4. **Safe autofix only, always visible** — deterministic fixes auto-apply and
   re-stage; anything that alters logic asks first and never runs in CI.
5. **Zero config to start, config to grow.**
6. **Coexist, don't conquer** — chains into an existing Husky/lefthook setup.

## Architecture

The engine is **framework-agnostic**; React Native is the first `Plugin`. A
build-time boundary (dependency-cruiser) guarantees `core/` never imports a
plugin, so the future split into `@guardian/core` + `@guardian/react-native` is
a clean extraction. Plugin authors implement the `Plugin` / `Check` interfaces.

## Development

```bash
npm install
npm run build            # tsup → dist/
npm test                 # vitest
npm run typecheck        # tsc --noEmit
npm run guard:boundaries # verify core never imports plugins
```

## License

MIT
