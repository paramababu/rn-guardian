import fs from "node:fs";
import path from "node:path";
import type { ProjectContext, Tier } from "../../types.js";

const SENTINEL = "# >>> rn-guardian managed >>>";
const SENTINEL_END = "# <<< rn-guardian managed <<<";

const HOOKS: Array<{ hook: string; tier: Tier }> = [
  { hook: "pre-commit", tier: "commit" },
  { hook: "pre-push", tier: "push" },
];

function managedBlock(tier: Tier): string {
  // `npx --no-install` uses the project's local binary with no network access,
  // honoring our fully-local promise.
  return [
    SENTINEL,
    `if command -v npx >/dev/null 2>&1; then`,
    `  npx --no-install rn-guardian run --tier ${tier} || exit 1`,
    `fi`,
    SENTINEL_END,
  ].join("\n");
}

function stripManaged(content: string): string {
  const re = new RegExp(`\\n?${SENTINEL}[\\s\\S]*?${SENTINEL_END}\\n?`, "g");
  return content.replace(re, "\n").trimStart();
}

export interface InstallResult {
  target: "husky" | "git";
  hooks: string[];
}

/**
 * Install the pre-commit and pre-push hooks. If Husky is present we append our
 * managed block to the Husky hook files (coexist, don't conquer — PLAN.md §2).
 * Otherwise we write native .git/hooks scripts.
 */
export function installHooks(ctx: ProjectContext): InstallResult {
  if (ctx.hookManager === "husky") {
    return installHusky(ctx);
  }
  return installGit(ctx);
}

function installHusky(ctx: ProjectContext): InstallResult {
  const dir = path.join(ctx.packageRoot, ".husky");
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];

  for (const { hook, tier } of HOOKS) {
    const file = path.join(dir, hook);
    let existing = "";
    try {
      existing = fs.readFileSync(file, "utf8");
    } catch {
      existing = "";
    }
    const base = stripManaged(existing);
    const body = base
      ? `${base.trimEnd()}\n\n${managedBlock(tier)}\n`
      : `${managedBlock(tier)}\n`;
    fs.writeFileSync(file, body);
    fs.chmodSync(file, 0o755);
    written.push(`.husky/${hook}`);
  }
  return { target: "husky", hooks: written };
}

function installGit(ctx: ProjectContext): InstallResult {
  const dir = path.join(ctx.gitRoot, ".git", "hooks");
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];

  for (const { hook, tier } of HOOKS) {
    const file = path.join(dir, hook);
    let existing = "";
    try {
      existing = fs.readFileSync(file, "utf8");
    } catch {
      existing = "";
    }
    const hasShebang = existing.trimStart().startsWith("#!");
    const base = stripManaged(existing);
    let body: string;
    if (base) {
      body = `${base.trimEnd()}\n\n${managedBlock(tier)}\n`;
    } else {
      body = `#!/usr/bin/env sh\n${managedBlock(tier)}\n`;
    }
    if (hasShebang && base && !body.trimStart().startsWith("#!")) {
      body = `#!/usr/bin/env sh\n${body}`;
    }
    fs.writeFileSync(file, body);
    fs.chmodSync(file, 0o755);
    written.push(`.git/hooks/${hook}`);
  }
  return { target: "git", hooks: written };
}

/** Remove only rn-guardian's managed blocks; leave everything else intact. */
export function uninstallHooks(ctx: ProjectContext): string[] {
  const removed: string[] = [];
  const roots = [
    { dir: path.join(ctx.packageRoot, ".husky"), label: ".husky" },
    { dir: path.join(ctx.gitRoot, ".git", "hooks"), label: ".git/hooks" },
  ];

  for (const { dir, label } of roots) {
    for (const { hook } of HOOKS) {
      const file = path.join(dir, hook);
      let content: string;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!content.includes(SENTINEL)) continue;
      const stripped = stripManaged(content);
      // If nothing meaningful remains (just a shebang), remove the file.
      if (stripped.replace(/^#!.*\n?/, "").trim() === "") {
        fs.rmSync(file, { force: true });
      } else {
        fs.writeFileSync(file, stripped);
        fs.chmodSync(file, 0o755);
      }
      removed.push(`${label}/${hook}`);
    }
  }
  return removed;
}
