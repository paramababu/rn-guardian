import type { Check, Issue } from "../../../types.js";
import { readFileSafe, sourceFiles, toLines } from "../../../core/util/files.js";
import { docs } from "../../../core/docs.js";

// AsyncStorage.setItem('authToken', ...) — a sensitive key in insecure storage.
const ASYNC_STORAGE_SET =
  /AsyncStorage\.setItem\s*\(\s*[`'"]([^`'"]*(token|jwt|secret|password|credential|refresh)[^`'"]*)[`'"]/i;

// A hardcoded JWT literal (three base64url segments, header starts with eyJ).
const JWT_LITERAL = /[`'"]eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}[`'"]/;

// Common provider keys and generic secret assignments.
const HARDCODED_KEY =
  /(AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{20,}|(api[_-]?key|secret|access[_-]?token)\s*[:=]\s*[`'"][A-Za-z0-9_\-]{16,}[`'"])/i;

// A plaintext http:// endpoint (not localhost).
const HTTP_URL = /[`'"]http:\/\/(?!localhost|127\.0\.0\.1|10\.0\.2\.2)[^`'"\s]+[`'"]/;

interface Rule {
  re: RegExp;
  build(file: string, line: number): Issue;
}

const RULES: Rule[] = [
  {
    re: ASYNC_STORAGE_SET,
    build: (file, line) => ({
      ruleId: "security/no-token-in-asyncstorage",
      inspector: "security",
      severity: "error",
      file,
      line,
      problem: "A sensitive value is being written to AsyncStorage.",
      why: "AsyncStorage is unencrypted plain text — on Android it is a world-readable file inside the app sandbox, and on a rooted or jailbroken device any process can read it. Tokens and credentials do not belong there.",
      impact:
        "A stolen device or a malicious app on a rooted phone can exfiltrate the user's session token.",
      fix: {
        description:
          "Use expo-secure-store (Keychain/Keystore) or react-native-keychain for tokens and credentials; keep AsyncStorage for non-sensitive state.",
      },
      docsUrl: docs("no-token-in-asyncstorage"),
    }),
  },
  {
    re: JWT_LITERAL,
    build: (file, line) => ({
      ruleId: "security/hardcoded-jwt",
      inspector: "security",
      severity: "error",
      file,
      line,
      problem: "A JWT appears to be hardcoded in source.",
      why: "Anything committed to git lives in history forever, even if deleted later. A hardcoded token is a leaked credential the moment the repo is cloned, shared, or made public.",
      impact: "Full account/API access for anyone who reads the repository.",
      fix: {
        description:
          "Remove it, rotate the token immediately, and load secrets from a secure runtime source (never bundle them into the app).",
      },
      docsUrl: docs("hardcoded-secret"),
    }),
  },
  {
    re: HARDCODED_KEY,
    build: (file, line) => ({
      ruleId: "security/hardcoded-key",
      inspector: "security",
      severity: "error",
      file,
      line,
      problem: "A hardcoded API key or secret was detected.",
      why: "Secrets in the JS bundle are trivially extractable — anyone can unzip an APK/IPA and read the strings. Committing them also leaks them through git history.",
      impact: "Quota theft, unexpected billing, or abuse of the exposed service.",
      fix: {
        description:
          "Move it to a secured config/EAS secret and rotate the exposed key.",
      },
      docsUrl: docs("hardcoded-secret"),
    }),
  },
  {
    re: HTTP_URL,
    build: (file, line) => ({
      ruleId: "security/no-http-url",
      inspector: "security",
      severity: "warning",
      file,
      line,
      problem: "A plaintext http:// endpoint is used.",
      why: "Traffic over http is unencrypted and can be read or modified on any hop. iOS App Transport Security and Android cleartext policies also block these by default in release builds.",
      impact:
        "Man-in-the-middle interception, and requests silently failing on release builds.",
      fix: {
        description: "Use https:// (localhost/emulator hosts are exempt).",
      },
      docsUrl: docs("no-http-url"),
    }),
  },
];

export const secretsCheck: Check = {
  id: "rn-secrets",
  inspector: "security",
  tier: "commit",
  appliesTo: () => true,
  async run(files) {
    const start = Date.now();
    const issues: Issue[] = [];

    for (const file of sourceFiles(files)) {
      const content = readFileSafe(file.absPath);
      if (content === null) continue;
      const lines = toLines(content);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const rule of RULES) {
          if (rule.re.test(line)) issues.push(rule.build(file.path, i + 1));
        }
      }
    }

    const hasError = issues.some((i) => i.severity === "error");
    return {
      status: hasError ? "fail" : issues.length ? "warn" : "pass",
      issues,
      durationMs: Date.now() - start,
    };
  },
};
