import pc from "picocolors";
import * as p from "@clack/prompts";
import { runEngine } from "../engine.js";
import { restage } from "../core/git/staged.js";
import type { AutoFix, Issue } from "../types.js";

export interface FixArgs {
  cwd: string;
  /** Apply every suggested fix without prompting (non-interactive/CI). */
  yes: boolean;
}

interface FileFix {
  fix: AutoFix;
  count: number;
  sample: Issue;
}

const out = (m: string) => process.stdout.write(m + "\n");

/**
 * `rn-guardian fix` — apply fixes to the staged changes.
 *
 * Safe fixes (Prettier, ESLint) apply automatically. Unsafe fixes — ones that
 * alter code, like removing a `console.log` — are collected and confirmed
 * interactively before applying, because this command runs in a real terminal
 * (unlike a git hook, whose stdin isn't a TTY). Fixed files are re-staged.
 */
export async function fixCommand(args: FixArgs): Promise<number> {
  // Pass 1: run checks and auto-apply the safe fixes (this also re-stages them).
  const { report, gitRoot, autofixed, fileCount } = await runEngine({
    cwd: args.cwd,
    tier: "commit",
    autofix: true,
  });

  if (fileCount === 0) {
    out("rn-guardian: no staged files to fix.");
    return 0;
  }

  if (autofixed > 0) {
    out(`${pc.green("✓")} Applied ${autofixed} safe fix${autofixed === 1 ? "" : "es"} (Prettier/ESLint), re-staged.`);
  }

  // Collect unsafe, confirm-required fixes — one entry per file (the console
  // fix rewrites the whole file, so per-file granularity is exact).
  const byFile = new Map<string, FileFix>();
  for (const issue of report.issues) {
    const auto = issue.fix.auto;
    if (!auto || auto.safe || report.fixedIssues.has(issue)) continue;
    const entry = byFile.get(issue.file);
    if (entry) entry.count++;
    else byFile.set(issue.file, { fix: auto, count: 1, sample: issue });
  }

  if (byFile.size === 0) {
    out(pc.dim("No suggested fixes to confirm."));
    return report.blocked ? 1 : 0;
  }

  const interactive =
    process.stdout.isTTY === true && process.stdin.isTTY === true && !args.yes;

  let targets: string[];
  if (args.yes) {
    targets = [...byFile.keys()];
  } else if (!interactive) {
    // No TTY to prompt on — list them and tell the user how to apply.
    out(`\n${pc.yellow("⚠")} ${byFile.size} file${byFile.size === 1 ? "" : "s"} have suggested fixes that need confirmation:`);
    for (const [file, e] of byFile) {
      out(`  ${pc.cyan(file)} ${pc.dim(`— ${e.count} × ${e.sample.fix.description}`)}`);
    }
    out(pc.dim("\nRun `rn-guardian fix` in a terminal to confirm, or `rn-guardian fix --yes` to apply all."));
    return report.blocked ? 1 : 0;
  } else {
    p.intro(pc.bgCyan(pc.black(" rn-guardian fix ")));
    const picked = await p.multiselect({
      message: "Apply these suggested fixes? (space toggles, enter confirms)",
      options: [...byFile].map(([file, e]) => ({
        value: file,
        label: file,
        hint: `${e.count} × ${e.sample.problem.replace(/\.$/, "")}`,
      })),
      initialValues: [...byFile.keys()],
      required: false,
    });
    if (p.isCancel(picked)) {
      p.cancel("No changes made.");
      return report.blocked ? 1 : 0;
    }
    targets = picked as string[];
  }

  // Apply the chosen fixes and re-stage what actually changed.
  const fixedPaths: string[] = [];
  for (const file of targets) {
    const entry = byFile.get(file);
    if (!entry) continue;
    const changed = await entry.fix.apply();
    if (changed) fixedPaths.push(file);
  }
  if (fixedPaths.length > 0) await restage(gitRoot, fixedPaths);

  const msg =
    fixedPaths.length > 0
      ? `${pc.green("✓")} Fixed ${fixedPaths.length} file${fixedPaths.length === 1 ? "" : "s"}, re-staged.`
      : pc.dim("No changes applied.");
  if (interactive) p.outro(msg);
  else out(msg);

  return 0;
}
