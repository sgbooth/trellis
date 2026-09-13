import { createRpcClient } from "@trellis/sdk/rpc";
import type { RpcClient } from "@trellis/sdk/rpc";
import type { HostContext } from "@trellis/sdk";
import { rpcSpec } from "#rpcSpec";

/**
 * The app-wide RPC client: `import { rpc } from "./rpc"` then
 * `await rpc.matter.get({ matterId })`.
 *
 * A plugin can't build this itself — the shell owns the socket and hands it
 * over through HostContext, so `initRpc(host)` must run once at mount before
 * any call. The Proxy exists so every other module can `import { rpc }` at
 * the top level without caring about that ordering, and get a clear error
 * instead of `undefined` if it's ever wrong.
 */
let client: RpcClient<typeof rpcSpec> | null = null;
let currentRealtime: HostContext["realtime"] | null = null;

export function initRpc(host: HostContext): void {
  if (!host.realtime) {
    client = null;
    currentRealtime = null;
    return;
  }
  const realtime = host.realtime;
  if (currentRealtime === realtime) return;
  currentRealtime = realtime;
  client = createRpcClient(
    rpcSpec,
    (method, params) => realtime.call(method, params),
    (method, params) => realtime.stream(method, params),
  );
}

export const rpc = new Proxy({} as RpcClient<typeof rpcSpec>, {
  get(_target, prop) {
    if (!client) {
      throw new Error(
        `rpc.${String(prop)} used before initRpc(host) ran, or without the realtime capability granted`,
      );
    }
    return (client as unknown as Record<string | symbol, unknown>)[prop];
  },
});
