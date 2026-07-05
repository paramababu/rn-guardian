import pc from "picocolors";
import { detectProject } from "../core/project/detect.js";
import { installHooks, uninstallHooks } from "../core/hooks/install.js";

export async function installCommand(cwd: string): Promise<number> {
  const ctx = await detectProject(cwd);
  const result = installHooks(ctx);
  process.stdout.write(
    `${pc.green("✓")} rn-guardian hooks installed (${result.target}): ${result.hooks.join(
      ", ",
    )}\n`,
  );
  return 0;
}

export async function uninstallCommand(cwd: string): Promise<number> {
  const ctx = await detectProject(cwd);
  const removed = uninstallHooks(ctx);
  if (removed.length === 0) {
    process.stdout.write(`${pc.dim("nothing to remove — no managed hooks found.")}\n`);
  } else {
    process.stdout.write(
      `${pc.green("✓")} removed rn-guardian from: ${removed.join(", ")}\n`,
    );
  }
  return 0;
}
