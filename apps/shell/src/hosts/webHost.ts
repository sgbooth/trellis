import type { HostContext, IdentityInfo } from "@trellis/sdk";
import { createRealtimeApi } from "../realtimeHost";

/**
 * Always the page's own origin, in both dev and production — so there is
 * nothing to configure here and no mode-dependent branch.
 *
 * In production that is literally true: the broker serves this build itself
 * (see serveStatic in apps/server/src/app.ts), so its origin *is* the broker,
 * which is more accurate than any configured value could be. In dev the Vite
 * server stands in for it, forwarding `/socket.io` and `/client` to the broker
 * (see the `proxy` block in vite.config.ts).
 *
 * The desktop entry can't do this — it runs from `tauri://localhost` and has to
 * be told where the broker is. That asymmetry is the whole difference between
 * the two hosts, and it lives here rather than in shared config.
 */
export const WEB_SERVER_URL = window.location.origin;

/**
 * The browser host. Deliberately smaller than the desktop one: no `device`,
 * no `files`, because those are Tauri-IPC-backed and a browser tab has no
 * equivalent. Leaving them absent needs no new mechanism — HostContext's
 * fields are already optional and consumers already feature-detect
 * (see TrellisInfo's `if (!host.device)`).
 *
 * `identity` is resolved before this is called and is a claim the user typed.
 * That is no weaker than the desktop path: the OS identity is equally
 * unverified and equally audit-trail-only. Neither is an auth signal.
 */
export function createWebHost(identity: IdentityInfo): HostContext {
  return {
    identity: { get: async () => identity },
    realtime: createRealtimeApi(identity, WEB_SERVER_URL),
  };
}
