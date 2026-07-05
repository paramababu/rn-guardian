import { describe, it, expect } from "vitest";
import { scanJsxElements, hasProp } from "../src/plugins/react-native/jsx.js";

describe("scanJsxElements", () => {
  it("extracts attrs and ignores > inside expressions", () => {
    const src = `<FlatList data={a > b ? x : y} renderItem={() => <Row/>} />`;
    const els = scanJsxElements(src, ["FlatList"]);
    expect(els.length).toBe(1);
    expect(els[0]!.selfClosing).toBe(true);
    // The `>` in `a > b` and the `>` in `=>`/`<Row/>` must not end the tag early.
    expect(els[0]!.attrs).toContain("renderItem");
  });

  it("does not match a longer tag name (Image vs ImageBackground)", () => {
    const src = `<ImageBackground source={x} />\n<Image source={y} />`;
    const els = scanJsxElements(src, ["Image"]);
    expect(els.length).toBe(1);
    expect(els[0]!.line).toBe(2);
  });

  it("reports the correct line number", () => {
    const src = `line1\nline2\n  <FlatList data={d} />\n`;
    const els = scanJsxElements(src, ["FlatList"]);
    expect(els[0]!.line).toBe(3);
  });

  it("handles > inside string attribute values", () => {
    const src = `<Pressable accessibilityLabel="go >>" onPress={f}>X</Pressable>`;
    const els = scanJsxElements(src, ["Pressable"]);
    expect(els.length).toBe(1);
    expect(els[0]!.selfClosing).toBe(false);
    expect(hasProp(els[0]!.attrs, "accessibilityLabel")).toBe(true);
  });

  it("hasProp distinguishes present vs absent props", () => {
    expect(hasProp(" data={d} keyExtractor={k}", "keyExtractor")).toBe(true);
    expect(hasProp(" data={d} renderItem={r}", "keyExtractor")).toBe(false);
  });
});
