import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as SocketServer } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { SOCKET_NAMESPACE } from "@trellis/sdk/realtime";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "@trellis/sdk/realtime";
import { mountRpc } from "../src/rpcServer.js";

/**
 * Exercises mountRpc against a purpose-built spec, rather than the demo app's.
 *
 * Streaming is the subtlest machinery in the repo — cancellation has to run a
 * generator's `finally`, because that is what stops a server burning provider
 * tokens for a caller that walked away — and the demo app declares no streaming
 * methods, so none of it would otherwise be covered at all.
 */

/** Set by the streaming handler's `finally`, so tests can prove cleanup ran. */
let cleanedUp = 0;
/** Resolves on the next cleanup, so tests don't poll. */
let onCleanup: () => void = () => {};

const spec = {
  "test.unary": { params: {} as { n: number }, result: {} as { doubled: number } },
  "test.stream": { params: {} as { count: number }, chunk: {} as { i: number }, result: {} as { done: true } },
};

const handlers = {
  "test.unary": async ({ n }: { n: number }) => ({ doubled: n * 2 }),
  "test.stream": async function* ({ count }: { count: number }) {
    try {
      for (let i = 0; i < count; i++) {
        yield { i };
        await new Promise((r) => setTimeout(r, 20));
      }
      return { done: true as const };
    } finally {
      cleanedUp++;
      onCleanup();
    }
  },
};

let httpServer: HttpServer;
let socketServer: SocketServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
let url: string;

before(async () => {
  httpServer = createServer();
  socketServer = new SocketServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: "*" },
  });
  mountRpc(socketServer.of(SOCKET_NAMESPACE), spec, handlers as never);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}${SOCKET_NAMESPACE}`;
});

after(async () => {
  await new Promise<void>((resolve) => socketServer.close(() => resolve()));
});

async function connect(): Promise<Socket> {
  const socket = io(url, { forceNew: true });
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
  return socket;
}

function ack(socket: Socket, event: string, ...args: unknown[]): Promise<any> {
  return new Promise((resolve, reject) => {
    socket.emit(event, ...args, (r: any) => (r?.ok ? resolve(r.data) : reject(new Error(r?.error?.code ?? "NO_ACK"))));
  });
}

/** Collects frames for one callId until a terminal frame arrives. */
function collect(socket: Socket, callId: string) {
  const chunks: number[] = [];
  const ended = new Promise<any>((resolve) => {
    socket.on("stream", (id: string, frame: any) => {
      if (id !== callId) return;
      if (frame.type === "chunk") chunks.push(frame.chunk.i);
      else resolve(frame);
    });
  });
  return { chunks, ended };
}

test("a unary method round-trips through the ack", async () => {
  const socket = await connect();
  assert.deepEqual(await ack(socket, "request", "test.unary", { n: 21 }), { doubled: 42 });
  socket.close();
});

test("ignores malformed acknowledgements without disconnecting", async () => {
  const socket = await connect();
  socket.emit("request", "test.unary", { n: 1 }, "not-a-function" as never);
  socket.emit("request:stream", "test.stream", { count: 0 }, "bad-ack-stream", "not-a-function" as never);
  socket.emit("stream:cancel", "missing", "not-a-function" as never);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(await ack(socket, "request", "test.unary", { n: 21 }), { doubled: 42 });
  assert.equal(socket.connected, true);
  socket.close();
});

test("a streaming method yields chunks then one terminal result", async () => {
  const socket = await connect();
  const { chunks, ended } = collect(socket, "call-1");
  await ack(socket, "request:stream", "test.stream", { count: 3 }, "call-1");
  const frame = await ended;
  assert.deepEqual(chunks, [0, 1, 2]);
  assert.equal(frame.type, "end");
  assert.deepEqual(frame.result, { done: true });
  socket.close();
});

test("the two transports refuse each other's methods", async () => {
  const socket = await connect();
  // Mixing them silently would be far worse than an error: a streaming method
  // called unary would hang on an ack that never carries chunks.
  await assert.rejects(ack(socket, "request", "test.stream", { count: 1 }), /IS_STREAMING/);
  await assert.rejects(ack(socket, "request:stream", "test.unary", { n: 1 }, "call-x"), /NOT_STREAMING/);
  socket.close();
});

test("cancelling runs the handler's finally", async () => {
  const socket = await connect();
  const before = cleanedUp;
  const done = new Promise<void>((resolve) => (onCleanup = resolve));

  await ack(socket, "request:stream", "test.stream", { count: 1000 }, "call-cancel");
  await new Promise((r) => setTimeout(r, 60));
  await ack(socket, "stream:cancel", "call-cancel");

  await done;
  assert.equal(cleanedUp, before + 1, "the generator's finally must run on cancel");
  socket.close();
});

test("disconnecting runs the handler's finally", async () => {
  // A stream cannot survive a reconnect — server state is per-socket — so an
  // abandoned call must be cleaned up rather than left running unobserved.
  const socket = await connect();
  const before = cleanedUp;
  const done = new Promise<void>((resolve) => (onCleanup = resolve));

  await ack(socket, "request:stream", "test.stream", { count: 1000 }, "call-drop");
  await new Promise((r) => setTimeout(r, 60));
  socket.disconnect();

  await done;
  assert.equal(cleanedUp, before + 1, "the generator's finally must run on disconnect");
  socket.close();
});

test("a duplicate callId is refused", async () => {
  const socket = await connect();
  await ack(socket, "request:stream", "test.stream", { count: 1000 }, "call-dup");
  await assert.rejects(
    ack(socket, "request:stream", "test.stream", { count: 1 }, "call-dup"),
    /DUPLICATE_CALL/,
  );
  await ack(socket, "stream:cancel", "call-dup");
  socket.close();
});

test("inherited Object.prototype members are not streamable either", async () => {
  const socket = await connect();
  await assert.rejects(ack(socket, "request:stream", "toString", {}, "call-proto"), /NO_METHOD/);
  socket.close();
});
