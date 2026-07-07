import { describe, it, expect } from "vitest";
import { compileIgnore } from "../src/core/util/ignore.js";

describe("ignore matcher", () => {
  it("ignores a basename at any depth", () => {
    const ig = compileIgnore(["*.log"]);
    expect(ig.ignores("a.log")).toBe(true);
    expect(ig.ignores("src/deep/b.log")).toBe(true);
    expect(ig.ignores("a.ts")).toBe(false);
  });

  it("matches a bare name as file or directory prefix", () => {
    const ig = compileIgnore(["dist"]);
    expect(ig.ignores("dist")).toBe(true);
    expect(ig.ignores("dist/index.js")).toBe(true);
    expect(ig.ignores("src/dist/x")).toBe(true); // unanchored: any depth
  });

  it("anchors a pattern that contains a slash", () => {
    const ig = compileIgnore(["build/output"]);
    expect(ig.ignores("build/output/x.js")).toBe(true);
    expect(ig.ignores("src/build/output/x.js")).toBe(false);
  });

  it("honors a leading-slash anchor", () => {
    const ig = compileIgnore(["/generated"]);
    expect(ig.ignores("generated/x")).toBe(true);
    expect(ig.ignores("src/generated/x")).toBe(false);
  });

  it("directory-only patterns match contents", () => {
    const ig = compileIgnore(["coverage/"]);
    expect(ig.ignores("coverage/report.html")).toBe(true);
    expect(ig.ignores("coverage")).toBe(false); // dir-only never matches a file named coverage
  });

  it("supports ** across segments", () => {
    const ig = compileIgnore(["src/**/generated.ts"]);
    expect(ig.ignores("src/a/b/generated.ts")).toBe(true);
    expect(ig.ignores("src/generated.ts")).toBe(true);
  });

  it("later negation re-includes a path", () => {
    const ig = compileIgnore(["*.snap", "!keep.snap"]);
    expect(ig.ignores("a.snap")).toBe(true);
    expect(ig.ignores("keep.snap")).toBe(false);
  });

  it("skips comments and blank lines", () => {
    const ig = compileIgnore(["# a comment", "", "  ", "*.tmp"]);
    expect(ig.ignores("x.tmp")).toBe(true);
    expect(ig.empty).toBe(false);
    expect(compileIgnore(["# only a comment"]).empty).toBe(true);
  });
});
