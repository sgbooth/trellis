import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import type { FilesApi } from "@trellis/sdk";

/**
 * Real FilesApi surface — `open` (Tauri-opener) and `onClosed` (backed by
 * the `watch_file_closed` command / close_watch.rs, Linux-only for now) are
 * implemented; the rest of FilesApi (read/write/watch/openDialog) stays
 * unwired, same as every other unimplemented HostContext field.
 */
export function createFilesApi(): FilesApi {
  return {
    async open(path, openWith) {
      await openPath(path, openWith);
    },
    onClosed(path, callback) {
      let cancelled = false;
      let unlisten: (() => void) | undefined;

      listen<string>("files:closed-event", (event) => {
        if (event.payload === path) callback();
      }).then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

      invoke("watch_file_closed", { path }).catch((err) => {
        console.error("[files] watch_file_closed failed", err);
      });

      return () => {
        cancelled = true;
        unlisten?.();
      };
    },
  };
}
