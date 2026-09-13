/**
 * The client app's broker-hosted server side. Mounted by apps/server (the
 * core broker) — everything under `server/` runs in the broker's Node
 * process rather than in the client webview, because it is shared across
 * every connected shell, not because the webview is less trusted.
 *
 * Composition root only. RPC handlers live one file per method prefix under
 * `handlers/`; channel handlers one file per family under `channels/`.
 */
export { rpcSpec } from "#rpcSpec";
export { handlers } from "./rpcHandlers.js";
export { channelHandlers } from "./channelHandlers.js";
export { setChannelPublisher } from "./channelBridge.js";
