import type { ChatMessage } from "#rpcSpec";

/**
 * The chat message store, extracted from chatHandlers.ts only because the
 * channel snapshot in channels/chatChannels.ts genuinely needs the same
 * data — `rpc.chat.history` and the subscribe ack must return the same
 * thing. This is the "extract on real reuse" case, not a services/ layer:
 * everything else stays in the handler that uses it.
 *
 * In-memory only — restarting the broker drops history.
 */

const rooms = new Map<string, ChatMessage[]>();

/** Messages kept per room. */
const HISTORY_LIMIT = 100;

/**
 * Rooms kept at all. Bounds total memory, which `HISTORY_LIMIT` alone does
 * not: it caps each room, while the number of rooms was previously unbounded.
 * Least-recently-written is evicted first.
 */
const MAX_ROOMS = 500;

/**
 * History for a room, oldest first. Returns a copy, and — importantly — does
 * **not** create an entry for a room that has none.
 *
 * That matters because this runs on every `subscribe`, and `authorizeSubscribe`
 * currently admits everyone: an earlier version allocated on read, so anyone
 * could grow the broker's memory without bound just by subscribing to
 * `chat/<random>` in a loop, without ever sending a message. Reads are now
 * free, and only a real write can add a room.
 *
 * The copy also stops a caller mutating the stored history by accident.
 */
export function historyFor(roomId: string): ChatMessage[] {
  const room = rooms.get(roomId);
  return room ? [...room] : [];
}

export function appendMessage(roomId: string, message: ChatMessage): void {
  const existing = rooms.get(roomId);
  const room = existing ?? [];
  // Re-insert on every write so Map iteration order is least-recently-written
  // first, which is what makes the eviction below LRU rather than arbitrary.
  if (existing) rooms.delete(roomId);
  rooms.set(roomId, room);

  room.push(message);
  if (room.length > HISTORY_LIMIT) room.splice(0, room.length - HISTORY_LIMIT);

  while (rooms.size > MAX_ROOMS) {
    const oldest = rooms.keys().next();
    if (oldest.done) break;
    rooms.delete(oldest.value);
  }
}

/** Test seam: drops all history. Not used by the running broker. */
export function resetChatStore(): void {
  rooms.clear();
}
