import type { PeerMessage } from "#rpcSpec";

/**
 * Durable peer messages, keyed by **channel name** (`peer` or `peer/{roomId}`)
 * rather than by target, so the everyone-channel and each room keep separate
 * histories without the store needing to know what a target is.
 *
 * Extracted for the same reason as chatStore: `rpc.peer.send` writes it and
 * the channel snapshot reads it, and both must see the same data.
 *
 * In-memory only — restarting the broker drops history.
 */

const byChannel = new Map<string, PeerMessage[]>();

/** Messages kept per channel. */
const HISTORY_LIMIT = 50;

/** Channels kept at all — see chatStore for why this bound is needed. */
const MAX_CHANNELS = 500;

/**
 * History for a channel, oldest first. Returns a copy and does not allocate an
 * entry for an unknown channel — see chatStore's `historyFor` for why reading
 * must be free.
 */
export function historyFor(channelName: string): PeerMessage[] {
  const history = byChannel.get(channelName);
  return history ? [...history] : [];
}

export function appendMessage(channelName: string, message: PeerMessage): void {
  const existing = byChannel.get(channelName);
  const history = existing ?? [];
  if (existing) byChannel.delete(channelName);
  byChannel.set(channelName, history);

  history.push(message);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);

  while (byChannel.size > MAX_CHANNELS) {
    const oldest = byChannel.keys().next();
    if (oldest.done) break;
    byChannel.delete(oldest.value);
  }
}

/** Test seam: drops all history. Not used by the running broker. */
export function resetPeerStore(): void {
  byChannel.clear();
}
