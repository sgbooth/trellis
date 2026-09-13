import { channel } from "@trellis/sdk/realtime";
import type { Channel } from "@trellis/sdk/realtime";
import type { ChatMessage, PeerMessage, PeerSignal, PeerTarget } from "./rpcSpec.js";

/**
 * Every channel family in this deployment, in one place — the channel
 * counterpart to rpcSpec.ts, and read the same way.
 *
 * A family maps to exactly one handler file: everything for `chat` is
 * implemented in `server/channels/chatChannels.ts`. Adding a family here
 * makes `server/channelHandlers.ts` fail to compile until it has an entry.
 *
 * Kept separate from rpcSpec.ts so each surface stays readable on its own.
 * Same constraints otherwise: keep runtime dependencies to the SDK's
 * `channel()` alone, and use `type` not `interface`. This file is bundled
 * into the browser by esbuild *and* loaded under Node by the broker.
 */

export type { ChatMessage, PeerMessage, PeerSignal, PeerTarget };

export type TrellisChannels = {
  chat: { event: { type: "message"; message: ChatMessage }; snapshot: ChatMessage[] };
  /**
   * Client-to-client traffic. One family covers both targets: the channel is
   * `peer` for everyone and `peer/{roomId}` for one room — which is why
   * widening or narrowing the audience is a channel-name change, not a new
   * family, handler file, or code path.
   *
   * Two event shapes ride it because they have genuinely different rules:
   * `message` is durable and server-stamped (sent with `rpc.peer.send`),
   * `signal` is ephemeral and client-published.
   */
  peer: {
    event:
      | { type: "message"; message: PeerMessage }
      | { type: "signal"; signal: PeerSignal };
    snapshot: PeerMessage[];
  };
};

const forFamily = <TFamily extends keyof TrellisChannels & string>(
  family: TFamily,
  id?: string,
): Channel<TrellisChannels[TFamily]["event"], TrellisChannels[TFamily]["snapshot"]> =>
  channel(id === undefined ? family : `${family}/${id}`);

/**
 * Constructors, not string constants, so the `{matterId}` / `{roomId}`
 * segment is a typed required argument — you cannot build `matter/undefined`
 * or misspell a family and find out at runtime. Payload types derive from
 * TrellisChannels rather than being restated, so the two can't drift.
 */
export const channels = {
  chat: (roomId: string) => forFamily("chat", roomId),
  /** No `roomId` is the everyone-channel (`peer`); one narrows to `peer/{id}`.
   *  The optional argument *is* the all-vs-room switch. */
  peer: (roomId?: string) => forFamily("peer", roomId),
};

/**
 * The one place a `PeerTarget` becomes a channel. Sender and subscriber both
 * go through it, so they cannot disagree about which room a target means —
 * the same reason `publishToChannel` takes a descriptor rather than a string.
 *
 * Exhaustive on purpose: `never` in the default branch means adding a target
 * to `PeerTarget` fails to compile here until it is handled.
 */
export function channelForTarget(target: PeerTarget) {
  switch (target.kind) {
    case "all":
      return channels.peer();
    case "room":
      return channels.peer(target.roomId);
    default: {
      const unhandled: never = target;
      throw new Error(`unhandled peer target: ${JSON.stringify(unhandled)}`);
    }
  }
}
