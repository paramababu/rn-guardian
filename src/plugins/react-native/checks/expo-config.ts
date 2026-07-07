import type { Check, Issue } from "../../../types.js";
import { readFileSafe } from "../../../core/util/files.js";
import { docs } from "../../../core/docs.js";

/**
 * Expo config inspector. Reads `app.json` and cross-checks a sensitive Android
 * permission against its required iOS usage-description string: if the app
 * declares, say, `android.permission.CAMERA` but `ios.infoPlist` has no
 * `NSCameraUsageDescription`, the iOS build will crash the moment it touches the
 * API (or get rejected at review). This platform-parity check is fully static —
 * just JSON — so it stays dependency-free.
 *
 * Only runs for Expo projects, and only when `app.json` is part of the staged
 * change. `app.config.js/ts` is code we won't evaluate; those are noted, not
 * mis-parsed. Runs at the `push` tier.
 */
interface PermissionMap {
  /** Android permission suffix (after `android.permission.`) → iOS Info.plist key. */
  [androidPerm: string]: string;
}

// Sensitive permissions that have a hard iOS usage-string requirement.
const ANDROID_TO_IOS: PermissionMap = {
  CAMERA: "NSCameraUsageDescription",
  RECORD_AUDIO: "NSMicrophoneUsageDescription",
  ACCESS_FINE_LOCATION: "NSLocationWhenInUseUsageDescription",
  ACCESS_COARSE_LOCATION: "NSLocationWhenInUseUsageDescription",
  ACCESS_BACKGROUND_LOCATION: "NSLocationAlwaysAndWhenInUseUsageDescription",
  READ_CONTACTS: "NSContactsUsageDescription",
  READ_CALENDAR: "NSCalendarsUsageDescription",
  READ_EXTERNAL_STORAGE: "NSPhotoLibraryUsageDescription",
  READ_MEDIA_IMAGES: "NSPhotoLibraryUsageDescription",
  BODY_SENSORS: "NSMotionUsageDescription",
};

const APP_JSON = "app.json";
const CODE_CONFIGS = ["app.config.js", "app.config.ts", "app.config.mjs"];

export const expoConfigCheck: Check = {
  id: "expo-config",
  inspector: "security",
  tier: "push",
  appliesTo: (ctx) => ctx.framework?.id === "react-native" && ctx.framework.variant === "expo",
  async run(files, ctx) {
    const start = Date.now();
    const done = (
      status: "pass" | "warn" | "skipped",
      issues: Issue[] = [],
      note?: string,
    ) => ({ status, issues, durationMs: Date.now() - start, note });

    const staged = new Set(files.map((f) => baseName(f.path)));
    // Only react when the Expo config changed in this push.
    if (!staged.has(APP_JSON)) {
      if (CODE_CONFIGS.some((c) => staged.has(c))) {
        return done("skipped", [], "app.config.js/ts is not statically analyzable — use app.json for permission checks");
      }
      return done("pass");
    }

    const appJson = files.find((f) => baseName(f.path) === APP_JSON);
    const raw = appJson ? readFileSafe(appJson.absPath) : null;
    if (raw === null) return done("skipped", [], "could not read app.json");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return done("skipped", [], "app.json is not valid JSON");
    }

    const rel = appJson!.path;
    const config = unwrapExpo(parsed);
    const androidPerms = readAndroidPermissions(config);
    const iosKeys = readIosInfoPlistKeys(config);

    const issues: Issue[] = [];
    const reported = new Set<string>();
    for (const perm of androidPerms) {
      const iosKey = ANDROID_TO_IOS[perm];
      if (iosKey && !iosKeys.has(iosKey) && !reported.has(iosKey)) {
        reported.add(iosKey);
        issues.push(missingUsageString(rel, perm, iosKey));
      }
    }

    return done(issues.length ? "warn" : "pass", issues);
  },
};

function missingUsageString(file: string, androidPerm: string, iosKey: string): Issue {
  return {
    ruleId: "security/ios-usage-description-missing",
    inspector: "security",
    severity: "warning",
    file,
    line: 1,
    problem: `Declares Android ${androidPerm} but has no iOS ${iosKey}.`,
    why: "iOS force-crashes an app the first time it accesses a protected resource (camera, mic, location, contacts…) without the matching usage-description string in Info.plist — and App Review rejects builds that are missing them. Declaring the capability on Android without the iOS counterpart is almost always an oversight.",
    impact: "Immediate crash on iOS when the feature is used, or a failed App Store review.",
    fix: {
      description: `Add "${iosKey}" with a user-facing reason to expo.ios.infoPlist in app.json (or opt out of the Android permission if the feature isn't used).`,
    },
    docsUrl: docs("ios-usage-description-missing"),
  };
}

/** app.json may nest everything under an `expo` key, or be flat. */
function unwrapExpo(parsed: unknown): Record<string, unknown> {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const expo = obj.expo;
  return (expo && typeof expo === "object" ? expo : obj) as Record<string, unknown>;
}

/** Collect Android permission suffixes (`CAMERA`, not `android.permission.CAMERA`). */
function readAndroidPermissions(config: Record<string, unknown>): string[] {
  const android = config.android as { permissions?: unknown } | undefined;
  const perms = android?.permissions;
  if (!Array.isArray(perms)) return [];
  return perms
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.replace(/^android\.permission\./, ""));
}

function readIosInfoPlistKeys(config: Record<string, unknown>): Set<string> {
  const ios = config.ios as { infoPlist?: Record<string, unknown> } | undefined;
  const plist = ios?.infoPlist;
  return new Set(plist && typeof plist === "object" ? Object.keys(plist) : []);
}

function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}
