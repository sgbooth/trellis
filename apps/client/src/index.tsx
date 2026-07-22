import { definePlugin, TrellisInfo } from "@trellis/sdk";
import type { PluginManifest } from "@trellis/sdk";
import manifestJson from "./manifest.json";

// JSON imports type as plain string[]/string, not the Capability union —
// cast back to PluginManifest. manifest.json is also what the build step
// (build.mjs) copies alongside the bundled JS output.
const manifest = manifestJson as PluginManifest;

export default definePlugin({
  manifest,
  Component: TrellisInfo,
});
