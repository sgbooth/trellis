import React from "react";
import ReactDOM from "react-dom/client";
import * as ReactJsxRuntime from "react/jsx-runtime";
import App from "./App";

declare global {
  // eslint-disable-next-line no-var
  var __trellisReact: typeof React;
  // eslint-disable-next-line no-var
  var __trellisReactJsxRuntime: typeof ReactJsxRuntime;
}

// Handed to the dynamically-loaded plugin bundle via its build-time shim
// (apps/client/shims) — one shared React instance, not a duplicate copy
// bundled into the plugin, which would silently break hooks/context. Must
// run before App ever tries to load the bundle from apps/server.
globalThis.__trellisReact = React;
globalThis.__trellisReactJsxRuntime = ReactJsxRuntime;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
