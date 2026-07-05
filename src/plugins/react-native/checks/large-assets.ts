import fs from "node:fs";
import type { Check, CheckConfig, Issue } from "../../../types.js";
import { docs } from "../../../core/docs.js";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

function ext(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot).toLowerCase();
}

export const largeAssetsCheck: Check = {
  id: "large-assets",
  inspector: "performance",
  tier: "commit",
  appliesTo: () => true,
  async run(files, _ctx, config: CheckConfig) {
    const start = Date.now();
    const maxKb =
      typeof config.options.maxKb === "number"
        ? (config.options.maxKb as number)
        : 300;
    const issues: Issue[] = [];

    for (const file of files) {
      if (!IMAGE_EXT.has(ext(file.path))) continue;
      let sizeKb: number;
      try {
        sizeKb = Math.round(fs.statSync(file.absPath).size / 1024);
      } catch {
        continue;
      }
      if (sizeKb <= maxKb) continue;

      issues.push({
        ruleId: "performance/large-asset",
        inspector: "performance",
        severity: "warning",
        file: file.path,
        line: 1,
        problem: `Image is ${sizeKb} KB (limit ${maxKb} KB).`,
        why: "Large bundled images inflate app download size and are decoded into memory at full resolution — a real problem on low-end Android devices with limited RAM.",
        impact: `Roughly ${sizeKb - maxKb} KB over budget; larger install and higher memory pressure.`,
        fix: {
          description:
            "Compress (e.g. pngquant/squoosh), convert photos to WebP, ship an appropriately sized @2x/@3x set, or load remotely if it isn't needed at launch.",
        },
        docsUrl: docs("large-asset"),
      });
    }

    return {
      status: issues.length ? "warn" : "pass",
      issues,
      durationMs: Date.now() - start,
    };
  },
};
