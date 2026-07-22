import { invoke } from "@tauri-apps/api/core";
import type { IdentityApi, IdentityInfo } from "@trellis/sdk";

/**
 * Real Tauri-IPC-backed IdentityApi — thin wrapper over the `get_os_identity`
 * Rust command. Audit-trail only; see IdentityApi's doc comment in
 * @trellis/sdk for the "not a security signal" caveat.
 */
export function createIdentityApi(): IdentityApi {
  return {
    async get() {
      return invoke<IdentityInfo>("get_os_identity");
    },
  };
}
