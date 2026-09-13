import React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";

/**
 * Handed to the dynamically-loaded client bundle via its build-time shim
 * (apps/client/shims) — one shared React instance, not a duplicate copy
 * bundled into the client, which would silently break hooks/context.
 *
 * Its own module rather than inlined in an entry point because *every* entry
 * point needs it, and needs it to have run before anything imports the
 * bundle. Importing this module for its side effect is the whole contract:
 * a second entry that forgot to do this would fail confusingly, at the first
 * hook the client app calls.
 */
// `var`, not `let`/`const`: only `var` declares a property on `globalThis`,
// which is what `globalThis.__trellisReact = …` below is assigning to and what
// the client bundle's shims read. (There is no linter in this repo to object —
// see CLAUDE.md's "Workflow".)
declare global {
  var __trellisReact: typeof React;
  var __trellisReactJsxRuntime: typeof ReactJsxRuntime;
}

globalThis.__trellisReact = React;
globalThis.__trellisReactJsxRuntime = ReactJsxRuntime;
