import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { HostContext, IdentityInfo, PluginManifest, PluginModule } from "@trellis/sdk";
import { createIdentityApi } from "./identityHost";
import { createChatApi } from "./chatHost";
import { createDeviceApi } from "./deviceHost";
import { createFilesApi } from "./filesHost";
import { scopeHostContext } from "./scopeHostContext";
import { PluginErrorBoundary } from "./PluginErrorBoundary";
import "./App.css";

// The "client" authority in plugin://client/... — matches apps/client's
// dist output, served by the Rust-registered plugin:// protocol
// (apps/shell/src-tauri/src/lib.rs).
const PLUGIN_ID = "client";

// dist/index.js's default export is definePlugin's whole { manifest,
// Component }, not a bare component — React.lazy needs { default:
// ComponentType }, so remap it in the resolved-module .then(). The cast is
// needed because a non-literal dynamic import specifier resolves to `any`;
// without it, TS can't infer PluginComponent's prop type (host) and every
// usage below would need an `any` escape hatch instead of one cast here.
const PluginComponent = lazy(() =>
  import(/* @vite-ignore */ `plugin://${PLUGIN_ID}/index.js`).then((mod) => {
    const pluginModule = mod.default as PluginModule;
    return { default: pluginModule.Component };
  }),
);

function App() {
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [manifest, setManifest] = useState<PluginManifest | null>(null);

  useEffect(() => {
    createIdentityApi()
      .get()
      .then(setIdentity);
  }, []);

  useEffect(() => {
    fetch(`plugin://${PLUGIN_ID}/manifest.json`)
      .then((res) => res.json())
      .then(setManifest);
  }, []);

  // The "full" host — everything the shell can grant. The plugin only ever
  // sees the subset its manifest declared, via scopeHostContext.
  const fullHost: HostContext = useMemo(() => {
    const base: HostContext = { device: createDeviceApi(), files: createFilesApi() };
    if (identity) {
      base.identity = { get: async () => identity };
      base.chat = createChatApi(identity);
    }
    return base;
  }, [identity]);

  if (!manifest) {
    return <div className="app-root">Loading plugin manifest…</div>;
  }

  return (
    <div className="app-root">
      <PluginErrorBoundary>
        <Suspense fallback={<p>Loading plugin…</p>}>
          <PluginComponent host={scopeHostContext(fullHost, manifest.capabilities)} />
        </Suspense>
      </PluginErrorBoundary>
    </div>
  );
}

export default App;
