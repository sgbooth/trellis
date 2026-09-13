import type { IdentityInfo } from "./types.js";

/**
 * Re-exported because it is part of *this* contract — `identity:claim` carries
 * it and `SocketData` holds it — and the broker imports this module alone, to
 * stay clear of `index.ts` → `TrellisInfo.tsx` → React. Without this, a Node
 * consumer can name the wire events but not the type inside them.
 */
export type { IdentityInfo };

/**
 * The realtime transport contract, shared by all three tiers: the shell's
 * socket client, the broker, and the client app's server-side handlers.
 *
 * Kept in its own module (and exposed as the `@trellis/sdk/realtime`
 * subpath) precisely because the broker runs under Node and must be able to
 * import these types without dragging in `index.ts` → `TrellisInfo.tsx` →
 * React. Nothing in this file may import React, directly or transitively.
 */

/** The one socket.io namespace everything rides on. */
export const SOCKET_NAMESPACE = "/socket";

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

/**
 * A branded channel descriptor — the typed handle for one room.
 *
 * `__event`/`__snapshot` are phantom fields: never populated at runtime,
 * present only so TypeScript can carry the payload types through
 * `RealtimeApi`. The alternative (a map keyed by template-literal channel
 * strings) can't express the `{matterId}` segment without losing
 * exhaustiveness, and lets callers hand-build channel strings by mistake.
 *
 * Build these with `channel()` via a constructor function per channel
 * family — see `apps/client/channelSpec.ts` — so the id segment is a typed,
 * required argument rather than string concatenation at the call site.
 */
export interface Channel<TEvent, TSnapshot = void> {
  readonly name: string;
  readonly __event?: TEvent;
  readonly __snapshot?: TSnapshot;
}

export function channel<TEvent, TSnapshot = void>(name: string): Channel<TEvent, TSnapshot> {
  return { name };
}


/**
 * Channel names are `family` or `family/id` — `docket`, `matter/{matterId}`,
 * `chat/{roomId}`. The family is what server-side handlers register against;
 * the id is passed through to them.
 */
export interface ParsedChannel {
  family: string;
  id?: string;
}

export function parseChannel(name: string): ParsedChannel {
  const slash = name.indexOf("/");
  if (slash === -1) return { family: name };
  return { family: name.slice(0, slash), id: name.slice(slash + 1) || undefined };
}

// ---------------------------------------------------------------------------
// Plugin-facing API
// ---------------------------------------------------------------------------

export interface Subscription<TSnapshot> {
  /** Initial state, returned by the same round trip that joined the room. */
  snapshot: TSnapshot;
  unsubscribe(): void;
}

export interface SubscribeOptions<TSnapshot> {
  /**
   * Called with a *fresh* snapshot after the transport reconnects and rejoins
   * the room on this subscription's behalf.
   *
   * A reconnect is a new socket server-side, so room membership is gone and
   * the shell has to re-subscribe (see realtimeHost.ts). Anything published
   * while the socket was down was therefore never delivered, and no `event`
   * will ever carry it — so without this hook a subscriber silently keeps
   * stale state and looks fine, which is the exact failure the re-subscribe
   * was added to prevent.
   *
   * Optional because a subscriber whose state is purely derived from live
   * events (a presence indicator, a cursor) has nothing to reconcile. Anything
   * rendering accumulated state should pass it, usually the same merge
   * function it already applies to the initial snapshot.
   */
  onResync?: (snapshot: TSnapshot) => void;
}

/**
 * Long-lived multiplexed connection to the broker: room-scoped push plus
 * request/response, over one socket.
 *
 * The channel *families* a plugin may touch are not expressed here —
 * room-level scoping is enforced broker-side, in authorizeSubscribe.
 */
export interface RealtimeApi {
  /** Reaches an RPC method on the broker. Wrapped by @trellis/sdk/rpc's
   *  createRpcClient — plugins should use that, not this directly. */
  call(method: string, params: unknown): Promise<unknown>;

