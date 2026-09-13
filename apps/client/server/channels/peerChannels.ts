import type { ChannelHandlersFor } from "@trellis/sdk/realtime";
import { channels } from "#channelSpec";
import type { TrellisChannels } from "#channelSpec";
import { publishToChannel } from "#server/channelBridge.js";
import { historyFor } from "#server/peerStore.js";
import { requireRoomId } from "#server/input.js";

/**
 * The `peer` family — client-to-client traffic for both targets, since `peer`
 * and `peer/{roomId}` are the same family.
 *
 * Unlike `chat`, this family *does* implement `publish`: ephemeral signals
 * are exactly what client publish is for — high-frequency, and the server has
 * nothing to answer. Durable messages still go through `rpc.peer.send`,
 * because those need a server-stamped id, sender and timestamp.
 */
export const peerChannels: ChannelHandlersFor<TrellisChannels, "peer"> = {
  // Keyed by full channel name, so `peer` and `peer/eng` don't share history.
  // A joiner sees only what was sent to the audience it actually joined.
  snapshot: ({ channel, id }) => {
    if (id !== undefined) requireRoomId(id);
    return historyFor(channel);
  },

  publish: (ctx, event) => {
    // Off the wire, so validated rather than trusted — the spec types the
    // caller but nothing enforces it on the socket.
    if (!event || typeof event !== "object") throw new Error("event must be an object");

    // The event union also carries `message`, which is deliberately NOT
    // publishable: a durable message must be stamped by the server, and
    // accepting one here would let a client forge an id, timestamp, or
    // sender. Sending a message is rpc.peer.send; publish is signals only.
    if (event.type !== "signal") {
      throw new Error("only ephemeral signals may be published; use rpc.peer.send for messages");
    }

    const kind = event.signal?.kind;
    if (kind !== "typing" && kind !== "here") throw new Error(`unknown signal kind: ${String(kind)}`);

    // Re-stamp `from` rather than relaying what the client claimed, so a
    // client cannot sign a signal as somebody else. Still only as trustworthy
    // as the unverified identity claim itself — audit trail, not auth.
    //
    // Fanning out is the handler's job: `publish` returns void, and the
    // bridge is what lets it reach the room without holding a socket.
    // `ctx.id` is the room segment, or undefined for the everyone-channel —
    // so this addresses whichever audience the publisher used.
    publishToChannel(channels.peer(ctx.id), {
      type: "signal",
      signal: { kind, from: ctx.identity?.username ?? "unknown" },
    });
  },
};
