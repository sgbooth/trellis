import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import type { FilesApi } from "@trellis/sdk";

/**
 * Real FilesApi surface — `open` (Tauri-opener) and `onClosed` (backed by the
 * `watch_file_closed` command / close_watch.rs, implemented for Linux via
 * inotify and macOS via libproc polling; Windows is not) are implemented; the
 * rest of FilesApi (read/write/watch/openDialog) stays unwired, same as every
 * other unimplemented HostContext field.
 */
export function createFilesApi(): FilesApi {
  return {
    async open(path, openWith) {
      await openPath(path, openWith);
    },
    async onClosed(path, callback, onError) {
      const watchId = crypto.randomUUID();
      let active = true;
      let closedUnlisten = () => {};
      let errorUnlisten = () => {};
      const stop = () => {
        if (!active) return;
        active = false;
        closedUnlisten();
        errorUnlisten();
        void invoke("cancel_watch_file_closed", { watchId }).catch((cause: unknown) => {
          console.error("[files] cancel_watch_file_closed failed", cause);
        });
      };
      closedUnlisten = await listen<string>("files:closed-event", (event) => {
        if (active && event.payload === path) {
          stop();
          callback();
        }
      });
      try {
        errorUnlisten = await listen<{ watchId: string; message: string }>("files:closed-error", (event) => {
          if (active && event.payload.watchId === watchId) {
            stop();
            onError?.(new Error(event.payload.message));
          }
        });
      } catch (cause) {
        stop();
        throw cause;
      }

      try {
        await invoke("watch_file_closed", { path, watchId });
      } catch (cause) {
        stop();
        throw cause;
      }
      return stop;
    },
  };
}
