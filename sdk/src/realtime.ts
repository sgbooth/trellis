import type { IdentityInfo } from "./types.js";

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
   * Joins the channel's room and streams its events. Rooms are server-side
   * only — a client can't join one unilaterally, it has to ask and be
   * authorized, which is why this is async and returns a snapshot.
   */
  subscribe<TEvent, TSnapshot>(
    channel: Channel<TEvent, TSnapshot>,
    listener: (event: TEvent) => void,
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

/** Erased handler shapes — what the registry implementation stores. */
export type SnapshotProvider = (ctx: HandlerContext) => unknown | Promise<unknown>;
export type PublishHandler = (ctx: HandlerContext, event: unknown) => void | Promise<void>;

export interface Registry<TChannels extends ChannelContract = ChannelContract> {
  /**
   * Registers the initial state returned by the subscribe ack for every
   * channel in `family`. A family with no provider still subscribes fine —
   * its snapshot is just `null`.
   *
   * The return type is checked against the same `TSnapshot` the client's
   * `subscribe()` resolves with, so the two can't drift apart.
   */
  onSnapshot<TFamily extends keyof TChannels & string>(
    family: TFamily,
    provider: (ctx: HandlerContext) => TChannels[TFamily]["snapshot"] | Promise<TChannels[TFamily]["snapshot"]>,
  ): void;
  /** Handles client `publish` into any channel in `family`. */
  onPublish<TFamily extends keyof TChannels & string>(
    family: TFamily,
    handler: (ctx: HandlerContext, event: TChannels[TFamily]["event"]) => void | Promise<void>,
  ): void;
  /**
   * Server-initiated fanout to everyone in the channel's room. Typed against
   * the same Channel descriptors the client subscribes with, so a handler
   * can't broadcast a DocketEvent into a matter room.
   */
  publish<TEvent, TSnapshot>(channel: Channel<TEvent, TSnapshot>, event: TEvent): void;
}

/** Registry counterpart to `asRpc` — applies the app's contracts once. */
export function asRegistry<TChannels extends ChannelContract>(registry: Registry): Registry<TChannels> {
  return registry as Registry<TChannels>;
}

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
  "identity:claim": (identity: IdentityInfo, ack: (result: Result<void>) => void) => void;
}

export interface ServerToClientEvents {
  event: (channel: string, payload: unknown) => void;
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
