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
 */
export type RpcSpec = Record<string, { params: any; result: any }>;

export type MethodKeysOf<S extends RpcSpec> = keyof S & string;
export type ParamsFor<S extends RpcSpec, K extends keyof S> = S[K]["params"];
export type ResultFor<S extends RpcSpec, K extends keyof S> = S[K]["result"];

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

export type HandlerMap<S extends RpcSpec> = {
  [K in MethodKeysOf<S>]: (
    params: ParamsFor<S, K>,
    ctx: RpcContext,
  ) => ResultFor<S, K> | Promise<ResultFor<S, K>>;
};

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

/** Splits one dotted method name into nested objects, recursively. */
type Branch<S extends RpcSpec, K extends keyof S, Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? { [P in Head]: Branch<S, K, Rest> }
  : { [P in Path]: (params: ParamsFor<S, K>) => Promise<ResultFor<S, K>> };

/** `rpc.matter.get(...)` sugar, derived from the spec's dotted keys. */
export type RpcNamespaces<S extends RpcSpec> = UnionToIntersection<
  { [K in MethodKeysOf<S>]: Branch<S, K, K> }[MethodKeysOf<S>]
>;

export type RpcClient<S extends RpcSpec> = {
  call<K extends MethodKeysOf<S>>(method: K, params: ParamsFor<S, K>): Promise<ResultFor<S, K>>;
} & RpcNamespaces<S>;

/** How a call actually reaches the broker. Supplied by the shell. */
export type RpcInvoke = (method: string, params: unknown) => Promise<unknown>;

/**
 * Builds the client from the spec: a typed `.call()` plus namespaced sugar
 * generated at runtime from the spec's keys.
 *
 * Transport-agnostic on purpose — the shell passes in an `invoke` backed by
 * the socket it owns, so the plugin never holds a network client of its own.
 */
export function createRpcClient<S extends RpcSpec>(spec: S, invoke: RpcInvoke): RpcClient<S> {
  const client: any = {
    call: (method: string, params: unknown) => invoke(method, params),
  };

  for (const method of Object.keys(spec)) {
    const parts = method.split(".");
    let node = client;
    for (let i = 0; i < parts.length - 1; i++) {
      node = node[parts[i]] ??= {};
    }
    node[parts[parts.length - 1]] = (params: unknown) => invoke(method, params);
  }

  return client as RpcClient<S>;
}
