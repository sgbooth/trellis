import { io, type Socket } from "socket.io-client";
import { SOCKET_NAMESPACE } from "@trellis/sdk/realtime";
import type {
  Channel,
  ClientToServerEvents,
  IdentityInfo,
  RealtimeApi,
  Result,
  ServerToClientEvents,
  SubscribeOptions,
  Subscription,
} from "@trellis/sdk";

/** How long a single request/subscribe may wait for its ack. */
const ACK_TIMEOUT_MS = 8000;

/**
 * How long a started stream may go without *any* frame before it's treated as
 * dead. Deliberately an idle timeout rather than a total budget: a total one
 * would kill exactly the long-running generations streaming exists for, while
 * a stream that has genuinely stalled still fails rather than hanging.
 */
const STREAM_IDLE_TIMEOUT_MS = 60_000;

type TrellisSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type Listener = (event: unknown) => void;

/**
 * One `subscribe()` call. Held per-channel rather than as a bare listener so a
 * reconnect can hand each subscriber its own fresh snapshot — several
 * subscribers to the same room may want different reconciliation, and only
 * they know what to do with it.
 */
interface Subscriber {
  listener: Listener;
  onResync?: (snapshot: unknown) => void;
}

/** Resolved/rejected by incoming frames for one in-flight streaming call. */
interface StreamSink {
  push(chunk: unknown): void;
  end(result: unknown): void;
  fail(error: Error): void;
}

/**
 * Shell-owned socket.io client — plugins never get a raw network client of
 * their own, only what's exposed through HostContext. One connection carries
 * both halves: request/response over ack callbacks, and room-scoped push.
 *
 * Emits `identity:claim` once on connect to attach the caller's identity to
 * the socket for server-side audit logging. That identity is client-claimed
 * and unverified wherever it came from — the OS on desktop, the sign-in
 * prompt on the web — so nothing may treat it as an authorization input.
 *
 * `serverUrl` is a parameter because the entry points disagree about it: the
 * desktop shell targets a fixed dev host, while the browser build is served
 * by the broker and so uses its own origin.
 */
