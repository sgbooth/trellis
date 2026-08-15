import { channel } from "@trellis/sdk/realtime";
import type { Channel } from "@trellis/sdk/realtime";
import type { ChatMessage } from "./rpcSpec.js";

/**
 * ON HOLD — the realtime/channel half of the broker contract.
 *
 * The mechanism works end to end (see the chat panel), but the design is
 * parked: `chat` is the only family, since it's the only one with a real
 * payload shape. Don't build on this without picking the design back up.
 *
 * Kept separate from rpcSpec.ts so the live RPC surface stays readable, and
 * so unparking this is one file rather than an archaeology exercise.
 *
 * Same constraints as rpcSpec.ts: no runtime dependencies, `type` not
 * `interface`.
 */

export type { ChatMessage };

export type TrellisChannels = {
  chat: { event: { type: "message"; message: ChatMessage }; snapshot: ChatMessage[] };
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
};
