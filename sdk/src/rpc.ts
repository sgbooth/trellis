import type { IdentityInfo } from "./types.js";

/**
 * Generic RPC machinery. Knows nothing about any particular deployment's
 * methods — the concrete spec lives in the client app (apps/client/rpcSpec.ts).
 *
 * React-free by construction: the broker imports this under Node.
 */

/**
 * A spec entry carries its types in `as` casts on a real value, so a single
 * `const rpcSpec` is both the runtime list of method names (needed to build
 * the namespaced client) and the source of every type.
 *
 * An entry that also declares `chunk` is a *streaming* method: it yields many
 * chunks and then one terminal result. Everything else is unary, exactly as
 * before.
 */
export type RpcSpec = Record<string, { params: any; result: any; chunk?: any }>;

export type MethodKeysOf<S extends RpcSpec> = keyof S & string;
export type ParamsFor<S extends RpcSpec, K extends keyof S> = S[K]["params"];
export type ResultFor<S extends RpcSpec, K extends keyof S> = S[K]["result"];
export type ChunkFor<S extends RpcSpec, K extends keyof S> = S[K] extends { chunk: infer C } ? C : never;

/**
 * Whether a method streams. Deliberately `"chunk" extends keyof S[K]` rather
 * than `S[K] extends { chunk: any }`: `chunk?: any` on the constraint above
 * means *every* entry satisfies the latter, which would silently collapse the
 * unary/streaming split and type every method as streaming.
 */
export type IsStreaming<S extends RpcSpec, K extends keyof S> = "chunk" extends keyof S[K] ? true : false;

export type StreamingKeysOf<S extends RpcSpec> = {
  [K in MethodKeysOf<S>]: IsStreaming<S, K> extends true ? K : never;
}[MethodKeysOf<S>];

/**
 * Second argument to every handler. There is no req/res over a socket, so
 * this is connection state instead.
 *
 * `identity` is client-claimed and UNVERIFIED — audit-trail only, never an
 * authorization input. See apps/server's SECURITY note.
 */
export interface RpcContext {
  identity?: IdentityInfo;
  socketId: string;
}

/**
 * One handler's shape, chosen by whether its spec entry declares `chunk`.
 *
 * A streaming handler is an ordinary `async function*`: it yields chunks and
 * returns the terminal result. `finally` inside it is the cleanup hook, and
 * it runs when a caller cancels — which is what stops a server from doing
 * work (burning provider tokens, holding a cursor) for a caller that walked
 * away.
 */
export type HandlerFor<S extends RpcSpec, K extends MethodKeysOf<S>> = IsStreaming<S, K> extends true
  ? (params: ParamsFor<S, K>, ctx: RpcContext) => AsyncGenerator<ChunkFor<S, K>, ResultFor<S, K>, void>
  : (params: ParamsFor<S, K>, ctx: RpcContext) => ResultFor<S, K> | Promise<ResultFor<S, K>>;

export type HandlerMap<S extends RpcSpec> = {
  [K in MethodKeysOf<S>]: HandlerFor<S, K>;
};

/**
 * Throw from a handler to control the `code` the caller sees; a plain `Error`
 * gets the generic `HANDLER_FAILED`.
 *
 * Lives in the SDK rather than beside `mountRpc`, because the handlers that
 * throw it are in `apps/client` and the dependency arrow runs
 * server → client — a client handler cannot import from `apps/server`. Same
 * reason the channel contracts live here.
 */
export class RpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

type KeysWithPrefix<S extends RpcSpec, P extends string> = Extract<keyof S & string, `${P}.${string}`>;
type SubSpec<S extends RpcSpec, P extends string> = Pick<S, KeysWithPrefix<S, P>>;

/**
 * The slice of the spec belonging to one prefix. A handler file typed as
 * `HandlersFor<typeof rpcSpec, "matter">` must implement every `matter.*`
 * method and may not implement anything else — so the spec and the handler
 * files can't drift, in either direction.
 */
export type HandlersFor<S extends RpcSpec, P extends string> = HandlerMap<SubSpec<S, P>>;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

