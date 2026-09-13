import { lazy } from "react";
import type { ComponentType } from "react";
import type { PluginComponentProps, PluginModule } from "@trellis/sdk";

/**
 * Loads the client app's built bundle from apps/server — the actual
 * distribution mechanism: push a new build there and every running shell
 * picks it up on next load, no per-machine file copy and no shell rebuild.
 * Replaces the old Rust `plugin://` protocol handler, which read straight
 * off local disk.
 *
 * A function rather than a module-level `lazy(...)` because the broker URL
 * now differs per entry point (the desktop shell targets a fixed dev host,
 * the browser build is served by the broker itself), so it isn't known until
 * an entry decides it.
 */

// React.lazy must be called once per URL and reused: a fresh lazy component
// on every render remounts the client app and refetches its bundle.
const cache = new Map<string, ComponentType<PluginComponentProps>>();

/**
 * Forgets the cached component for a URL, so the next `loadPluginComponent`
 * refetches instead of replaying the cached result.
 *
 * Needed for retry-after-failure specifically: `React.lazy` memoises the
 * *promise* it was given, so a lazy component whose import rejected stays
 * rejected forever. Re-rendering it — even after resetting the error boundary —
 * replays the failure without another network request. Dropping the entry here
 * is what makes a retry actually retry.
 */
export function clearPluginCache(serverUrl: string): void {
  cache.delete(serverUrl);
}

export function loadPluginComponent(serverUrl: string): ComponentType<PluginComponentProps> {
  const cached = cache.get(serverUrl);
  if (cached) return cached;

  // dist/index.js's default export is definePlugin's `{ Component }`, not a
  // bare component — React.lazy needs `{ default: ComponentType }`, so remap
  // it in the resolved-module .then(). The cast is needed because a
  // non-literal dynamic import specifier resolves to `any`; without it, TS
  // can't infer the component's prop type and every usage would need an `any`
  // escape hatch instead of one cast here.
  const component = lazy(() =>
    import(/* @vite-ignore */ `${serverUrl}/client/index.js`).then((mod) => {
      const pluginModule = mod.default as PluginModule;
      return { default: pluginModule.Component };
    }),
  );

  cache.set(serverUrl, component);
  return component;
}
