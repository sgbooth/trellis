/**
 * The client app's broker-hosted server side. Mounted by apps/server (the
 * core broker) — everything under `server/` runs in the trusted Node process,
 * never in the sandboxed plugin webview.
 *
 * Composition root only. Handlers live one file per method prefix under
 * `handlers/`, their data access under `services/`.
 */
export { rpcSpec } from "../rpcSpec.js";
export { handlers } from "./rpcHandlers.js";
export { setRoomPublisher } from "./channelBridge.js";
