import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import { rules } from "../src/plugins/react-native/eslint-plugin/rules.js";

// espree (ESLint's bundled parser) handles plain JSX with the jsx feature on —
// these snippets carry no TypeScript syntax, so no extra parser is needed.
const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("eslint-plugin rules", () => {
  it("flatlist-key-extractor", () => {
    tester.run("flatlist-key-extractor", rules["flatlist-key-extractor"]!, {
      valid: [
        "const A = () => <FlatList data={x} keyExtractor={f} />;",
        "const A = () => <FlatList {...props} />;",
        "const A = () => <View data={x} />;",
      ],
      invalid: [
        {
          code: "const A = () => <FlatList data={x} />;",
          errors: [{ messageId: "missing" }],
        },
        {
          code: "const A = () => <SectionList sections={s} />;",
          errors: [{ messageId: "missing" }],
        },
      ],
    });
  });

  it("no-inline-style-object", () => {
    tester.run("no-inline-style-object", rules["no-inline-style-object"]!, {
      valid: [
        "const A = () => <View style={styles.a} />;",
        "const A = () => <View style={[styles.a, styles.b]} />;",
      ],
      invalid: [
        {
          code: "const A = () => <View style={{ flex: 1 }} />;",
          errors: [{ messageId: "inline" }],
        },
        {
          code: "const A = () => <View contentContainerStyle={{ padding: 8 }} />;",
          errors: [{ messageId: "inline" }],
        },
        {
          code: "const A = () => <View style={[styles.a, { flex: 1 }]} />;",
          errors: [{ messageId: "inline" }],
        },
      ],
    });
  });

  it("no-anonymous-render-callback", () => {
    tester.run(
      "no-anonymous-render-callback",
      rules["no-anonymous-render-callback"]!,
      {
        valid: ["const A = () => <FlatList renderItem={renderRow} />;"],
        invalid: [
          {
            code: "const A = () => <FlatList renderItem={() => <Row />} />;",
            errors: [{ messageId: "anon" }],
          },
          {
            code: "const A = () => <SectionList renderSectionHeader={function () { return null; }} />;",
            errors: [{ messageId: "anon" }],
          },
        ],
      },
    );
  });

  it("no-nested-scrollview", () => {
    tester.run("no-nested-scrollview", rules["no-nested-scrollview"]!, {
      valid: [
        "const A = () => <View><FlatList data={x} /></View>;",
        "const A = () => <ScrollView><Text>hi</Text></ScrollView>;",
      ],
      invalid: [
        {
          code: "const A = () => <ScrollView><FlatList data={x} /></ScrollView>;",
          errors: [{ messageId: "nested" }],
        },
        {
          code: "const A = () => <ScrollView><View><SectionList sections={s} /></View></ScrollView>;",
          errors: [{ messageId: "nested" }],
        },
      ],
    });
  });

  it("touchable-accessibility-label", () => {
    tester.run(
      "touchable-accessibility-label",
      rules["touchable-accessibility-label"]!,
      {
        valid: [
          'const A = () => <TouchableOpacity accessibilityLabel="Save" onPress={f}><Icon /></TouchableOpacity>;',
          "const A = () => <TouchableOpacity onPress={f}><Text>Save</Text></TouchableOpacity>;",
          "const A = () => <TouchableOpacity accessible={false}><Icon /></TouchableOpacity>;",
          "const A = () => <TouchableOpacity {...p}><Icon /></TouchableOpacity>;",
        ],
        invalid: [
          {
            code: "const A = () => <TouchableOpacity onPress={f}><Icon /></TouchableOpacity>;",
            errors: [{ messageId: "touchable" }],
          },
          {
            code: "const A = () => <Pressable onPress={f}><Icon /></Pressable>;",
            errors: [{ messageId: "touchable" }],
          },
        ],
      },
    );
  });

  it("image-accessibility", () => {
    tester.run("image-accessibility", rules["image-accessibility"]!, {
      valid: [
        'const A = () => <Image source={s} accessibilityLabel="Logo" />;',
        'const A = () => <Image source={s} alt="Logo" />;',
        "const A = () => <Image source={s} accessible={false} />;",
        "const A = () => <Image {...p} />;",
      ],
      invalid: [
        {
          code: "const A = () => <Image source={s} />;",
          errors: [{ messageId: "image" }],
        },
      ],
    });
  });
});
