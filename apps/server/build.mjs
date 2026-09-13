// Bundles the broker into a single runnable JS file.
//
// `tsc` alone cannot produce one: apps/server imports `@trellis/client/server`
// and `@trellis/sdk/realtime`, and both workspace packages ship TypeScript
// source rather than built JS (their package.json `exports` point at .ts). tsc
// emits those import specifiers untouched, so `node dist/index.js` died with
// ERR_MODULE_NOT_FOUND on a build that had just reported success.
//
// So: bundle the workspace packages in, and leave real npm dependencies to be
// resolved from node_modules at runtime — the same split apps/client/build.mjs
// makes, for the same reason.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

// Workspace deps must be bundled (they are .ts); everything else is a real
// package on disk at runtime and should stay external, so we don't inline
// socket.io and its transitive tree into our own output.
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@trellis/"));

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/index.js",
  external,
  sourcemap: true,
  logLevel: "info",
});

// NOTE: the output stays at dist/index.js, one level under apps/server, so the
// `../../client/dist` and `../../shell/dist` URLs resolved against
// import.meta.url in app.ts still land on the right directories.
