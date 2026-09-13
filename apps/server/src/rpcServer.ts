import type { Namespace, Socket } from "socket.io";
import { RpcError } from "@trellis/sdk/rpc";
import type { HandlerMap, RpcSpec } from "@trellis/sdk/rpc";
import type {
  ClientToServerEvents,
  Result,
  ServerToClientEvents,
  SocketData,
  WireError,
} from "@trellis/sdk/realtime";

/**
 * Mounts a spec + handler map onto a socket.io namespace, as request/response
 * over ack callbacks plus streaming methods over `stream` frames. The broker
 * knows nothing about the methods themselves — apps/client owns both the spec
 * and the handlers.
 */

type TrellisSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function safeAck(ack: unknown): (result: unknown) => void {
  return typeof ack === "function" ? (ack as (result: unknown) => void) : () => {};
}

// Defined in the SDK so apps/client's handlers can throw it — they cannot
// import from apps/server. Re-exported here because this is where it is
// caught, and where callers looking for the error contract will look first.
export { RpcError };

/** The error a handler failure becomes. Shared by the ack path and the
 *  stream-frame path so both report a failure identically. */
function toWireError(cause: unknown): WireError {
  if (cause instanceof RpcError) return { code: cause.code, message: cause.message };
  return { code: "HANDLER_FAILED", message: cause instanceof Error ? cause.message : String(cause) };
}

function toFailure(cause: unknown): Result<never> {
  return { ok: false, error: toWireError(cause) };
}

/** The erased shape of a streaming handler — an async generator factory. */
type StreamHandler = (
  params: unknown,
  ctx: unknown,
) => AsyncGenerator<unknown, unknown, void>;

export function mountRpc<S extends RpcSpec>(
  namespace: Namespace<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>,
  spec: S,
  handlers: HandlerMap<S>,
): void {
  const lookup = handlers as Record<string, unknown>;
  const isStreaming = (method: string) => Object.hasOwn(spec, method) && "chunk" in spec[method];

  /**
   * Own properties only. `handlers` is a plain object literal, so a bare
   * `lookup[method]` with a method name off the wire resolves inherited
   * `Object.prototype` members too — `constructor`, `toString`, `valueOf` and
   * `hasOwnProperty` are all functions, so all four passed the `typeof` check
   * below and were dispatched as if they were handlers, acking `ok: true`
   * with a nonsense result instead of `NO_METHOD`.
   */
  const lookupHandler = (method: string): unknown =>
    Object.hasOwn(lookup, method) ? lookup[method] : undefined;

  namespace.on("connection", (socket: TrellisSocket) => {
    // callId -> the running generator, so cancel and disconnect can stop it.
    // Per-socket because a callId is only unique to its caller.
    const active = new Map<string, AsyncGenerator<unknown, unknown, void>>();

    socket.on("request", async (method, params, ack) => {
      const reply = safeAck(ack);
      const handler = lookupHandler(method);
      if (typeof handler !== "function") {
        // Failures come back as acks, never as transport-level throws, so
        // callers have exactly one error path.
        reply({ ok: false, error: { code: "NO_METHOD", message: `no handler for ${method}` } });
        return;
      }
      if (isStreaming(method)) {
        reply({ ok: false, error: { code: "IS_STREAMING", message: `${method} streams; use request:stream` } });
        return;
      }
      try {
        const data = await (handler as (p: unknown, c: unknown) => unknown)(params, {
          identity: socket.data.identity,
          socketId: socket.id,
        });
        reply({ ok: true, data });
      } catch (cause) {
        reply(toFailure(cause));
      }
    });

    socket.on("request:stream", async (method, params, callId, ack) => {
      const reply = safeAck(ack);
      const handler = lookupHandler(method);
      if (typeof handler !== "function") {
        reply({ ok: false, error: { code: "NO_METHOD", message: `no handler for ${method}` } });
        return;
      }
      if (!isStreaming(method)) {
        reply({ ok: false, error: { code: "NOT_STREAMING", message: `${method} is not a streaming method` } });
        return;
      }
      if (active.has(callId)) {
        reply({ ok: false, error: { code: "DUPLICATE_CALL", message: `callId ${callId} is already streaming` } });
        return;
      }

      let generator: AsyncGenerator<unknown, unknown, void>;
      try {
        generator = (handler as StreamHandler)(params, {
          identity: socket.data.identity,
          socketId: socket.id,
        });
      } catch (cause) {
        // A handler that throws before yielding hasn't started a stream, so
        // it can still fail through the ack rather than a frame.
        reply(toFailure(cause));
        return;
      }

      active.set(callId, generator);
      // Ack *before* iterating: the caller is waiting on this to know the
      // stream began, and the first chunk may be slow to arrive.
      reply({ ok: true, data: undefined });

      try {
        // NOTE: socket.io has no backpressure. A generator that outruns a slow
        // consumer buffers in memory here; a handler producing large or
        // unbounded output should pace itself rather than relying on the
        // transport to push back.
        let next = await generator.next();
        while (!next.done) {
          // The caller may have cancelled (or dropped) while we were awaiting.
          if (!active.has(callId)) return;
          socket.emit("stream", callId, { type: "chunk", chunk: next.value });
          next = await generator.next();
        }
        if (!active.has(callId)) return;
        socket.emit("stream", callId, { type: "end", result: next.value });
      } catch (cause) {
        // Mid-stream failures can't use the ack — it already fired — so they
        // arrive as the terminal frame instead. Same RpcError code mapping.
        if (active.has(callId)) {
          socket.emit("stream", callId, { type: "error", error: toWireError(cause) });
        }
      } finally {
        active.delete(callId);
      }
    });

    socket.on("stream:cancel", async (callId, ack) => {
      const reply = safeAck(ack);
      const generator = active.get(callId);
      // Delete first: the send loop checks membership to decide whether to
      // keep emitting, so this is what stops further frames.
      active.delete(callId);
      // `.return()` resumes the generator at its yield point and runs any
      // `finally`, which is how a handler releases whatever it was holding.
      await generator?.return(undefined as never).catch(() => {});
      reply({ ok: true, data: undefined });
    });

    socket.on("disconnect", () => {
      // A stream cannot survive a reconnect — a reconnect is a new socket
      // here, with none of this state. Without this the generators would run
      // on unobserved, doing work for a caller that is gone.
      for (const [callId, generator] of active) {
        active.delete(callId);
        void generator.return(undefined as never).catch(() => {});
      }
    });
  });

  // Names the surface at startup — one line per prefix, so a missing handler
  // file is visible in the log rather than only on first call.
  const methods = Object.keys(spec);
  const prefixes = new Set(methods.map((m) => m.split(".")[0]));
  const streaming = methods.filter(isStreaming).length;
  console.log(
    `[rpc] mounted ${methods.length} methods (${streaming} streaming) across: ${[...prefixes].join(", ")}`,
  );
}
