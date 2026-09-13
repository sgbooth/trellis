import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as SocketServer } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { SOCKET_NAMESPACE } from "@trellis/sdk/realtime";
import type { ClientToServerEvents, ErasedChannelHandlers, ServerToClientEvents, SocketData } from "@trellis/sdk/realtime";
import { mountChannels } from "../src/channelServer.js";

/**
 * Exercises mountChannels against purpose-built handlers rather than whatever
 * client app happens to be mounted.
 *
 * That independence is the point: the broker "never learns what a matter is",
 * so its tests must not know what a chat is either. Testing these guarantees
 * through the demo app's `chat` family would mean a fork that resets
 * apps/client breaks the broker's test suite — which is exactly what happened
 * before this was split out.
 */

/** Stands in for an app's store. Tests mutate it to simulate missed traffic. */
const store = new Map<string, string[]>();
let allowAll = true;

const handlers: Record<string, ErasedChannelHandlers> = {
  // Snapshot + publish.
  thing: {
    snapshot: ({ id }) => store.get(id ?? "") ?? [],
    publish: (ctx, event) => {
      store.set(ctx.id ?? "", [...(store.get(ctx.id ?? "") ?? []), String(event)]);
    },
  },
  // Push-only: no publish hook, which must be NO_HANDLER rather than a stub.
  readonly: { snapshot: () => ["fixed"] },
};

let httpServer: HttpServer;
let socketServer: SocketServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
let url: string;
let broadcast: (channel: string, payload: unknown) => void;

before(async () => {
  httpServer = createServer();
  socketServer = new SocketServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: "*" },
  });
  broadcast = mountChannels(
    socketServer.of(SOCKET_NAMESPACE),
    handlers,
    (_socket, name) => allowAll || !name.startsWith("secret"),
  );
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

test("subscribing returns the family's snapshot", async () => {
  store.set("a", ["one", "two"]);
  const socket = await connect();
  assert.deepEqual(await ack(socket, "subscribe", "thing/a"), ["one", "two"]);
  socket.close();
});

test("ignores malformed acknowledgements without disconnecting", async () => {
  const socket = await connect();
  socket.emit("subscribe", "thing/bad-ack", "not-a-function" as never);
  socket.emit("publish", "thing/bad-ack", "event", "not-a-function" as never);
  socket.emit("unsubscribe", "thing/bad-ack", "not-a-function" as never);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(await ack(socket, "subscribe", "thing/bad-ack"), ["event"]);
  assert.equal(socket.connected, true);
  socket.close();
});

test("rejects malformed channel names without stopping the broker", async () => {
  const socket = await connect();
  await assert.rejects(ack(socket, "subscribe", null), /INVALID_CHANNEL/);
  await assert.rejects(ack(socket, "subscribe", ""), /INVALID_CHANNEL/);
  await assert.rejects(ack(socket, "subscribe", "/missing-family"), /INVALID_CHANNEL/);
  await assert.rejects(ack(socket, "subscribe", "x".repeat(257)), /INVALID_CHANNEL/);
  await assert.rejects(ack(socket, "publish", { not: "a channel" }, "event"), /INVALID_CHANNEL/);
  await assert.rejects(ack(socket, "unsubscribe", []), /INVALID_CHANNEL/);
  assert.deepEqual(await ack(socket, "subscribe", "thing/still-alive"), []);
  assert.equal(socket.connected, true);
  socket.close();
});

test("a family with no handler subscribes with a null snapshot", async () => {
  const socket = await connect();
  assert.equal(await ack(socket, "subscribe", "unknown-family"), null);
  socket.close();
});

test("subscribers receive broadcasts to their room only", async () => {
  const a = await connect();
  const b = await connect();
  const seenA: unknown[] = [];
  const seenB: unknown[] = [];
  a.on("event", (_c: string, p: unknown) => seenA.push(p));
  b.on("event", (_c: string, p: unknown) => seenB.push(p));

  await ack(a, "subscribe", "thing/room-1");
  await ack(b, "subscribe", "thing/room-2");
  broadcast("thing/room-1", { hello: true });
  await new Promise((r) => setTimeout(r, 100));

  assert.deepEqual(seenA, [{ hello: true }]);
  assert.deepEqual(seenB, [], "a room's traffic must not reach another room");
  a.close();
  b.close();
});

test("re-subscribing yields a fresh snapshot, not the original one", async () => {
  // This is the guarantee the reconnect path depends on: nothing published
  // while a socket was away is replayed as an `event`, so the snapshot from a
  // re-subscribe is the only route back to correct state.
  store.set("resync", ["before"]);
  const socket = await connect();
  assert.deepEqual(await ack(socket, "subscribe", "thing/resync"), ["before"]);

  socket.disconnect();
  store.set("resync", ["before", "while-away"]); // happened with nobody listening

  socket.connect();
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
  assert.deepEqual(await ack(socket, "subscribe", "thing/resync"), ["before", "while-away"]);
  socket.close();
});

test("unsubscribing stops delivery", async () => {
  const socket = await connect();
  const seen: unknown[] = [];
  socket.on("event", (_c: string, p: unknown) => seen.push(p));
  await ack(socket, "subscribe", "thing/leaving");
  await ack(socket, "unsubscribe", "thing/leaving");
  broadcast("thing/leaving", { nope: true });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(seen, []);
  socket.close();
});

test("client publish reaches the family's publish hook", async () => {
  store.delete("pub");
  const socket = await connect();
  await ack(socket, "subscribe", "thing/pub");
  await ack(socket, "publish", "thing/pub", "from-client");
  assert.deepEqual(store.get("pub"), ["from-client"]);
  socket.close();
});

test("publishing to a family with no publish hook is NO_HANDLER", async () => {
  // A push-only family omits the hook rather than defining a throwing stub.
  const socket = await connect();
  await ack(socket, "subscribe", "readonly");
  await assert.rejects(ack(socket, "publish", "readonly", "x"), /NO_HANDLER/);
  socket.close();
});

test("a failing snapshot becomes an ack, not a disconnect", async () => {
  const socket = await connect();
  handlers.thing.snapshot = () => {
    throw new Error("boom");
  };
  await assert.rejects(ack(socket, "subscribe", "thing/explode"), /SNAPSHOT_FAILED/);
  assert.equal(socket.connected, true);
  handlers.thing.snapshot = ({ id }) => store.get(id ?? "") ?? [];
  socket.close();
});

test("authorize gates both subscribe and publish", async () => {
  // Publishing into a room you were never allowed to join would be a trivial
  // bypass of the subscribe check, so both go through the same hook.
  allowAll = false;
  const socket = await connect();
  await assert.rejects(ack(socket, "subscribe", "secret/x"), /FORBIDDEN/);
  await assert.rejects(ack(socket, "publish", "secret/x", "y"), /FORBIDDEN/);
  allowAll = true;
  socket.close();
});
