import type { Namespace, Socket } from "socket.io";
import type { HandlerMap, RpcSpec } from "@trellis/sdk/rpc";
import type { ClientToServerEvents, Result, ServerToClientEvents, SocketData } from "@trellis/sdk/realtime";

/**
 * Mounts a spec + handler map onto a socket.io namespace as request/response
 * over ack callbacks. The broker knows nothing about the methods themselves —
 * apps/client owns both the spec and the handlers.
 */

type TrellisSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Throw from a handler to control the `code` the caller sees. */
export class RpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

function toFailure(cause: unknown): Result<never> {
  if (cause instanceof RpcError) return { ok: false, error: { code: cause.code, message: cause.message } };
  return {
    ok: false,
    error: { code: "HANDLER_FAILED", message: cause instanceof Error ? cause.message : String(cause) },
  };
}

export function mountRpc<S extends RpcSpec>(
  namespace: Namespace<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>,
  spec: S,
  handlers: HandlerMap<S>,
): void {
  namespace.on("connection", (socket: TrellisSocket) => {
    socket.on("request", async (method, params, ack) => {
      const handler = (handlers as Record<string, unknown>)[method];
      if (typeof handler !== "function") {
        // Failures come back as acks, never as transport-level throws, so
        // callers have exactly one error path.
        ack?.({ ok: false, error: { code: "NO_METHOD", message: `no handler for ${method}` } });
        return;
      }
      try {
        const data = await (handler as (p: unknown, c: unknown) => unknown)(params, {
          identity: socket.data.identity,
          socketId: socket.id,
        });
        ack?.({ ok: true, data });
      } catch (cause) {
        ack?.(toFailure(cause));
      }
    });
  });

  // Names the surface at startup — one line per prefix, so a missing handler
  // file is visible in the log rather than only on first call.
  const prefixes = new Set(Object.keys(spec).map((m) => m.split(".")[0]));
  console.log(`[rpc] mounted ${Object.keys(spec).length} methods across: ${[...prefixes].join(", ")}`);
}
