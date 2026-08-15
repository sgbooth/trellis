import { io, type Socket } from "socket.io-client";
import { SOCKET_NAMESPACE } from "@trellis/sdk/realtime";
import type {
  Channel,
  ClientToServerEvents,
  IdentityInfo,
  RealtimeApi,
  Result,
  ServerToClientEvents,
  Subscription,
} from "@trellis/sdk";

// dev-only hardcode — no deployed broker location yet.
const SERVER_URL = "http://localhost:8787";

/** How long a single request/subscribe may wait for its ack. */
const ACK_TIMEOUT_MS = 8000;

type TrellisSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type Listener = (event: unknown) => void;

/**
 * Shell-owned socket.io client — plugins never get a raw network client of
 * their own, only what's exposed through HostContext. One connection carries
 * both halves: request/response over ack callbacks, and room-scoped push.
 *
 * Emits `identity:claim` once on connect to attach OS identity to the socket
 * for server-side audit logging; this happens unconditionally, independent
 * of whether the plugin being handed this RealtimeApi was actually granted
 * `realtime:*` — the shell isn't bound by plugin capability grants the way
 * plugins are (see CLAUDE.md).
 */
export function createRealtimeApi(identity: IdentityInfo): RealtimeApi {
  const socket: TrellisSocket = io(`${SERVER_URL}${SOCKET_NAMESPACE}`);

  // channel name → listeners. The count is also the subscription refcount:
  // N plugin subscribers to one channel produce exactly one server-side
  // `subscribe`, and `unsubscribe` fires only when the last one drops.
  const listeners = new Map<string, Set<Listener>>();

  const claimIdentity = () => {
    socket.emit("identity:claim", { username: identity.username, displayName: identity.displayName }, () => {});
  };

  socket.on("connect", () => {
    claimIdentity();
    // A reconnect is a *new* socket server-side: room membership and the
    // claimed identity are both gone. Without this, subscriptions go
    // silently dead — the client still holds live-looking Subscription
    // handles that will never fire again.
    for (const channelName of listeners.keys()) {
      socket.emit("subscribe", channelName, () => {});
    }
  });

  socket.on("event", (channelName, payload) => {
    const set = listeners.get(channelName);
    if (!set) return;
    for (const listener of set) listener(payload);
  });

  /**
   * Wraps one ack round trip as a promise; `ok: false` becomes a rejection.
   *
   * The timeout is load-bearing, not belt-and-braces: socket.io buffers emits
   * while disconnected and retries the connection forever, so without it an
   * unreachable broker leaves every call pending indefinitely — the UI shows
   * no error, just nothing happening, which is far harder to diagnose than a
   * failure.
   */
  function emitWithAck<T>(send: (ack: (result: Result<T>) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            socket.connected
              ? `broker did not respond within ${ACK_TIMEOUT_MS}ms`
              : `cannot reach the broker at ${SERVER_URL} — is apps/server running?`,
          ),
        );
      }, ACK_TIMEOUT_MS);

      send((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (result.ok) resolve(result.data);
        else reject(new Error(`[${result.error.code}] ${result.error.message}`));
      });
    });
  }

  return {
    async subscribe<TEvent, TSnapshot>(
      channel: Channel<TEvent, TSnapshot>,
      listener: (event: TEvent) => void,
    ): Promise<Subscription<TSnapshot>> {
      const { name } = channel;
      const existing = listeners.get(name);
      const typedListener = listener as Listener;

      // The wire layer is type-erased by design; Channel restores inference
      // above it, so the cast is confined to these two boundary points.
      let snapshot: TSnapshot;
      if (existing) {
        existing.add(typedListener);
        // Already joined — replaying the snapshot would need the server to
        // send it again, so re-issue the subscribe to get a fresh one.
        snapshot = (await emitWithAck<unknown>((ack) => socket.emit("subscribe", name, ack))) as TSnapshot;
      } else {
        listeners.set(name, new Set([typedListener]));
        try {
          snapshot = (await emitWithAck<unknown>((ack) => socket.emit("subscribe", name, ack))) as TSnapshot;
        } catch (cause) {
          // Don't leave a phantom entry behind — it would make the next
          // subscribe skip the server round trip and never receive events.
          listeners.delete(name);
          throw cause;
        }
      }

      let active = true;
      return {
        snapshot,
        unsubscribe() {
          if (!active) return;
          active = false;
          const set = listeners.get(name);
          if (!set) return;
          set.delete(typedListener);
          if (set.size > 0) return;
          listeners.delete(name);
          socket.emit("unsubscribe", name, () => {});
        },
      };
    },

    async publish<TEvent, TSnapshot>(channel: Channel<TEvent, TSnapshot>, event: TEvent): Promise<void> {
      await emitWithAck<void>((ack) => socket.emit("publish", channel.name, event, ack));
    },

    async call(endpoint: string, payload: unknown): Promise<unknown> {
      return emitWithAck<unknown>((ack) => socket.emit("request", endpoint, payload, ack));
    },
  };
}
