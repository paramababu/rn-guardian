# rn-guardian — Product & Technical Plan

> A fast, fully local **developer quality engine**: a framework-agnostic core
> that replaces the Husky + lint-staged + assorted-scripts stack, launching
> React Native–first. It understands the project, fixes what it safely can, and
> explains the rest. No AI, no network, no API keys — pure static analysis.

## 0. Strategic frame (identity vs. architecture)

Two decisions that are deliberately kept separate:

- **Architecture is framework-agnostic.** The core knows nothing about React
  Native. RN is the *first plugin*. React, Next.js, Node, and Expo are future
  plugins that slot into the same engine with no rewrite. The `Check` interface
  (§3) already makes this nearly free — so we pay for scalability up front where
  it's cheap.
- **Go-to-market is React Native–first.** We launch, brand, and market as *the*
  React Native quality tool. RN is the wedge: it's the discoverability, the
  r/reactnative launch story, and the gap no existing tool fills ("nobody deeply
  understands React Native"). We win RN completely, *then* let the generic core
  expand our identity — not the other way around.

The trap we're avoiding: a generic-from-day-one tool reads as "another lint
runner" (there are many) and has no wedge. Generic *core*, RN *brand*.

---

## 1. Positioning

**One-liner:** "ESLint + Husky + react-native doctor, unified — one `npx rn-guardian init`, fully local."

**Who it's for:** React Native teams (Expo and bare) who currently hand-roll
pre-commit quality gates and get noisy, unhelpful failures.

**What it is not:** not a CI platform, not an AI product (no AI features, no API
keys, ever — all analysis is deterministic and local), not a replacement for
ESLint/Prettier/TypeScript — it *orchestrates* them and adds RN-specific
intelligence on top.

### Competitive landscape

| Tool | What it does | Gap rn-guardian fills |
|---|---|---|
| Husky + lint-staged | Runs commands on staged files | No understanding, no fixing loop, raw error dumps |
| lefthook | Fast polyglot hook runner | Same — pure command runner |
| react-native doctor | Env/setup diagnostics | One-shot, not code-quality, not a hook |
| eslint-plugin-react-native / -a11y | Individual rule packs | Must be discovered, installed, configured by hand |
| madge / knip / dependency-cruiser | Circular deps, dead code | Standalone CLIs, not integrated or staged-aware |
| Danger.js | PR-time review automation | PR-time only, JS-generic, config-heavy |

The differentiator is **orchestration + RN awareness + a fix-first UX**, not any
individual check. Most checks exist somewhere; nobody has unified them with
zero-config detection and beautiful output.

**North-star promise — how we market it:** not *"50 React Native checks."* Check
counts are a race to the bottom and nobody chooses a tool by them. The promise
is **"the best developer experience for React Native quality."** If the terminal
output is beautiful, the explanations genuinely teach, and developers save time
every single day, they recommend it regardless of the check count. Every roadmap
priority is ranked by "does this improve the daily experience," which is why the
reporter and explainable output outrank breadth of checks.

---

## 2. Design principles (non-negotiable)

1. **Speed budget: ≤ 3 seconds** for the pre-commit path on a typical commit
   (≤ 20 changed files). Anything that can't fit moves to pre-push or `ci`.
   A slow hook gets `--no-verify`'d, then uninstalled. Every check is
   staged-files-only and cached where possible.
2. **Fully local and deterministic.** Zero network, zero API keys, no AI. The
   same input always produces the same result — a quality gate must be
   reproducible and auditable.
3. **Every issue is explainable — this is the product, not a feature.** No issue
   is ever a bare error string. Each one answers, in order: **Problem → Why it
   matters → Impact → How to fix → Docs.** This curated, hand-written knowledge
   (no AI) is what makes the tool feel intelligent, and it's the highest-priority
   thing we build. The reporter and this knowledge base are the moat; the checks
   themselves are commodity.
4. **Safe autofix only, always visible.** Deterministic fixes (Prettier, ESLint
   `--fix`, import sorting) apply automatically and are re-staged with a summary
   of what changed. Anything that alters logic requires an interactive
   preview-and-confirm, and never runs in non-TTY/CI environments.
5. **Zero config to start, config to grow.** `init` detects Expo vs. bare, TS vs.
   JS, existing ESLint/Prettier setups, and package manager, then asks one
   question — the **Profile** (§5) — and produces a working setup. Most
   developers never open the config file.
6. **Coexist, don't conquer.** If Husky or lefthook is already installed, chain
   into it instead of fighting over `.git/hooks`. Respect existing ESLint and
   Prettier configs; add, never replace.

---

## 3. Architecture

### The split: framework-agnostic core, RN as the first plugin

The engine (git, runner, config, reporter, autofix, the `Check` contract, the
generic checks like Prettier/ESLint/tsc/hygiene) knows nothing about React
Native. Everything RN-specific — the custom rule pack, Expo/bare detection,
AsyncStorage-secret checks, navigation validation — lives behind the `Check`
interface as a **framework plugin**. Adding React, Next.js, or Node later means
writing a new plugin, not touching the core.

### But ship v0.1 as ONE package, split when the plugin API is public

A published multi-package monorepo on day one buys versioning and
plugin-resolution overhead before anyone uses it. So v0.1–v0.2 is a *single*
`rn-guardian` package whose **internal module boundaries already respect the
split** (`core/` never imports `plugins/react-native/`). When the plugin API
goes public (v1.0), we extract `@guardian/core` + `@guardian/react-native`
cleanly along boundaries we've already been enforcing. Clean seams now, package
split later.

```
rn-guardian/                 # one published package for v0.1–v0.2
├── src/
│   ├── cli/                 # entry: init, run (hook target), check, ci, fix
│   ├── core/                # ── framework-agnostic; never imports plugins/ ──
│   │   ├── config/          # load + validate guardian.config.{ts,js,json}
│   │   ├── project/         # generic detection: TS, ESLint version, pkg mgr, monorepo
│   │   ├── git/             # staged files, partial-stage stash dance, re-staging
│   │   ├── runner/          # pipeline: ordering, parallelism, per-check timing
│   │   ├── reporter/        # terminal renderer (the star of the show) + json
│   │   ├── autofix/         # apply/restage fixes, interactive confirm for unsafe ones
│   │   └── checks/          # generic checks: prettier, eslint, typescript, hygiene
│   └── plugins/
│       └── react-native/    # ── the RN plugin: everything RN-aware lives here ──
│           ├── detect.ts    # expo vs. bare, RN version, Expo SDK
│           ├── eslint-plugin/# custom RN rules, also exported as "./eslint-plugin"
│           ├── secrets.ts    # JWT/token-in-AsyncStorage, SecureStore suggestions
│           └── checks/       # navigation routes, large assets, bundle advisor
├── PLAN.md
└── package.json             # bin: { "rn-guardian": "dist/cli.js" }
```

Future published shape (v1.0+): `@guardian/core`, `@guardian/react-native`,
`@guardian/next`, `@guardian/node`, … — each a set of `Check`s.

### Core abstraction

```ts
interface Plugin {
  id: string;                          // "react-native", "next", "node"
  detect(ctx: ProjectContext): boolean;// is this the project's framework?
  checks: Check[];
}

interface Check {
  id: string;                          // "eslint", "rn/flatlist-key", ...
  inspector: InspectorId;              // "performance" | "security" | "a11y" | ...
  tier: 'commit' | 'push' | 'ci';      // where it's allowed to run
  appliesTo(ctx: ProjectContext): boolean;
  run(files: StagedFile[], ctx: ProjectContext): Promise<CheckResult>;
}

interface Issue {
  file: string; line: number;
  problem: string;                     // what
  why: string;                         // why it matters
  impact?: string;                     // concrete consequence
  fix: { description: string; auto?: AutoFix }; // how to fix (+ optional safe autofix)
  docsUrl?: string;                    // deep-dive link
}

interface CheckResult {
  status: 'pass' | 'fixed' | 'warn' | 'fail';
  issues: Issue[];
  durationMs: number;
}
```

The core loads generic checks plus whichever framework `Plugin`s `detect()` the
project. Everything — generic built-ins, the RN plugin, future framework plugins
— is a `Check`. The public plugin API in v1.0 is just "export objects of these
shapes." RN is simply the first `Plugin` we ship.

### Two-level naming: Inspectors (user-facing) over Checks (internal)

`Check` stays the *internal* interface — it's the conventional, boring word a
plugin author expects, and boring is correct for an API contract. But users
never see "checks." The reporter groups checks into a handful of named
**Inspectors**, and that's the vocabulary of the whole product:

> Performance Inspector · Accessibility Inspector · Security Inspector ·
> Dependency Inspector · Bundle Advisor

Each `Check` declares which inspector it belongs to (`inspector: 'performance'`).
This gives us differentiated, memorable output ("⚠ Performance Inspector — 2
issues") without inventing a novel word for the thing plugin authors write.
Guardian *feels* different where it matters (the terminal) and stays familiar
where it matters (the code).

### Key technical decisions

- **Language/runtime:** TypeScript, Node ≥ 18, ESM. Bundle with `tsup`.
- **Dependencies: minimal.** `picocolors` for color, `@clack/prompts` for the
  interactive fix flow. No `simple-git` — shell out to `git` directly
  (`git diff --cached --name-only --diff-filter=ACMR -z`).
- **ESLint integration:** via the Node API (`loadESLint`) using the *project's*
  ESLint install, supporting both v8 legacy and v9 flat configs. Our RN rules
  ship as a bundled plugin injected into the run, so users get them without
  touching their config.
- **TypeScript check:** `tsc --noEmit --incremental` with a cached
  `.tsbuildinfo` under `node_modules/.cache/rn-guardian/`. First run is slow;
  subsequent runs are seconds. Report only errors touching staged files, but
  surface the total count.
- **Partially staged files** (the classic hard problem): copy lint-staged's
  battle-tested approach — stash unstaged changes, run/fix, re-stage, restore.
  v0.1 may simply detect partial staging and skip autofix for those files
  (report-only), which is safe; full stash dance lands in v0.2.
- **Hook installation:** write `.git/hooks/pre-commit` (and later `pre-push`)
  directly if unmanaged; if Husky/lefthook is detected, append our command to
  their config instead. `rn-guardian uninstall` reverses cleanly. Installed via
  the standard `"prepare": "rn-guardian install"` script.
- **Monorepos:** detect git root vs. package root; run per-workspace with each
  workspace's own config.

---

## 4. Check catalog, by tier

### Tier 1 — pre-commit (must fit the 3s budget)

**TypeScript is deliberately NOT here by default.** Even incremental `tsc` blows
the 3s budget on medium/large RN apps, and a blown budget is how a tool gets
`--no-verify`'d into the grave. `tsc` runs at pre-push; teams can opt it into
pre-commit explicitly (`checks.typescript.tier: "commit"`). Protecting the
3-second promise beats catching a type error 30 seconds earlier.

| Check | Autofix | Notes |
|---|---|---|
| Prettier | ✅ auto | Respects project config |
| ESLint (user config + our plugin) | ✅ auto (`--fix` safe fixes) | |
| `console.log` / `debugger` | ✅ confirm (remove or → logger) | Configurable logger mapping |
| Merge conflict markers | ❌ block | |
| Secrets: JWT/API keys in code, tokens in `AsyncStorage` | ❌ block + suggest SecureStore/Keychain | High-signal regex + AST |
| Large binary assets staged (> configurable KB) | ❌ warn + suggest compression | |

### Custom ESLint rule pack (`rn-guardian/eslint-plugin`) — the differentiator

Performance: `flatlist-key-extractor`, `no-nested-scrollview` (same
orientation), `no-inline-style-object` (opt-in), `no-anonymous-render-callback`
(FlatList `renderItem` etc.), `no-uncontrolled-image-size`.
Accessibility: `touchable-accessibility-label`, `image-accessibility`.
Security: `no-token-in-asyncstorage`, `no-http-url` (non-TLS endpoints).
Expo: `app-json-permissions` (unused Android perms, missing iOS usage strings).

Each rule ships with an **explanation** ("why this matters on a low-end Android
device"), not just a message — that's the "understands the project" promise,
delivered with hand-written, deterministic guidance.

### Tier 2 — pre-push (budget ~30s)

**TypeScript** (`tsc --noEmit --incremental`, cached `.tsbuildinfo`) — the
default home for type checking; report errors touching changed files, surface
the total. Jest on affected files (`--findRelatedTests --changedSince`), circular
dependencies (madge on changed subgraph), duplicate dependencies
(`npm ls`/lockfile scan), the **Bundle Advisor** (moment→dayjs, lodash→lodash-es,
full firebase imports — reports the heavy dep, the lighter alternative, and the
estimated KB saved), navigation route validation (React Navigation:
unregistered/duplicate/unused screens).

### Tier 3 — `rn-guardian ci` (no budget)

Full ESLint/tsc/Jest with coverage gate, dead code (knip), bundle-size estimate
+ diff vs. base branch, dependency audit, full a11y sweep, quality score,
HTML/JSON report, GitHub annotations output. Enterprise "team rules" (no `any`,
coverage ≥ N%, max bundle size) live here as configurable `ci` gates.

---

## 5. Configuration — Profiles first, config file second

Most developers never edit a config file. So the primary interface is a
**Profile** picked once at `init`: it decides which inspectors run, at which
tier, and how strict they are. (Framework — Expo vs. bare — is *auto-detected*,
never asked; it's a separate axis from the profile.)

```
npx rn-guardian init

  Choose a profile:
  ○ Minimal      formatting + lint + secrets. The 3s floor. Legacy repos.
  ● Standard     + RN performance & a11y inspectors, console.log, large assets.  (default)
  ○ Strict       + TypeScript at pre-commit, stricter RN rules, no warnings-as-pass.
  ○ Enterprise   Strict + CI team-rule gates (coverage, no-any, max bundle).
```

The config file is optional and only for teams that outgrow a profile — a
profile is just a named bundle of the settings below, and anything here
overrides the chosen profile:

```jsonc
// guardian.config.json (or .ts) — generated by `init`, everything optional
{
  "profile": "standard",               // Minimal | Standard | Strict | Enterprise
  "tiers": { "commit": true, "push": true },
  "checks": {
    "typescript": { "tier": "push" },          // promote to "commit" to opt in
    "console-log": { "fix": "logger", "logger": "src/utils/logger" },
    "large-assets": { "maxKb": 200 }
  },
  "rules": { "rn/no-inline-style-object": "off" },
  "ci": { "coverage": 80, "maxBundleMb": 15, "noAny": true }
}
```

---

## 6. Reporter — *this is the product*

Everyone can run ESLint. Nobody has a genuinely good pre-commit experience. The
reporter, plus the curated explanation knowledge base behind it, is the moat —
it's what people screenshot and what makes the tool feel intelligent without any
AI. Treated as core engineering, not polish.

**The issue block is the signature.** Every issue renders the same five-part
shape (§2, principle 3), grouped under its Inspector:

```
⚠ Performance Inspector

  src/Home.tsx:24
  ────────────────────────────────
  Problem   Inline style object passed to <View style={{…}}>
  Why       A new object is allocated on every render, defeating
            React's prop equality checks and triggering re-renders.
  Impact    Noticeable jank in long lists on low-end Android.
  Fix       Hoist to StyleSheet.create() outside the component.
  Docs      https://rn-guardian.dev/r/no-inline-style-object

  ✓ Auto-fixed 1 of 3 issues, re-staged.
```

Requirements: live per-Inspector spinner with per-check timing (`ESLint 650ms`);
issues grouped by Inspector then file, with code frames; the five-part block for
every issue; "N auto-fixed, re-staged" summary; interactive confirm-fix prompts
only when TTY; `--json` for tooling; graceful non-TTY/CI degradation.

## 6a. Commands

- `rn-guardian init` — detect project, pick Profile, install hooks.
- `rn-guardian install` / `uninstall` — (re)wire or cleanly remove hooks; `install` is the `prepare`-script target.
- `rn-guardian run` — the hook target (staged files, current tier). Not typed by humans.
- `rn-guardian check [path]` — run the full local suite on demand (all inspectors, ignores tiers). The manual "scan everything now" entry point.
- **`rn-guardian explain`** — re-print the last run's results as teaching material: what failed, what was auto-fixed, what remains, and the full five-part block + docs link for each remaining issue. Turns the tool into built-in documentation; costs us almost nothing since the knowledge base already exists. High-value, cheap — targeted for v0.2.
- `rn-guardian ci` — Tier 3, no budget, machine-readable output + GitHub annotations.

> **Naming note (`doctor`):** deliberately *not* using `doctor` for the code scan.
> In the RN/Expo world `react-native doctor` / `expo doctor` already mean
> *environment/toolchain* diagnostics (SDKs, CocoaPods, Node). Overloading it for
> code quality would mislead. `check` is the scan; if we ever add an
> environment-diagnostic command, *that* earns the name `doctor`.

---

## 7. Roadmap

| Version | Scope | Exit criterion |
|---|---|---|
| **v0.1** | `init` w/ **Profiles**, `install`/`uninstall`, hook chaining, staged-file detection, Prettier + ESLint + console.log + merge-marker checks, autofix + restage, and the **reporter with the five-part explainable issue block** — the reporter is a v0.1 headline, not a later polish item | Dogfood on a real RN app; commit path < 3s; the output is screenshot-worthy |
| **v0.2** | secrets + large-asset checks, first 6 custom ESLint rules (each with curated explanations), `explain` command, partial-staging stash dance | Installable on any Expo/bare app with zero config edits |
| **v0.3** | pre-push tier (**TypeScript incremental**, Jest affected, madge, dup deps, Bundle Advisor), `ci` command with JSON + GitHub annotations | Usable as the only quality gate in a small team |
| **v0.5** | HTML report, remaining rule pack (navigation, Expo config, a11y sweep) | |
| **v1.0** | **Quality score** (only now — needs a credible rule base first; per-inspector sub-scores → overall, each number traceable to specific issues), public plugin API (`Plugin`/`Check` stable), **package split** into `@guardian/core` + `@guardian/react-native`, docs site, Husky+lint-staged migration guide | Public launch (RN community, r/reactnative, X) |
| **v2.0** | Second framework plugin (Next.js or Node) proving the core is truly generic, quality-trend tracking, richer `ci` gates, community rules | |

**Distribution & naming:** launch identity is React Native–first. Publish the
installable CLI as `rn-guardian` (short, typeable, RN-discoverable); also claim
`react-native-guardian` as an alias so the namespace is protected — both are
currently free on npm. The generic engine ships later under the `@guardian/*`
scope (`@guardian/core`, `@guardian/react-native`, …) once the plugin API is
public; until then the split lives as internal module boundaries only. MIT
license. GitHub repo with a killer README GIF of the fix flow — for a DX tool,
that GIF *is* the marketing.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Hook too slow → `--no-verify` culture | Hard 3s budget, per-check timing in output, auto-suggest demoting slow checks to push tier |
| Breaking commits via bad autofix | Only deterministic fixes auto-apply; everything else previews; `uninstall` is one command |
| ESLint v8/v9 config schism | Use project's own ESLint via `loadESLint`; test matrix for both |
| Partially staged files corrupting work | lint-staged's stash approach; report-only fallback in v0.1 |
| Husky already installed | Detect and chain, never overwrite |
| RN ecosystem churn (new arch, Expo SDK cadence) | Version-aware `ProjectContext`; rules declare RN version ranges |
| "Yet another tool" fatigue | Zero-config init + visibly better output than the status quo within 60 seconds of install |

---

## 9. Immediate next steps (v0.1 task list)

1. Scaffold package: TypeScript + tsup + vitest, `bin` entry, CI for the repo itself. Set up the `core/` vs. `plugins/react-native/` directory seam and an ESLint/dependency-cruiser rule that **fails the build if `core/` imports from `plugins/`** — this guardrail is what makes the v1.0 package split painless.
2. `core/project/` generic detection (TS, ESLint version, package manager, monorepo, Husky presence) + `plugins/react-native/detect.ts` (Expo vs. bare, RN version) — with tests against fixture projects.
3. `core/git/` module: staged file listing, restage; partial-stage detection (report-only mode).
4. Hook installer (`install`/`uninstall`, Husky chaining).
5. `core/runner/` + `Plugin`/`Check`/`Issue` interfaces; wire the generic checks (Prettier, ESLint, console.log, merge-marker) in `core/` grouped under Inspectors; register the RN plugin. Every issue must populate the full five-part shape (problem/why/impact/fix/docs) — no bare strings, even in v0.1.
6. **Reporter v1 — treat as a headline deliverable, not the last task.** The five-part Inspector-grouped block, per-check timing, "N auto-fixed, re-staged" summary, TTY vs. non-TTY paths, `--json`. This is the thing we screenshot; budget real time for it.
7. `init` with the Profile picker (Minimal/Standard/Strict/Enterprise) on top of auto-detected framework.
8. Dogfood against a freshly generated Expo app and a bare RN app; measure timing (prove < 3s); confirm the output is screenshot-worthy; cut `0.1.0`.
