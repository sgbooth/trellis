import { definePlugin, TrellisInfo } from "@trellis/sdk";
import type { PluginComponentProps, PluginManifest } from "@trellis/sdk";
import { ChatPanel } from "./ChatPanel";
import { initRpc } from "./rpc.js";
import manifestJson from "./manifest.json";

// JSON imports type as plain string[]/string, not the Capability union —
// cast back to PluginManifest. manifest.json is also what the build step
// (build.mjs) copies alongside the bundled JS output.
const manifest = manifestJson as PluginManifest;

// TrellisInfo is the SDK's domain-free starter (identity + device); anything
// built on this deployment's own channels belongs here instead.
const Component: React.FC<PluginComponentProps> = ({ host }) => {
  // Arms the `rpc` singleton before anything can call it. Synchronous and
  // idempotent, so it's safe to run during render rather than in an effect.
  initRpc(host);
  return (
    <>
      <TrellisInfo host={host} />
      <ChatPanel host={host} />
    </>
  );
};

export default definePlugin({
  manifest,
  Component,
});
