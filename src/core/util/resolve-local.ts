import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Dynamically import a package as installed in the *target project*, not in
 * rn-guardian's own dependencies. This is how we run the user's exact ESLint /
 * Prettier version (PLAN.md §3, key technical decisions). Returns null when the
 * package is not installed in the project.
 */
export async function importLocal<T = unknown>(
  packageRoot: string,
  name: string,
): Promise<T | null> {
  try {
    const require = createRequire(path.join(packageRoot, "package.json"));
    const resolved = require.resolve(name);
    const mod = (await import(pathToFileURL(resolved).href)) as {
      default?: T;
    } & T;
    return (mod.default ?? mod) as T;
  } catch {
    return null;
  }
}

/**
 * Resolve a package to its on-disk path as installed in the target project,
 * without importing it. Returns null when it isn't installed. Used to detect and
 * point ESLint at the project's own parser (a string path for eslintrc configs).
 */
export function resolveLocalPath(
  packageRoot: string,
  name: string,
): string | null {
  try {
    const require = createRequire(path.join(packageRoot, "package.json"));
    return require.resolve(name);
  } catch {
    return null;
  }
}
