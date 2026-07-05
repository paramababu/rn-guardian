import fs from "node:fs";
import path from "node:path";
import type { ProjectContext } from "../../types.js";

function readJson(p: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function depVersion(
  pkg: Record<string, any> | null,
  name: string,
): string | undefined {
  if (!pkg) return undefined;
  for (const field of ["dependencies", "devDependencies"]) {
    const v = pkg[field]?.[name];
    if (typeof v === "string") return v;
  }
  return undefined;
}

/** Is this a React Native project (bare or Expo)? */
export function isReactNative(ctx: ProjectContext): boolean {
  const pkg = readJson(path.join(ctx.packageRoot, "package.json"));
  return Boolean(depVersion(pkg, "react-native") || depVersion(pkg, "expo"));
}

/** Fill ctx.framework with variant (expo/bare) and RN version. */
export function enrichReactNative(ctx: ProjectContext): void {
  const pkg = readJson(path.join(ctx.packageRoot, "package.json"));
  const expo = depVersion(pkg, "expo");
  const rn = depVersion(pkg, "react-native");
  const hasAppJson =
    fs.existsSync(path.join(ctx.packageRoot, "app.json")) ||
    fs.existsSync(path.join(ctx.packageRoot, "app.config.js")) ||
    fs.existsSync(path.join(ctx.packageRoot, "app.config.ts"));

  ctx.framework = {
    id: "react-native",
    variant: expo || hasAppJson ? "expo" : "bare",
    version: rn?.replace(/[^\d.]/g, "") || undefined,
  };
}
