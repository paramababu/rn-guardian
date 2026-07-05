import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  // Keep the CLI runnable directly via the bin shebang.
  banner: { js: "#!/usr/bin/env node" },
});
