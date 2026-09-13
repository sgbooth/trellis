import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { createApp, type TrellisApp } from "../src/app.js";

/**
 * The broker's own surface: static serving, the health probe, and the socket
 * behaviour that holds regardless of which client app is mounted.
 *
 * Deliberately references **no** method or channel from apps/client. The broker
 * never learns what a "chat" is, so neither does this file — otherwise a fork
 * running `pnpm reset:client` would delete the demo and break the broker's test
 * suite along with it. Mechanism-level coverage lives in rpcServer.test.ts and
 * channelServer.test.ts, which mount their own purpose-built handlers.
 */

let app: TrellisApp;
let url: string;

before(async () => {
  app = createApp();
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
});

after(async () => {
  await app.close();
});

async function connect(): Promise<Socket> {
  const socket = io(`${url}/socket`, { forceNew: true });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", reject);
  });
  return socket;
}

function ack(socket: Socket, event: string, ...args: unknown[]): Promise<any> {
  return new Promise((resolve, reject) => {
    socket.emit(event, ...args, (r: any) => (r?.ok ? resolve(r.data) : reject(new Error(r?.error?.code ?? "NO_ACK"))));
  });
}

test("answers the health probe before any routing", async () => {
  const response = await fetch(`${url}/healthz`);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "ok");
});

test("returns 400 for malformed URL encoding without stopping the broker", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(url, { path: "/%" }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });

  assert.equal(status, 400);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
});

test("refuses path traversal out of a static root", async () => {
  // Must hold for an encoded `..` too, which is why the implementation
  // normalizes before comparing prefixes.
  for (const path of ["/client/../../package.json", "/client/%2e%2e/%2e%2e/package.json"]) {
    const response = await fetch(`${url}${path}`, { redirect: "manual" });
    assert.ok(response.status === 403 || response.status === 404, `${path} -> ${response.status}`);
  }
});

test("serves the browser shell under a restrictive CSP", async () => {
  const response = await fetch(`${url}/`);
  const csp = response.headers.get("content-security-policy");
  assert.match(csp ?? "", /default-src 'self'/);
  assert.match(csp ?? "", /object-src 'none'/);
  assert.doesNotMatch(csp ?? "", /unsafe-eval/);
});

test("revalidates a matching static resource with its ETag", async () => {
  const initial = await fetch(`${url}/client/index.js`);
  const etag = initial.headers.get("etag");
  assert.equal(initial.headers.get("cache-control"), "no-cache");
  assert.ok(etag);
  assert.equal((await fetch(`${url}/client/index.js`, { headers: { "If-None-Match": etag } })).status, 304);
});

test("rejects a method that is in no spec", async () => {
  const socket = await connect();
  await assert.rejects(ack(socket, "request", "nope.nope", {}), /NO_METHOD/);
  socket.close();
});

test("rejects inherited Object.prototype members as methods", async () => {
  // The handler map is a plain object literal, so an unguarded lookup resolves
  // these to real functions and dispatches them as if they were handlers.
  const socket = await connect();
  for (const method of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
    await assert.rejects(ack(socket, "request", method, {}), /NO_METHOD/, method);
  }
  socket.close();
});

test("accepts an identity claim and keeps the socket usable", async () => {
  const socket = await connect();
  await ack(socket, "identity:claim", { username: "tester", displayName: "Tester" });
  assert.equal(socket.connected, true);
  socket.close();
});

test("ignores a malformed identity acknowledgement and keeps the socket usable", async () => {
  const socket = await connect();
  socket.emit("identity:claim", { username: "tester", displayName: "Tester" }, "not-a-function" as never);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await ack(socket, "identity:claim", { username: "tester", displayName: "Tester" });
  assert.equal(socket.connected, true);
  socket.close();
});

test("survives a hostile identity claim", async () => {
  // The claim is unauthenticated and goes straight into a line-oriented audit
  // log, so a newline must not be able to forge a second entry, an oversized
  // value must not flood it, and a non-string must not throw.
  const socket = await connect();
  await ack(socket, "identity:claim", {
    username: "eve\n[audit] connect username=admin",
    displayName: { not: "a string" },
  });
  await ack(socket, "identity:claim", { username: "x".repeat(5000), displayName: "y" });
  assert.equal(socket.connected, true);
  socket.close();
});

test("closing the app disconnects live sockets", async () => {
  // This is what runs each socket's `disconnect` handler, which is in turn what
  // returns in-flight stream generators so their `finally` can release things.
  const local = createApp();
  await new Promise<void>((resolve) => local.httpServer.listen(0, resolve));
  const port = (local.httpServer.address() as AddressInfo).port;
  const socket = io(`http://localhost:${port}/socket`, { forceNew: true });
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));

  const disconnected = new Promise<void>((resolve) => socket.on("disconnect", () => resolve()));
  await local.close();
  await disconnected;
  assert.equal(socket.connected, false);
  socket.close();
});
