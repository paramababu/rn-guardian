import pc from "picocolors";
import type { Tier } from "./types.js";
import { runCommand } from "./commands/run.js";
import { checkCommand } from "./commands/check.js";
import { initCommand } from "./commands/init.js";
import { installCommand, uninstallCommand } from "./commands/install.js";
import { explainCommand } from "./commands/explain.js";
import { fixCommand } from "./commands/fix.js";
import { ciCommand } from "./commands/ci.js";
import type { ProfileName } from "./core/config/profiles.js";

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

function parse(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, flags };
}

function tierFlag(flags: ParsedArgs["flags"]): Tier {
  const t = flags.tier;
  if (t === "push" || t === "ci" || t === "commit") return t;
  return "commit";
}

const HELP = `
${pc.bold("rn-guardian")} — a fast, fully local quality engine for React Native

${pc.bold("Usage:")}  rn-guardian <command> [options]

${pc.bold("Commands:")}
  init                 Detect the project, pick a Profile, install git hooks
  install              (Re)install the git hooks  ${pc.dim("(prepare-script target)")}
  uninstall            Remove rn-guardian's managed hook blocks
  run                  Run checks for a tier ${pc.dim("(the hook calls this)")}
  check                Read-only scan of staged changes ${pc.dim('("what would fail?")')}
  ci                   Full sweep over the PR diff + gates ${pc.dim("(GitHub annotations)")}
  fix                  Apply safe fixes; confirm & apply suggested ones ${pc.dim("(console.log, …)")}
  explain              Print the full problem→why→fix for each staged issue
  help                 Show this help

${pc.bold("Options:")}
  --tier <commit|push|ci>   Which tier to run           ${pc.dim("(default: commit)")}
  --profile <name>          init: minimal|standard|strict|enterprise
  --yes                     init/fix: accept defaults / apply all, no prompts
  --json                    Machine-readable output (run/check/ci)
  --base <ref>              ci: base ref to diff against ${pc.dim("(default: origin/main)")}
  --all                     ci: scan every tracked file, not just the diff
  --annotate                ci: emit GitHub annotations ${pc.dim("(auto-on in Actions)")}
  --html [path]             ci: write a self-contained HTML report ${pc.dim("(default: rn-guardian-report.html)")}
`;

async function main(): Promise<number> {
  const { command, flags } = parse(process.argv.slice(2));
  const cwd = process.cwd();

  switch (command) {
    case "init":
      return initCommand({
        cwd,
        profile: typeof flags.profile === "string" ? (flags.profile as ProfileName) : undefined,
        yes: flags.yes === true,
      });
    case "install":
      return installCommand(cwd);
    case "uninstall":
      return uninstallCommand(cwd);
    case "run":
      return runCommand({ cwd, tier: tierFlag(flags), json: flags.json === true });
    case "check":
      return checkCommand({ cwd, tier: tierFlag(flags), json: flags.json === true });
    case "ci":
      return ciCommand({
        cwd,
        json: flags.json === true,
        base: typeof flags.base === "string" ? flags.base : undefined,
        all: flags.all === true,
        annotate: flags.annotate === true,
        html:
          flags.html === true
            ? "rn-guardian-report.html"
            : typeof flags.html === "string"
              ? flags.html
              : undefined,
      });
    case "fix":
      return fixCommand({ cwd, yes: flags.yes === true });
    case "explain":
      return explainCommand(cwd);
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`${pc.red("Unknown command:")} ${command}\n${HELP}`);
      return 1;
  }
}

// Set exitCode rather than calling process.exit(): when stdout is a pipe (a CI
// job or another tool capturing --json), process.exit() can terminate before an
// async write flushes, truncating large output. Setting exitCode lets Node drain
// stdout and exit on its own with the right code.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(
      `${pc.red("rn-guardian crashed:")} ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
