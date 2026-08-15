import type { HandlersFor } from "@trellis/sdk/rpc";
import type { rpcSpec, ChatMessage } from "../../rpcSpec.js";
import { publishToRoom } from "../channelBridge.js";

// In-memory only — restarting the broker drops history.
const rooms = new Map<string, ChatMessage[]>();
const HISTORY_LIMIT = 100;

function historyFor(roomId: string): ChatMessage[] {
  const existing = rooms.get(roomId);
  if (existing) return existing;
  const created: ChatMessage[] = [];
  rooms.set(roomId, created);
  return created;
}

export const chatHandlers: HandlersFor<typeof rpcSpec, "chat"> = {
  "chat.send": async ({ roomId, text }, ctx) => {
    // Validated at runtime even though the spec types the caller — the caller
    // is the sandboxed webview, so types are not a trust boundary.
    if (typeof roomId !== "string" || !roomId) throw new Error("roomId is required");
    if (typeof text !== "string" || !text.trim()) throw new Error("text is required");

    const message: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // Server-assigned, never taken from params. `ctx.identity` is
      // client-claimed and unverified — audit-trail only, not auth.
      from: ctx.identity?.username ?? "unknown",
      text: text.trim(),
      ts: Date.now(),
    };

    const room = historyFor(roomId);
    room.push(message);
    if (room.length > HISTORY_LIMIT) room.splice(0, room.length - HISTORY_LIMIT);

    // Broadcast to the room *and* return to the sender, so the sender doesn't
    // have to correlate its own message out of the stream.
    publishToRoom(`chat/${roomId}`, { type: "message", message });
    return message;
  },

  "chat.history": async ({ roomId }) => historyFor(roomId),
};
