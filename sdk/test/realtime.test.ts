import { test } from "node:test";
import assert from "node:assert/strict";
import { channel, parseChannel, SOCKET_NAMESPACE } from "../src/realtime.js";

test("parseChannel splits family from id", () => {
  assert.deepEqual(parseChannel("chat/general"), { family: "chat", id: "general" });
  assert.deepEqual(parseChannel("docket"), { family: "docket" });
});

test("parseChannel keeps later slashes in the id", () => {
  // `matter/42/notes` is one room whose id contains a slash — the family is
  // only ever the first segment, since that is what handlers register against.
  assert.deepEqual(parseChannel("matter/42/notes"), { family: "matter", id: "42/notes" });
});

test("parseChannel treats a trailing slash as no id", () => {
  // Otherwise `peer/` and `peer` would be different rooms that render
  // identically in a log, and a snapshot provider would see id === "".
  assert.deepEqual(parseChannel("peer/"), { family: "peer", id: undefined });
});

test("channel() carries the name through unchanged", () => {
  assert.equal(channel("chat/general").name, "chat/general");
});

test("the namespace is a single fixed value", () => {
  assert.equal(SOCKET_NAMESPACE, "/socket");
});
