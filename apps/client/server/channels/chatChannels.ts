import type { ChannelHandlersFor } from "@trellis/sdk/realtime";
import type { TrellisChannels } from "#channelSpec";
import { historyFor } from "#server/chatStore.js";
import { requireRoomId } from "#server/input.js";

/**
 * Everything for the `chat` family, the same way chatHandlers.ts holds every
 * `chat.*` RPC method: open the file named for the family and you see all of
 * it. `ChannelHandlersFor` types both hooks off channelSpec.ts, so the
 * payloads here and the ones ChatPanel subscribes with cannot drift.
 *
 * No `publish` hook: sending a chat message is `rpc.chat.send`, because the
 * server has to stamp it with an id, a sender and a timestamp and hand those
 * back. Client publish is for traffic where the server doesn't need to
 * answer — CRDT deltas, presence — which chat isn't.
 */
export const chatChannels: ChannelHandlersFor<TrellisChannels, "chat"> = {
  snapshot: ({ id }) => {
    // `id` is the room segment of `chat/<roomId>` and comes off the wire, so
    // it's validated here rather than trusted from the type.
    return historyFor(requireRoomId(id, true));
  },
};