export function createRealtimeApi(identity: IdentityInfo, serverUrl: string): RealtimeApi {
  const socket: TrellisSocket = io(`${serverUrl}${SOCKET_NAMESPACE}`);

  // channel name → subscribers. The count is also the subscription refcount:
  // N plugin subscribers to one channel produce exactly one server-side
  // `unsubscribe`, which fires only when the last one drops.
  const subscribers = new Map<string, Set<Subscriber>>();

  const claimIdentity = () => {
    socket.emit("identity:claim", { username: identity.username, displayName: identity.displayName }, () => {});
  };

  // `connect` also fires for the very first connection, where there is
  // nothing to restore — anything subscribed before it lands was buffered by
  // socket.io and will be sent on its own. Only a *re*connect needs the work
  // below, and resyncing on the first one would deliver a spurious snapshot.
  let connectedBefore = false;

  socket.on("connect", () => {
    claimIdentity();
    if (!connectedBefore) {
      connectedBefore = true;
      return;
    }

    // A reconnect is a *new* socket server-side: room membership and the
    // claimed identity are both gone. Without re-subscribing, subscriptions
    // go silently dead — the client still holds live-looking Subscription
    // handles that will never fire again.
    for (const [channelName, set] of subscribers) {
      if (set.size === 0) continue;
      // Through emitWithAck, not a discarded `() => {}` ack, for two reasons:
      // the fresh snapshot is the only way to recover anything published
      // while the socket was down (no `event` will ever carry it), and a
      // re-subscribe that fails must be visible rather than leaving a
      // subscriber that looks live and never fires again.
      emitWithAck<unknown>((ack) => socket.emit("subscribe", channelName, ack))
        .then((snapshot) => {
          for (const subscriber of set) subscriber.onResync?.(snapshot);
        })
        .catch((cause: unknown) => {
          console.error(`[realtime] failed to rejoin ${channelName} after reconnect`, cause);
        });
    }
  });

  socket.on("event", (channelName, payload) => {
    const set = subscribers.get(channelName);
    if (!set) return;
    for (const subscriber of set) subscriber.listener(payload);
  });

  // callId -> the in-flight streaming call awaiting frames.
  const sinks = new Map<string, StreamSink>();

  socket.on("stream", (callId, frame) => {
    const sink = sinks.get(callId);
    // No sink means the call was already cancelled or completed locally;
    // dropping the frame is correct, not an error.
    if (!sink) return;
    if (frame.type === "chunk") sink.push(frame.chunk);
    else if (frame.type === "end") sink.end(frame.result);
    else sink.fail(new Error(`[${frame.error.code}] ${frame.error.message}`));
  });

  socket.on("disconnect", (reason) => {
    // Streams are per-socket server-side, so a reconnect cannot resume them.
    // Failing here is what stops a caller awaiting frames that will never
    // come — the same silent-death failure mode that made re-subscribing on
    // reconnect necessary for channels.
    for (const [callId, sink] of sinks) {
      sinks.delete(callId);
      sink.fail(new Error(`stream ended: socket disconnected (${reason})`));
    }
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
              : `cannot reach the broker at ${serverUrl} — is apps/server running?`,
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
      options?: SubscribeOptions<TSnapshot>,
    ): Promise<Subscription<TSnapshot>> {
      const { name } = channel;
      // The wire layer is type-erased by design; Channel restores inference
      // above it, so the casts are confined to these boundary points.
      const subscriber: Subscriber = {
        listener: listener as Listener,
        onResync: options?.onResync as ((snapshot: unknown) => void) | undefined,
      };

      const existing = subscribers.get(name);
      const set = existing ?? new Set<Subscriber>();
      if (!existing) subscribers.set(name, set);
      set.add(subscriber);

      let snapshot: TSnapshot;
      try {
        // Re-issued even when the room is already joined: the server sends a
        // snapshot per subscribe, and this subscriber needs its own.
        snapshot = (await emitWithAck<unknown>((ack) => socket.emit("subscribe", name, ack))) as TSnapshot;
      } catch (cause) {
        // Roll back exactly what this call added. Registering before the ack
        // is what lets an event arriving mid-handshake reach the listener, but
        // it means a failure would otherwise strand one — and if this was the
        // first subscriber, a phantom channel entry would make the *next*
        // subscribe skip the server round trip and never receive events.
        set.delete(subscriber);
        if (set.size === 0) subscribers.delete(name);
        throw cause;
      }

      let active = true;
      return {
        snapshot,
        unsubscribe() {
          if (!active) return;
          active = false;
          const current = subscribers.get(name);
          if (!current) return;
          current.delete(subscriber);
          if (current.size > 0) return;
          subscribers.delete(name);
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

    stream(method: string, params: unknown) {
      const callId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

      const buffered: unknown[] = [];
      let pending: ((next: IteratorResult<unknown>) => void) | null = null;
      let pendingFail: ((cause: unknown) => void) | null = null;
      let closed = false;
      let failure: Error | null = null;

      let settleResult!: (value: unknown) => void;
      let rejectResult!: (cause: unknown) => void;
      const result = new Promise<unknown>((res, rej) => {
        settleResult = res;
        rejectResult = rej;
      });
      // A caller may legitimately iterate chunks and never await `result`.
      // Without a handler attached here, a failed stream would surface as an
      // unhandled rejection; attaching one doesn't consume the rejection for
      // a caller that awaits it later.
      void result.catch(() => {});

      let idleTimer: ReturnType<typeof setTimeout>;
      const armIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => finish(new Error(`stream ${method} received no frames for ${STREAM_IDLE_TIMEOUT_MS}ms`)),
          STREAM_IDLE_TIMEOUT_MS,
        );
      };

      /** The single close path — every ending routes through here, so the
       *  timer, the registry and both consumers stay consistent. */
      const finish = (cause: Error | null, value?: unknown) => {
        if (closed) return;
        closed = true;
        failure = cause;
        clearTimeout(idleTimer);
        sinks.delete(callId);
        if (cause) {
          rejectResult(cause);
          pendingFail?.(cause);
        } else {
          settleResult(value);
          pending?.({ value: undefined, done: true });
        }
        pending = null;
        pendingFail = null;
      };

      sinks.set(callId, {
        push(chunk) {
          armIdleTimer();
          if (pending) {
            const resolve = pending;
            pending = null;
            pendingFail = null;
            resolve({ value: chunk, done: false });
          } else {
            buffered.push(chunk);
          }
        },
        // Chunks already buffered stay readable after `end`: the iterator
        // drains them before reporting done, so a fast stream that completes
        // before the consumer starts iterating doesn't lose data.
        end: (value) => finish(null, value),
        fail: (cause) => finish(cause),
      });

      armIdleTimer();

      const cancel = () => {
        if (closed) return;
        socket.emit("stream:cancel", callId, () => {});
        // Rejecting rather than resolving: a cancelled call has no terminal
        // value, and leaving `result` pending forever is the worse failure.
        finish(new Error(`stream ${method} cancelled`));
      };

      // Registered before emitting, so a frame that arrives ahead of the ack
      // still finds its sink rather than being dropped.
      emitWithAck<void>((ack) => socket.emit("request:stream", method, params, callId, ack)).catch(
        (cause: unknown) => finish(cause instanceof Error ? cause : new Error(String(cause))),
      );

      return {
        result,
        cancel,
        [Symbol.asyncIterator](): AsyncIterator<unknown> {
          return {
            next(): Promise<IteratorResult<unknown>> {
              if (buffered.length > 0) return Promise.resolve({ value: buffered.shift(), done: false });
              if (failure) return Promise.reject(failure);
              if (closed) return Promise.resolve({ value: undefined, done: true });
              return new Promise((resolve, reject) => {
                pending = resolve;
                pendingFail = reject;
              });
            },
            // Called by `for await` on break/return/throw — so leaving the
            // loop early cancels the server-side generator.
            return(): Promise<IteratorResult<unknown>> {
              cancel();
              return Promise.resolve({ value: undefined, done: true });
            },
          };
        },
      };
    },
  };
}
