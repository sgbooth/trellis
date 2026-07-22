import type { ComponentType } from "react";
import type { HostContext, PluginManifest } from "./types";

export interface PluginComponentProps {
  host: HostContext;
}

export interface PluginModule {
  manifest: PluginManifest;
  Component: ComponentType<PluginComponentProps>;
}

/**
 * Identity function — exists so plugin authors get a type-checked shape
 * (manifest + Component) at the module boundary instead of discovering
 * mismatches only when the shell tries to load them.
 */
export function definePlugin(mod: PluginModule): PluginModule {
  return mod;
}
