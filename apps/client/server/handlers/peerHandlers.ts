import type { HandlersFor } from "@trellis/sdk/rpc";
import type { rpcSpec, PeerMessage, PeerTarget } from "#rpcSpec";
import { channelForTarget } from "#channelSpec";
import { publishToChannel } from "#server/channelBridge.js";
import { appendMessage } from "#server/peerStore.js";
import { requireMessageText, requireRoomId } from "#server/input.js";

/**
 * Durable client-to-client messages. This is the RPC half of the `peer`
 * feature; the ephemeral half is the publish hook in
 * `server/channels/peerChannels.ts`.
 *
 * It is an RPC method rather than a channel publish for one reason: the
 * server has to stamp `id`, `from` and `ts`, and the sender needs those back.
 */

/** Off the wire, so the union is narrowed rather than trusted. */
function parseTarget(target: PeerTarget): PeerTarget {
  if (!target || typeof target !== "object") throw new Error("target is required");
  if (target.kind === "all") return { kind: "all" };
  if (target.kind === "room") {
    const roomId = requireRoomId(target.roomId);
    // Rooms are addressed by name, so a `/` would silently widen the audience
    // by changing which channel the name parses to.
    return { kind: "room", roomId };
  }
  throw new Error(`unknown target kind: ${String((target as { kind?: unknown }).kind)}`);
}

export const peerHandlers: HandlersFor<typeof rpcSpec, "peer"> = {
  "peer.send": async ({ target, text }, ctx) => {
    const parsed = parseTarget(target);
    const parsedText = requireMessageText(text);

    const message: PeerMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // Server-assigned, never taken from params. Client-claimed and
      // unverified — audit trail, not authorization.
      from: ctx.identity?.username ?? "unknown",
      text: parsedText,
      ts: Date.now(),
      target: parsed,
    };

    // One place turns a target into a channel, shared with the subscriber —
    // so "everyone" and "this room" cannot drift apart between the two.
    const channel = channelForTarget(parsed);
    appendMessage(channel.name, message);
    publishToChannel(channel, { type: "message", message });

    // Returned as well as broadcast, so the sender renders immediately rather
    // than waiting to recognise its own message coming back.
    return message;
  },
};