  /**
   * Reaches a *streaming* RPC method. Same wrapping note as `call`: plugins
   * go through createRpcClient, which types the chunks off the spec.
   *
   * Typed as the erased `RpcStream<unknown, unknown>` for the same reason the
   * rest of this file is erased — the SDK's rpc module restores inference
   * above it. Declared structurally rather than importing from ./rpc.js so
   * this module stays the standalone transport contract.
   */
  stream(
    method: string,
    params: unknown,
  ): AsyncIterable<unknown> & { result: Promise<unknown>; cancel(): void };

  /**
   * Joins the channel's room and streams its events. Rooms are server-side
   * only — a client can't join one unilaterally, it has to ask and be
   * authorized, which is why this is async and returns a snapshot.
   */
  subscribe<TEvent, TSnapshot>(
    channel: Channel<TEvent, TSnapshot>,
    listener: (event: TEvent) => void,
    options?: SubscribeOptions<TSnapshot>,
  ): Promise<Subscription<TSnapshot>>;

  /**
   * Fire-and-forget publish into a channel. Present for high-frequency,
   * server-doesn't-need-to-answer traffic (CRDT deltas, presence). Anything
   * where the caller needs a result — including anything the server has to
   * stamp with an authoritative identity or timestamp — should be an
   * endpoint on the RPC contract, reached via `call()`, instead.
   */
  publish<TEvent, TSnapshot>(channel: Channel<TEvent, TSnapshot>, event: TEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Broker-side handler contract
// ---------------------------------------------------------------------------

/**
 * The seam between the core broker (owns the socket, the rooms, the wire
 * protocol) and a client app's server-owned handlers (own what the channels
 * *mean*). apps/server never learns what a "matter" is; apps/client/server
 * never touches a socket — the same division HostContext draws on the front
 * end.
 *
 * These types live in the SDK because apps/server depends on apps/client, so
 * the dependency arrow can't point back the other way for apps/client/server
 * to name them.
 */
export interface HandlerContext {
  /** Full channel name, e.g. `matter/42`. */
  channel: string;
  /** Family, e.g. `matter`. */
  family: string;
  /** Id segment, e.g. `42`. Undefined for unparameterized channels. */
  id?: string;
  /**
   * Client-claimed and UNVERIFIED — audit-trail only, never an
   * authorization input. See apps/server's SECURITY note.
   */
  identity?: IdentityInfo;
}

/**
 * Channel counterpart to RpcContract: family name → what flows over it.
 *
 * A *family* is the part of a channel name before the id segment — `matter`
 * for `matter/42`. Handlers register per family, not per room, since rooms
 * are created on demand by whichever id a client asks for.
 *
 * Same `type`-not-`interface` requirement as RpcContract.
 */
export interface ChannelFamily {
  event: unknown;
  snapshot: unknown;
}

export type ChannelContract = Record<string, ChannelFamily>;

/**
 * The handlers for one family — the channel counterpart to `HandlersFor`.
 * A family's file is typed `ChannelHandlersFor<TrellisChannels, "chat">`, so
 * its snapshot and publish payloads are checked against the same spec entry
 * the client's `subscribe`/`publish` resolve from, and can't drift apart.
 *
 * Both hooks are optional because plenty of families legitimately want only
 * one: chat is server-push + snapshot, with sending owned by RPC, so a
 * required `publish` would only ever be a throwing stub. What is *not*
 * optional is the family's entry in `ChannelHandlerMap` — a family declared
 * in the spec with no handler file at all is the drift worth catching, and
 * that still fails at compile time.
 */
export type ChannelHandlersFor<
  TChannels extends ChannelContract,
  TFamily extends keyof TChannels & string,
> = {
  /**
   * Initial state, returned by the same ack that joins the room. The broker
   * joins only after this resolves, so a subscriber cannot miss an event
   * published between the two — which is the reason initial state is worth
   * having here rather than only on an RPC method.
   *
   * A family that omits this still subscribes fine; its snapshot is `null`.
   */
  snapshot?: (
    ctx: HandlerContext,
  ) => TChannels[TFamily]["snapshot"] | Promise<TChannels[TFamily]["snapshot"]>;
  /**
   * Handles a client `publish` into any channel in the family. Omit it and
   * client publishes to the family are rejected with `NO_HANDLER`.
   */
  publish?: (ctx: HandlerContext, event: TChannels[TFamily]["event"]) => void | Promise<void>;
};

/**
 * Every family's handlers in one map, keyed by family name. The `satisfies`
 * in the app's channelHandlers.ts is what proves the spec is fully covered —
 * the same guarantee `HandlerMap` gives the RPC half.
 */
export type ChannelHandlerMap<TChannels extends ChannelContract> = {
  [TFamily in keyof TChannels & string]: ChannelHandlersFor<TChannels, TFamily>;
};

/**
 * Type-erased view of the above — what the broker stores and dispatches on,
 * since it never learns what a "matter" is. Any `ChannelHandlerMap` is
 * assignable to `Record<string, ErasedChannelHandlers>`; inference is
 * restored above this layer by the app's own handler files, the same way
 * `Channel` restores it over the wire.
 *
 * `event: never`, not `event: unknown`: handler parameters are checked
 * contravariantly, so a handler taking a *specific* event type is assignable
 * to one taking `never` and assignable to nothing wider. The broker holds
 * `unknown` off the wire, so it casts once at the call — the same single
 * cast mountRpc makes when it invokes a handler.
 */
export type ErasedChannelHandlers = {
  snapshot?: (ctx: HandlerContext) => unknown;
  publish?: (ctx: HandlerContext, event: never) => void | Promise<void>;
};

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

export interface WireError {
  code: string;
  message: string;
}

/**
 * Every ack resolves — failures come back as `ok: false` rather than as a
 * transport-level throw, so callers have exactly one error path.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: WireError };

/**
 * The complete client→server event set. It is deliberately closed and
 * generic: the channel name is an *argument*, never the event name. Encoding
 * the room into the event name (`socket.emit("matter/123", …)`) is the
 * obvious-looking design that makes the socket untypeable, since the event
 * map would need an open-ended template-literal index signature.
 *
 * The `unknown` payloads are the intended shape — this layer is type-erased,
 * and `Channel`/`Operation` restore full inference above it. That confines
 * the cast to one place on each side of the wire.
 */
export interface ClientToServerEvents {
  subscribe: (channel: string, ack: (result: Result<unknown>) => void) => void;
  unsubscribe: (channel: string, ack: (result: Result<void>) => void) => void;
  publish: (channel: string, event: unknown, ack: (result: Result<void>) => void) => void;
  request: (operation: string, payload: unknown, ack: (result: Result<unknown>) => void) => void;
  /**
   * Starts a streaming method. The ack confirms only that the stream *began*
   * (so `NO_METHOD` or "not a streaming method" fail fast); chunks, the
   * terminal result and any error all arrive as `stream` frames instead,
   * because a socket.io ack fires exactly once and so cannot carry them.
   *
   * `callId` is generated by the caller, and — like a channel name — is an
   * argument rather than part of the event name, for the same reason: an
   * event name per call would make the socket untypeable.
   */
  "request:stream": (
    operation: string,
    payload: unknown,
    callId: string,
    ack: (result: Result<void>) => void,
  ) => void;
  /** Ends a stream early. Runs the server generator's `finally`. */
  "stream:cancel": (callId: string, ack: (result: Result<void>) => void) => void;
  "identity:claim": (identity: IdentityInfo, ack: (result: Result<void>) => void) => void;
}

/**
 * One frame of a streaming call. Exactly one terminal frame (`end` or
 * `error`) is sent per `callId`, and nothing follows it.
 */
export type StreamFrame =
  | { type: "chunk"; chunk: unknown }
  | { type: "end"; result: unknown }
  | { type: "error"; error: WireError };

export interface ServerToClientEvents {
  event: (channel: string, payload: unknown) => void;
  stream: (callId: string, frame: StreamFrame) => void;
}

/**
 * Per-connection server state. Replaces the hand-rolled `ConnectionIdentity`
 * interface the Feathers version needed in two separate files —
 * socket.io types `socket.data` natively.
 *
 * `identity` is client-claimed and unverified; audit-trail only. See
 * IdentityApi's doc comment.
 */
export interface SocketData {
  identity?: IdentityInfo;
}
