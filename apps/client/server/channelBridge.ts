import type { Channel } from "@trellis/sdk/realtime";

/**
 * Lets a server-side handler broadcast into a room without holding a socket.
 * The broker installs the real publisher at startup (`setChannelPublisher`),
 * backed by the `Broadcast` that `mountChannels` returns.
 *
 * A no-op default rather than a throw: RPC works standalone, and a handler
 * that broadcasts shouldn't fail just because channels aren't mounted.
 */
type RawPublisher = (channelName: string, payload: unknown) => void;

let publisher: RawPublisher = () => {};

export function setChannelPublisher(next: RawPublisher): void {
  publisher = next;
}

/**
 * Takes the same `Channel` descriptor the client subscribes with, rather
 * than a hand-built room string. That is the point of it being typed: the
 * sender and the subscriber now derive the room name from one constructor in
 * channelSpec.ts, so `chat/${roomId}` and `channels.chat(roomId)` cannot
 * disagree — they previously could, with nothing to catch it.
 */
export function publishToChannel<TEvent, TSnapshot>(
  channel: Channel<TEvent, TSnapshot>,
  event: TEvent,
): void {
  publisher(channel.name, event);
}
