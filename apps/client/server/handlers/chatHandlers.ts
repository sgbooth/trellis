import type { HandlersFor } from "@trellis/sdk/rpc";
import type { rpcSpec, ChatMessage } from "#rpcSpec";
import { channels } from "#channelSpec";
import { publishToChannel } from "#server/channelBridge.js";
import { appendMessage, historyFor } from "#server/chatStore.js";
import { requireMessageText, requireRoomId } from "#server/input.js";

export const chatHandlers: HandlersFor<typeof rpcSpec, "chat"> = {
  "chat.send": async ({ roomId, text }, ctx) => {
    // Validated at runtime even though the spec types the caller: nothing
    // enforces those types on the wire, so they are not a trust boundary.
    const parsedRoomId = requireRoomId(roomId, true);
    const parsedText = requireMessageText(text);

    const message: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // Server-assigned, never taken from params. `ctx.identity` is
      // client-claimed and unverified — audit-trail only, not auth.
      from: ctx.identity?.username ?? "unknown",
      text: parsedText,
      ts: Date.now(),
    };

    appendMessage(parsedRoomId, message);

    // Broadcast to the room *and* return to the sender, so the sender doesn't
    // have to correlate its own message out of the stream. The room is built
    // from the same constructor the subscriber uses, not a template string.
    publishToChannel(channels.chat(parsedRoomId), { type: "message", message });
    return message;
  },

  "chat.history": async ({ roomId }) => historyFor(requireRoomId(roomId, true)),
};
