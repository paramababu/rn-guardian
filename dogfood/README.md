# Dogfood harness

The one thing unit tests and CI can't verify is whether the pre-commit path
stays under its **≤ 3s budget** on a *real* project — real ESLint config, real
Prettier, a realistic number of staged files. This harness builds exactly that
and measures it.

```bash
npm run dogfood                 # 30 files, 4 runs, 3000ms budget
npm run dogfood -- --files 60   # heavier commit
npm run dogfood -- --keep       # inspect the generated workspace afterwards
```

## What it does

1. Builds and `npm pack`s rn-guardian.
2. Scaffolds an RN-shaped TypeScript project: real **ESLint v9 flat config**
   (typescript-eslint), **Prettier**, **tsconfig**, and `react-native` listed as
   a dependency so the RN plugin activates.
3. Generates N `Screen*.tsx` components — ~1 in 4 seeded with genuine issues
   (console.log, inline styles, missing `keyExtractor`, unlabeled touchables).
4. Installs the toolchain and the packed tarball, `git init`, stages everything,
   runs `rn-guardian init --yes`.
5. Times several `rn-guardian run --tier commit` invocations (first is cold) and
   reports **wall-clock** time — what a developer actually feels, including Node
   startup and ESLint load — against the budget.

## What it deliberately doesn't do

It doesn't install React Native's native toolchain. rn-guardian detects RN from
`package.json` and its checks never import RN, so listing the dependency is
enough — this keeps the harness fast while still exercising the real cost
drivers (ESLint + Prettier + file scanning).

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--files N` | 30 | staged source files to generate |
| `--runs R` | 4 | timed runs (run 1 is the cold start) |
| `--budget MS` | 3000 | pre-commit wall-clock budget (checked against warm median) |
| `--keep` | off | keep the workspace for inspection |
| `--dir PATH` | temp dir | workspace location |

Exit code is non-zero if the warm median exceeds the budget, so it can gate a
release.
