import type { Check, Issue } from "../../../types.js";
import { readFileSafe, sourceFiles, toLines } from "../../../core/util/files.js";
import { docs } from "../../../core/docs.js";

/**
 * The Bundle Advisor — flags import patterns that quietly bloat a React Native
 * JS bundle. Every rule is a warning (never a hard block): the alternative is
 * always a smaller drop-in, but the call is the team's. Purely a source scan, so
 * it stays in the deterministic, dependency-free spirit of the rest of the tool.
 *
 * Runs at the `push` tier — bundle weight is a "before it leaves your machine"
 * concern, not something to interrupt every commit for.
 */
interface Rule {
  re: RegExp;
  build(file: string, line: number): Issue;
}

// `import x from "moment"` / `require("moment")` — but not `moment-timezone`.
const MOMENT = /(?:from\s+|require\(\s*)['"]moment['"]/;

// A barrel import of all of lodash. `lodash/debounce` and `lodash-es` are fine.
const LODASH_BARREL = /(?:from\s+|require\(\s*)['"]lodash['"]/;

// The whole-SDK / compat Firebase surface. The modular `firebase/app`,
// `firebase/firestore`, … are tree-shakeable and deliberately excluded.
const FIREBASE_FULL = /(?:from\s+|require\(\s*)['"]firebase(?:\/compat[^'"]*)?['"]/;

const RULES: Rule[] = [
  {
    re: MOMENT,
    build: (file, line) => ({
      ruleId: "dependency/no-moment",
      inspector: "dependency",
      severity: "warning",
      file,
      line,
      problem: "Imports moment, a large, mutable, no-longer-recommended date library.",
      why: "moment ships ~70KB min+gzip (far more with locales) and is not tree-shakeable, so all of it lands in your bundle even if you use one function. Its own maintainers now recommend against it for new code.",
      impact: "Tens of KB of dead weight in the JS bundle and slower cold starts.",
      fix: {
        description:
          "Switch to day.js (2KB, moment-compatible API) or date-fns (tree-shakeable per-function imports).",
      },
      docsUrl: docs("no-moment"),
    }),
  },
  {
    re: LODASH_BARREL,
    build: (file, line) => ({
      ruleId: "dependency/lodash-barrel-import",
      inspector: "dependency",
      severity: "warning",
      file,
      line,
      problem: 'Barrel import from "lodash" pulls the whole library in.',
      why: "Importing from the lodash root defeats tree-shaking in most RN/Metro setups — the entire library is bundled even when you use a single helper.",
      impact: "Ships all of lodash (~24KB gzip) instead of the few methods you use.",
      fix: {
        description:
          'Import per method — `import debounce from "lodash/debounce"` — or switch to `lodash-es` for real tree-shaking.',
      },
      docsUrl: docs("lodash-barrel-import"),
    }),
  },
  {
    re: FIREBASE_FULL,
    build: (file, line) => ({
      ruleId: "dependency/firebase-full-import",
      inspector: "dependency",
      severity: "warning",
      file,
      line,
      problem: "Uses the full / compat Firebase SDK surface.",
      why: "The namespaced (`firebase`) and `firebase/compat` entry points bundle the entire SDK. The modular v9+ API (`firebase/app`, `firebase/firestore`, …) only bundles the services you actually import.",
      impact: "Hundreds of KB of unused Firebase services shipped to every user.",
      fix: {
        description:
          'Migrate to the modular API: `import { initializeApp } from "firebase/app"` and import each service (`firebase/auth`, `firebase/firestore`) on its own.',
      },
      docsUrl: docs("firebase-full-import"),
    }),
  },
];

export const bundleAdvisorCheck: Check = {
  id: "bundle-advisor",
  inspector: "dependency",
  tier: "push",
  appliesTo: (ctx) => ctx.framework?.id === "react-native",
  async run(files) {
    const start = Date.now();
    const issues: Issue[] = [];

    for (const file of sourceFiles(files)) {
      const content = readFileSafe(file.absPath);
      if (content === null) continue;
      const lines = toLines(content);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const rule of RULES) {
          if (rule.re.test(line)) issues.push(rule.build(file.path, i + 1));
        }
      }
    }

    return {
      status: issues.length ? "warn" : "pass",
      issues,
      durationMs: Date.now() - start,
    };
  },
};
