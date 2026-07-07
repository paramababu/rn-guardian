import { describe, it, expect } from "vitest";
import { bundleAdvisorCheck } from "../src/plugins/react-native/checks/bundle-advisor.js";
import { makeStaged } from "./helpers.js";
import type { CheckConfig, ProjectContext } from "../src/types.js";

const rnCtx = { framework: { id: "react-native" } } as ProjectContext;
const cfg: CheckConfig = { enabled: true, tier: "push", options: {} };
const ids = (issues: { ruleId: string }[]) => issues.map((i) => i.ruleId);

describe("bundle-advisor", () => {
  it("flags moment, a lodash barrel import, and full firebase", async () => {
    const { staged, cleanup } = makeStaged({
      "src/a.ts": `import moment from "moment";
import { debounce } from "lodash";
import firebase from "firebase";`,
    });
    const res = await bundleAdvisorCheck.run(staged, rnCtx, cfg);
    const found = ids(res.issues);
    expect(found).toContain("dependency/no-moment");
    expect(found).toContain("dependency/lodash-barrel-import");
    expect(found).toContain("dependency/firebase-full-import");
    expect(res.status).toBe("warn");
    cleanup();
  });

  it("does not flag the tree-shakeable alternatives", async () => {
    const { staged, cleanup } = makeStaged({
      "src/ok.ts": `import debounce from "lodash/debounce";
import dayjs from "dayjs";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import mtz from "moment-timezone";`,
    });
    const res = await bundleAdvisorCheck.run(staged, rnCtx, cfg);
    expect(res.issues).toHaveLength(0);
    expect(res.status).toBe("pass");
    cleanup();
  });

  it("flags firebase/compat as the full surface", async () => {
    const { staged, cleanup } = makeStaged({
      "src/c.ts": `import firebase from "firebase/compat/app";`,
    });
    const res = await bundleAdvisorCheck.run(staged, rnCtx, cfg);
    expect(ids(res.issues)).toContain("dependency/firebase-full-import");
    cleanup();
  });

  it("only applies to react-native projects", () => {
    expect(bundleAdvisorCheck.appliesTo(rnCtx)).toBe(true);
    expect(bundleAdvisorCheck.appliesTo({} as ProjectContext)).toBe(false);
  });
});
