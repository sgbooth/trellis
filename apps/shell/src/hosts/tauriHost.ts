import type { HostContext, IdentityInfo } from "@trellis/sdk";
import { createDeviceApi } from "../deviceHost";
import { createFilesApi } from "../filesHost";
import { createRealtimeApi } from "../realtimeHost";

/**
 * Where this build's broker lives — baked in at build time, because the desktop
 * shell runs from `tauri://localhost`: it has neither an origin to derive the
 * value from nor a process environment to read it out of, unlike the browser
 * entry and the broker itself.
 *
 * Set it for a real build by exporting `VITE_TRELLIS_SERVER_URL` before
 * `pnpm build`; Vite reads `VITE_`-prefixed variables straight from the
 * environment, so there is no `.env` to create. The name is declared in
 * src/vite-env.d.ts, and listed in turbo.json's `build.env` so a cached build
 * can't ship a stale URL.
 *
 * Read here rather than through a shared config module: each entry point owns
 * how it resolves the broker (the browser one uses its own origin), and keeping
 * that here is what makes a new entry point a new `main*.tsx` plus a
 * `hosts/*.ts` and nothing else.
 */
export const TAURI_SERVER_URL =
  import.meta.env.VITE_TRELLIS_SERVER_URL ?? "http://localhost:8787";

/**
 * The desktop host: everything the Tauri shell can construct, unscoped.
 * apps/client and apps/shell are built by the same team at the same trust
 * level, so there's no capability-scoping step between them.
 *
 * The Tauri IPC adapters are imported *here* rather than in a shared module
 * so the browser entry never pulls them in — `invoke` only rejects at call
 * time, so a web bundle that imported them would fail late and confusingly
 * instead of simply not offering the API.
 */
export function createTauriHost(identity: IdentityInfo): HostContext {
  return {
    device: createDeviceApi(),
    files: createFilesApi(),
    identity: { get: async () => identity },
    realtime: createRealtimeApi(identity, TAURI_SERVER_URL),
  };
}
