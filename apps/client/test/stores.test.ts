import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { appendMessage, historyFor, resetChatStore } from "#server/chatStore.js";
import type { ChatMessage } from "#rpcSpec";
import { MAX_MESSAGE_LENGTH, MAX_ROOM_ID_LENGTH, requireMessageText, requireRoomId } from "#server/input.js";

const message = (id: string): ChatMessage => ({ id, from: "t", text: id, ts: Date.now() });

beforeEach(() => resetChatStore());

test("history for an unseen room is empty", () => {
  assert.deepEqual(historyFor("never-used"), []);
});

test("reading does not allocate a room", () => {
  // The regression this guards: `historyFor` used to create-on-read, and it
  // runs on every subscribe while authorizeSubscribe admits everyone — so
  // anyone could grow broker memory without bound by subscribing to
  // `chat/<random>` in a loop, never sending a thing.
  for (let i = 0; i < 10_000; i++) historyFor(`probe-${i}`);
  // Only a real write creates a room, so one write means exactly one room.
  appendMessage("real", message("m1"));
  assert.deepEqual(historyFor("real").map((m) => m.id), ["m1"]);
  for (let i = 0; i < 10_000; i++) assert.deepEqual(historyFor(`probe-${i}`), []);
});

test("messages are capped per room, oldest dropped first", () => {
  for (let i = 0; i < 150; i++) appendMessage("busy", message(`m${i}`));
  const history = historyFor("busy");
  assert.equal(history.length, 100);
  assert.equal(history[0].id, "m50", "oldest beyond the cap are dropped");
  assert.equal(history.at(-1)!.id, "m149");
});

test("rooms are capped, least-recently-written evicted first", () => {
  for (let i = 0; i < 600; i++) appendMessage(`room-${i}`, message(`m${i}`));
  assert.deepEqual(historyFor("room-0"), [], "earliest room evicted");
  assert.equal(historyFor("room-599").length, 1, "newest room retained");
});

test("writing to an old room keeps it alive", () => {
  appendMessage("keep-me", message("first"));
  for (let i = 0; i < 400; i++) appendMessage(`filler-${i}`, message(`f${i}`));
  appendMessage("keep-me", message("second")); // touch it
  for (let i = 400; i < 600; i++) appendMessage(`filler-${i}`, message(`f${i}`));
  assert.equal(historyFor("keep-me").length, 2, "recently-written room survives eviction");
});

test("callers cannot mutate stored history", () => {
  appendMessage("guarded", message("m1"));
  historyFor("guarded").push(message("injected"));
  assert.deepEqual(historyFor("guarded").map((m) => m.id), ["m1"]);
});

test("rejects oversized message text and room ids", () => {
  assert.throws(() => requireMessageText("x".repeat(MAX_MESSAGE_LENGTH + 1)), /at most/);
  assert.throws(() => requireRoomId("x".repeat(MAX_ROOM_ID_LENGTH + 1)), /at most/);
});
