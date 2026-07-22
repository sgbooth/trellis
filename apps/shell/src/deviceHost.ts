import { invoke } from "@tauri-apps/api/core";
import type { DeviceApi, DeviceInfo } from "@trellis/sdk";

/**
 * Real Tauri-IPC-backed DeviceApi — thin wrapper over the `get_device_info`
 * Rust command. Informational only; see DeviceInfo's doc comment in
 * @trellis/sdk for the "not a security signal" caveat.
 */
export function createDeviceApi(): DeviceApi {
  return {
    async get() {
      return invoke<DeviceInfo>("get_device_info");
    },
  };
}
