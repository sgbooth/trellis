// Must be imported first, for its side effect: it publishes the shared React
// instance the client bundle binds to. Anything that could load that bundle
// has to come after it.
import "./reactGlobals";

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import type { HostContext, IdentityInfo } from "@trellis/sdk";
import App from "./App";
import { createIdentityApi } from "./identityHost";
import { createTauriHost, TAURI_SERVER_URL } from "./hosts/tauriHost";

/**
 * The Tauri desktop entry point (index.html), and what `tauri.conf.json`'s
 * window loads. Its counterpart is mainWeb.tsx / web.html, served to browsers
 * by the broker; the two differ only in where identity comes from and which
 * host APIs exist.
 */
function TauriRoot() {
  const [host, setHost] = useState<HostContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createIdentityApi()
      .get()
      .then((identity: IdentityInfo) => {
        if (!cancelled) setHost(createTauriHost(identity));
      })
      // Without this the rejection is unhandled and the shell hangs on
      // "Loading…" forever with nothing in the UI to say why — which is
      // exactly what a browser hitting this entry point used to do, since
      // Tauri's `invoke` rejects outside the webview.
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="app-root" style={{ padding: "2rem" }}>
        <h2>Could not determine the current user</h2>
        <p role="alert">{error}</p>
        <p>
          This entry point needs Tauri&apos;s <code>get_os_identity</code> command. In a plain
          browser, use <code>/web.html</code> instead.
        </p>
      </div>
    );
  }

  if (!host) return <p>Loading…</p>;

  return <App host={host} serverUrl={TAURI_SERVER_URL} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TauriRoot />
  </React.StrictMode>,
);
