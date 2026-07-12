import type { Issue } from "../../types.js";
import type { RunReport } from "../runner/runner.js";
import type { GateResult } from "../ci/gates.js";
import { inspectorTitle } from "../inspectors.js";
import type { InspectorId } from "../../types.js";

/**
 * Self-contained HTML report (ROADMAP 0.3.0): one file, inline CSS, no
 * external assets or scripts — safe to attach to a CI job or open from disk.
 * Mirrors the terminal reporter's grouping (inspector → issues, five-part
 * explanations) so the two tell the same story.
 */

export interface HtmlMeta {
  profile: string;
  scope: string;
  generatedAt: Date;
}

export function toHtml(report: RunReport, gates: GateResult, meta: HtmlMeta): string {
  const remaining = report.remaining;
  const errors = remaining.filter((i) => i.severity === "error").length;
  const warnings = remaining.filter((i) => i.severity === "warning").length;
  const blocked = report.blocked || gates.blocked;

  const byInspector = new Map<InspectorId, Issue[]>();
  for (const issue of remaining) {
    const list = byInspector.get(issue.inspector) ?? [];
    list.push(issue);
    byInspector.set(issue.inspector, list);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rn-guardian report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0 auto; max-width: 60rem; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 .5rem; }
  .meta { opacity: .7; margin-bottom: 1.5rem; }
  .tiles { display: flex; flex-wrap: wrap; gap: .75rem; }
  .tile { flex: 1 1 8rem; border: 1px solid rgba(128,128,128,.35); border-radius: .5rem; padding: .6rem .9rem; }
  .tile b { display: block; font-size: 1.5rem; }
  .ok    { color: #1a7f37; }
  .bad   { color: #c93c37; }
  .warn  { color: #b58500; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid rgba(128,128,128,.25); vertical-align: top; }
  th { font-weight: 600; }
  .badge { display: inline-block; border-radius: .3rem; padding: 0 .4rem; font-size: .8rem; font-weight: 600; color: #fff; }
  .badge.error { background: #c93c37; }
  .badge.warning { background: #b58500; }
  .issue { border: 1px solid rgba(128,128,128,.3); border-left-width: 4px; border-radius: .4rem; padding: .6rem .9rem; margin: .6rem 0; }
  .issue.error { border-left-color: #c93c37; }
  .issue.warning { border-left-color: #b58500; }
  .loc { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; opacity: .8; }
  .part { margin: .25rem 0 0; }
  .part span { font-weight: 600; }
  .gate { color: #c93c37; margin: .3rem 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
</style>
</head>
<body>
<h1>rn-guardian ${esc(report.tier)} report ${blocked ? '<span class="badge error">blocked</span>' : '<span class="badge" style="background:#1a7f37">passed</span>'}</h1>
<p class="meta">profile <b>${esc(meta.profile)}</b> · scope: ${esc(meta.scope)} · ${esc(meta.generatedAt.toISOString())} · ${report.totalDurationMs}ms</p>

<div class="tiles">
  <div class="tile"><b class="${errors ? "bad" : "ok"}">${errors}</b>errors</div>
  <div class="tile"><b class="${warnings ? "warn" : "ok"}">${warnings}</b>warnings</div>
  <div class="tile"><b>${report.files.length}</b>files scanned</div>
  <div class="tile"><b class="${gates.failures.length ? "bad" : "ok"}">${gates.failures.length}</b>gate failures</div>
</div>
${gatesSection(gates)}
<h2>Checks</h2>
<table>
<tr><th>check</th><th>inspector</th><th>status</th><th>time</th><th>note</th></tr>
${report.runs
  .map(
    (r) =>
      `<tr><td>${esc(r.check.id)}</td><td>${esc(inspectorTitle(r.check.inspector))}</td>` +
      `<td class="${statusClass(r.result.status)}">${esc(r.result.status)}</td>` +
      `<td>${r.result.durationMs}ms</td><td>${esc(r.result.note ?? "")}</td></tr>`,
  )
  .join("\n")}
</table>
${issuesSections(byInspector)}
</body>
</html>
`;
}

function gatesSection(gates: GateResult): string {
  if (gates.failures.length === 0) return "";
  const items = gates.failures
    .map((g) => `<p class="gate">✗ <b>${esc(g.title)}</b> — ${esc(g.message)}</p>`)
    .join("\n");
  return `<h2>Gate failures</h2>\n${items}`;
}

function issuesSections(byInspector: Map<InspectorId, Issue[]>): string {
  if (byInspector.size === 0) return `<h2>Issues</h2>\n<p class="ok">No remaining issues. ✓</p>`;
  let out = "";
  for (const [inspector, issues] of byInspector) {
    out += `<h2>${esc(inspectorTitle(inspector))} — ${issues.length}</h2>\n`;
    for (const i of issues) {
      out += `<div class="issue ${i.severity}">
  <div><span class="badge ${i.severity}">${i.severity}</span> <b>${esc(i.problem)}</b></div>
  <div class="loc">${esc(i.file)}:${i.line}${i.column !== undefined ? ":" + i.column : ""} · ${esc(i.ruleId)}</div>
  <p class="part"><span>Why:</span> ${esc(i.why)}</p>
  ${i.impact ? `<p class="part"><span>Impact:</span> ${esc(i.impact)}</p>` : ""}
  <p class="part"><span>Fix:</span> ${esc(i.fix.description)}</p>
  ${i.docsUrl ? `<p class="part"><a href="${esc(i.docsUrl)}">docs</a></p>` : ""}
</div>\n`;
    }
  }
  return out;
}

function statusClass(status: string): string {
  if (status === "fail") return "bad";
  if (status === "warn") return "warn";
  return "ok";
}

function esc(s: string): string {
  // Defensive clamp: a check should never emit megabytes of prose, but the
  // report must stay openable even if one does.
  const clipped = s.length > 2000 ? s.slice(0, 2000) + "…" : s;
  return clipped
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
