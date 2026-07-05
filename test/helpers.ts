import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StagedFile } from "../src/types.js";

/** Create a temp dir with the given files; returns dir + StagedFile[]. */
export function makeStaged(
  files: Record<string, string>,
): { dir: string; staged: StagedFile[]; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-guardian-test-"));
  const staged: StagedFile[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    staged.push({
      path: rel,
      absPath: abs,
      status: "M",
      partiallyStaged: false,
    });
  }
  return {
    dir,
    staged,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
