import type { Capability, HostContext } from "@trellis/sdk";

const CAPABILITY_TO_HOST_KEY: Partial<Record<Capability, keyof HostContext>> = {
  "identity:read": "identity",
  "chat:invoke": "chat",
  "device:info": "device",
  "files:read": "files",
  "files:write": "files",
  "files:watch": "files",
  "files:open-dialog": "files",
  "files:open-file": "files",
  "llm:invoke": "llm",
  "clipboard:read": "clipboard",
  "clipboard:write": "clipboard",
  "database:query": "database",
  "secrets:read": "secrets",
  "secrets:write": "secrets",
  "media:camera": "camera",
  "media:microphone": "microphone",
  "notifications:send": "notifications",
};

/**
 * Reduces a fully-assembled HostContext down to only the fields a plugin's
 * declared capabilities entitle it to. Capabilities the plugin didn't
 * declare stay omitted from the result, matching HostContext's
 * feature-detection contract even though the shell built one "full" host
 * internally.
 *
 * The `capabilities` passed in here are already trustworthy by the time
 * they arrive — the plugin:// protocol handler (apps/shell/src-tauri/src/
 * lib.rs) filters manifest.json's self-declared capabilities against
 * allowed-capabilities.json before the shell ever fetches it, so a plugin
 * can't grant itself more than the shell allows just by asking. This
 * function is purely the mechanical "capability string → HostContext key"
 * reduction, not itself a security boundary.
 */
export function scopeHostContext(full: HostContext, capabilities: Capability[]): HostContext {
  const scoped: HostContext = {};
  for (const capability of capabilities) {
    const key = CAPABILITY_TO_HOST_KEY[capability];
    if (key && full[key]) {
      (scoped as Record<string, unknown>)[key] = full[key];
    }
  }
  return scoped;
}
