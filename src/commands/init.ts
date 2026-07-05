import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { detectProject } from "../core/project/detect.js";
import { installHooks } from "../core/hooks/install.js";
import { PROFILES, DEFAULT_PROFILE, type ProfileName } from "../core/config/profiles.js";
import { BUNDLED_PLUGINS } from "../plugins-list.js";

export interface InitArgs {
  cwd: string;
  /** Skip prompts (CI/non-TTY): use this profile. */
  profile?: ProfileName;
  yes?: boolean;
}

export async function initCommand(args: InitArgs): Promise<number> {
  const ctx = await detectProject(args.cwd);

  // Populate ctx.framework via plugin detection so we can show it.
  for (const plugin of BUNDLED_PLUGINS) {
    if (await plugin.detect(ctx)) {
      await plugin.enrich?.(ctx);
      break;
    }
  }

  p.intro(pc.bgCyan(pc.black(" rn-guardian init ")));

  const fw = ctx.framework;
  const detected = [
    fw ? `${fw.id}${fw.variant ? ` (${fw.variant})` : ""}` : "no framework detected",
    ctx.hasTypeScript ? "TypeScript" : "JavaScript",
    ctx.eslint.installed ? `ESLint v${ctx.eslint.major ?? "?"}` : "no ESLint",
    ctx.prettierInstalled ? "Prettier" : "no Prettier",
    ctx.packageManager,
    ctx.hookManager !== "none" ? `${ctx.hookManager} present` : "no hook manager",
  ].join(pc.dim(" · "));
  p.note(detected, "Detected");

  let profile: ProfileName;
  if (args.profile) {
    profile = args.profile;
  } else if (args.yes || !process.stdout.isTTY) {
    profile = DEFAULT_PROFILE;
  } else {
    const picked = await p.select({
      message: "Choose a profile",
      initialValue: DEFAULT_PROFILE,
      options: (Object.keys(PROFILES) as ProfileName[]).map((name) => ({
        value: name,
        label: name[0]!.toUpperCase() + name.slice(1),
        hint: PROFILES[name].description,
      })),
    });
    if (p.isCancel(picked)) {
      p.cancel("Aborted.");
      return 1;
    }
    profile = picked;
  }

  // Write config
  const configPath = path.join(ctx.packageRoot, "guardian.config.json");
  const config = { profile };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  // Ensure a "prepare" script so hooks reinstall on fresh clones.
  ensurePrepareScript(ctx.packageRoot);

  // Install hooks now.
  const result = installHooks(ctx);

  p.outro(
    `${pc.green("Ready.")} profile=${pc.bold(profile)} · hooks: ${result.hooks.join(
      ", ",
    )}\n  Commit as usual — rn-guardian runs automatically.`,
  );
  return 0;
}

function ensurePrepareScript(packageRoot: string): void {
  const pkgPath = path.join(packageRoot, "package.json");
  let pkg: Record<string, any>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return;
  }
  pkg.scripts ??= {};
  const prepare: string | undefined = pkg.scripts.prepare;
  if (!prepare) {
    pkg.scripts.prepare = "rn-guardian install";
  } else if (!prepare.includes("rn-guardian install")) {
    pkg.scripts.prepare = `${prepare} && rn-guardian install`;
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}
