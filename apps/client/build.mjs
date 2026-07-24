// Bundles this plugin into a standalone JS module + manifest.json, the
// artifact apps/server serves as static files and apps/shell loads via
// React.lazy (see apps/server/src/app.ts, apps/shell/src/App.tsx).
import { context, build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const watch = process.argv.includes("--watch");

mkdirSync("dist", { recursive: true });

const shim = (name) => fileURLToPath(new URL(`./shims/${name}`, import.meta.url));

const options = {
  entryPoints: ["src/index.tsx"],
  bundle: true,
  format: "esm",
  outfile: "dist/index.js",
  // "react"/"react/jsx-runtime" are aliased to shims that read the shared
  // React instance off globalThis instead of bundling a duplicate copy —
  // see shims/react.cjs for why (duplicate React breaks hooks/context).
  alias: {
    react: shim("react.cjs"),
    "react/jsx-runtime": shim("react-jsx-runtime.cjs"),
  },
  jsx: "automatic",
  sourcemap: true,
  logLevel: "info",
};

function copyManifest() {
  cpSync("src/manifest.json", "dist/manifest.json");
}

if (watch) {
  const ctx = await context(options);
  copyManifest();
  await ctx.watch();
  console.log("[client] watching for changes…");
} else {
  await build(options);
  copyManifest();
}
