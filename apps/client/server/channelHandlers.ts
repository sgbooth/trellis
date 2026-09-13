import type { ChannelHandlerMap } from "@trellis/sdk/realtime";
import type { TrellisChannels } from "#channelSpec";
import { chatChannels } from "./channels/chatChannels.js";
import { peerChannels } from "./channels/peerChannels.js";

/**
 * Every channel family's handlers, keyed by family. The `satisfies` is what
 * guarantees the spec is covered — a family in channelSpec.ts with no entry
 * here fails at compile time, exactly as rpcHandlers.ts does for methods.
 */
export const channelHandlers = {
  chat: chatChannels,
  peer: peerChannels,
} satisfies ChannelHandlerMap<TrellisChannels>;