/**
 * A live streaming call. Iterate it for chunks, then await `result` for the
 * terminal value:
 *
 * ```ts
 * const stream = rpc.llm.stream({ prompt });
 * for await (const chunk of stream) setText((t) => t + chunk.text);
 * const { stopReason } = await stream.result;
 * ```
 *
 * `result` is a separate promise rather than a final yielded value because
 * `for await` discards a generator's *return* value — there is nowhere for a
 * terminal result to surface through iteration alone.
 *
 * Leaving the loop early (`break`, `return`, or a throw) cancels the call, as
 * does `cancel()` directly. Both stop the server-side generator.
 */
export type RpcStream<TChunk, TResult> = AsyncIterable<TChunk> & {
  result: Promise<TResult>;
  cancel(): void;
};

/** The client-facing shape of one method: streaming methods take the same
 *  params but hand back an RpcStream instead of a bare promise. */
type MethodSignature<S extends RpcSpec, K extends MethodKeysOf<S>> = IsStreaming<S, K> extends true
  ? (params: ParamsFor<S, K>) => RpcStream<ChunkFor<S, K>, ResultFor<S, K>>
  : (params: ParamsFor<S, K>) => Promise<ResultFor<S, K>>;

/** Splits one dotted method name into nested objects, recursively. */
type Branch<S extends RpcSpec, K extends MethodKeysOf<S>, Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? { [P in Head]: Branch<S, K, Rest> }
  : { [P in Path]: MethodSignature<S, K> };

/** `rpc.matter.get(...)` sugar, derived from the spec's dotted keys. */
export type RpcNamespaces<S extends RpcSpec> = UnionToIntersection<
  { [K in MethodKeysOf<S>]: Branch<S, K, K> }[MethodKeysOf<S>]
>;

export type RpcClient<S extends RpcSpec> = {
  /** Unary call. Streaming methods are not reachable here — use `stream()`,
   *  or the namespaced sugar, so the return type stays honest. */
  call<K extends Exclude<MethodKeysOf<S>, StreamingKeysOf<S>>>(
    method: K,
    params: ParamsFor<S, K>,
  ): Promise<ResultFor<S, K>>;
  /** Streaming call, greppable-literal form. Only streaming methods. */
  stream<K extends StreamingKeysOf<S>>(
    method: K,
    params: ParamsFor<S, K>,
  ): RpcStream<ChunkFor<S, K>, ResultFor<S, K>>;
} & RpcNamespaces<S>;

/** How a unary call reaches the broker. Supplied by the shell. */
export type RpcInvoke = (method: string, params: unknown) => Promise<unknown>;

/** How a streaming call reaches the broker. Also shell-supplied — the client
 *  app never constructs a socket of its own. */
export type RpcStreamInvoke = (method: string, params: unknown) => RpcStream<unknown, unknown>;

/**
 * Builds the client from the spec: typed `.call()`/`.stream()` plus namespaced
 * sugar generated at runtime from the spec's keys.
 *
 * Transport-agnostic on purpose — the shell passes in the two invokers, backed
 * by the socket it owns, so the plugin never holds a network client of its own.
 *
 * `streamInvoke` is optional so a host that only does unary calls still works;
 * a streaming method then fails loudly at the call site rather than returning
 * something half-alive.
 */
export function createRpcClient<S extends RpcSpec>(
  spec: S,
  invoke: RpcInvoke,
  streamInvoke?: RpcStreamInvoke,
): RpcClient<S> {
  const openStream: RpcStreamInvoke = (method, params) => {
    if (!streamInvoke) throw new Error(`[rpc] ${method} is a streaming method, but this host provides no stream transport`);
    return streamInvoke(method, params);
  };

  const client: any = {
    call: (method: string, params: unknown) => invoke(method, params),
    stream: (method: string, params: unknown) => openStream(method, params),
  };

  for (const method of Object.keys(spec)) {
    // `chunk` present in the spec *value* is what marks a method streaming —
    // the same fact the types read off `"chunk" extends keyof S[K]`, so the
    // runtime shape and the static shape can't disagree.
    const streaming = "chunk" in spec[method];
    const parts = method.split(".");
    let node = client;
    for (let i = 0; i < parts.length - 1; i++) {
      node = node[parts[i]] ??= {};
    }
    node[parts[parts.length - 1]] = streaming
      ? (params: unknown) => openStream(method, params)
      : (params: unknown) => invoke(method, params);
  }

  return client as RpcClient<S>;
}
