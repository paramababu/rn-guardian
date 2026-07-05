import fs from "node:fs";
import type { StagedFile } from "../../types.js";

const SOURCE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

export function isSourceFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return SOURCE_EXT.has(path.slice(dot));
}

export function sourceFiles(files: StagedFile[]): StagedFile[] {
  return files.filter((f) => isSourceFile(f.path));
}

export function readFileSafe(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

/** Split into lines, preserving 1-based line numbers via index+1. */
export function toLines(content: string): string[] {
  return content.split(/\r?\n/);
}
