import type { ComponentType } from "react";
import type { HostContext } from "./types";

export interface PluginComponentProps {
  host: HostContext;
}

/**
 * The shape of a client app's default export. One field, because one field is
 * all the loader reads: apps/shell/src/pluginLoader.ts pulls `Component` out
 * and hands it to `React.lazy`.
 *
 * It carried a `manifest` until it didn't. Nothing ever read it — the loader
 * discarded it, and the `sdkVersion` range it declared was checked by nobody —
 * so it was a contract in name only. If a real version handshake is ever
 * wanted, it belongs where it can actually be enforced (the loader, refusing
 * to mount an incompatible bundle), not as a field the build copies around.
 */
export interface PluginModule {
  Component: ComponentType<PluginComponentProps>;
}

/**
 * Identity function — exists so client authors get a type-checked shape at the
 * module boundary instead of discovering a mismatch only when the shell tries
 * to load the bundle.
 */
export function definePlugin(mod: PluginModule): PluginModule {
  return mod;
}
