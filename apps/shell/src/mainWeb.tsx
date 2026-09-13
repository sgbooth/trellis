// Must be imported first, for its side effect — see main.tsx.
import "./reactGlobals";

import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import type { IdentityInfo } from "@trellis/sdk";
import App from "./App";
import { IdentityPrompt } from "./IdentityPrompt";
import { createWebHost, WEB_SERVER_URL } from "./hosts/webHost";

/**
 * The browser entry point (web.html), served by the broker alongside the
 * client bundle. Counterpart to main.tsx / index.html for Tauri.
 *
 * Everything below the shell — the client app, the broker, RPC and channels —
 * is already host-agnostic, so the only thing this has to solve differently
 * is identity: there's no OS to ask, so it asks the user and remembers.
 */
const STORAGE_KEY = "trellis.identity";

function readStoredIdentity(): IdentityInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // Validated rather than cast: this is user-writable storage, and a
    // half-written value would otherwise surface as a confusing failure
    // deep in identity:claim.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as IdentityInfo).username === "string" &&
      typeof (parsed as IdentityInfo).displayName === "string"
    ) {
      return parsed as IdentityInfo;
    }
    return null;
  } catch {
    // Malformed JSON, or storage blocked (private mode / third-party
    // restrictions). Falling back to the prompt keeps the app usable; it
    // just asks again each load.
    return null;
  }
}

function WebRoot() {
  const [identity, setIdentity] = useState<IdentityInfo | null>(readStoredIdentity);

  // Memoised because createWebHost opens the broker socket — rebuilding it on
  // every render would reconnect (and re-claim identity) constantly.
  const host = useMemo(() => (identity ? createWebHost(identity) : null), [identity]);

  if (!identity || !host) {
    return (
      <IdentityPrompt
        onSubmit={(next) => {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            // Non-fatal: proceed for this session without persisting.
          }
          setIdentity(next);
        }}
      />
    );
  }

  return <App host={host} serverUrl={WEB_SERVER_URL} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WebRoot />
  </React.StrictMode>,
);
