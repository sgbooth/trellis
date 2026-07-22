import { openPath } from "@tauri-apps/plugin-opener";
import type { FilesApi } from "@trellis/sdk";

/**
 * Real Tauri-opener-backed FilesApi — only `open` is implemented; the rest
 * of FilesApi (read/write/watch/openDialog) stays unwired, same as every
 * other unimplemented capability.
 */
export function createFilesApi(): FilesApi {
  return {
    async open(path, openWith) {
      await openPath(path, openWith);
    },
  };
}
