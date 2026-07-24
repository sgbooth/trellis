import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { HostContext, IdentityInfo, PluginModule } from "@trellis/sdk";
import { createIdentityApi } from "./identityHost";
import { createDeviceApi } from "./deviceHost";
import { createFilesApi } from "./filesHost";
import { PluginErrorBoundary } from "./PluginErrorBoundary";
import "./App.css";

// dev-only hardcode — no deployed server location yet. apps/server serves
// apps/client's built bundle (see apps/server/src/app.ts) — this is the
// actual distribution mechanism: push a new build there and every running
// shell picks it up on next load, no per-machine file copy or shell
// rebuild. Replaces the old Rust `plugin://` protocol handler, which read
// straight off local disk.
const SERVER_URL = "http://localhost:8787";

// dist/index.js's default export is definePlugin's whole { manifest,
// Component }, not a bare component — React.lazy needs { default:
// ComponentType }, so remap it in the resolved-module .then(). The cast is
// needed because a non-literal dynamic import specifier resolves to `any`;
// without it, TS can't infer PluginComponent's prop type (host) and every
// usage below would need an `any` escape hatch instead of one cast here.
const PluginComponent = lazy(() =>
  import(/* @vite-ignore */ `${SERVER_URL}/index.js`).then((mod) => {
    const pluginModule = mod.default as PluginModule;
    return { default: pluginModule.Component };
  }),
);

function App() {
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);

  useEffect(() => {
    createIdentityApi()
      .get()
      .then(setIdentity);
  }, []);

  // The host object handed to the plugin. apps/client and apps/shell are
  // built by the same team at the same trust level, so there's no
  // capability-scoping step — every API the shell can construct is passed
  // straight through.
  const fullHost: HostContext = useMemo(() => {
    const base: HostContext = { device: createDeviceApi(), files: createFilesApi() };
    if (identity) {
      base.identity = { get: async () => identity };
    }
    return base;
  }, [identity]);

  return (
    <div className="app-root">
      <PluginErrorBoundary>
        <Suspense fallback={<p>Loading plugin…</p>}>
          <PluginComponent host={fullHost} />
        </Suspense>
      </PluginErrorBoundary>
    </div>
  );
}

export default App;
