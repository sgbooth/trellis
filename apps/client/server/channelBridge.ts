/**
 * PARKED (realtime on hold) — lets a handler broadcast into a room without
 * holding a socket. The broker installs the real publisher at startup.
 *
 * A no-op default rather than a throw: RPC works standalone, and a handler
 * that broadcasts shouldn't fail just because channels aren't mounted.
 */
type Publisher = (channelName: string, payload: unknown) => void;

let publisher: Publisher = () => {};

export function setRoomPublisher(next: Publisher): void {
  publisher = next;
}

export const publishToRoom: Publisher = (channelName, payload) => publisher(channelName, payload);
