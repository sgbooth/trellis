import { test } from "node:test";
import assert from "node:assert/strict";
import { createRpcClient, RpcError } from "../src/rpc.js";

const spec = {
  "chat.send": { params: {} as { text: string }, result: {} as { id: string } },
  "llm.stream": { params: {} as { prompt: string }, chunk: {} as { text: string }, result: {} as { stop: string } },
};

const stubStream = () => ({
  [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true as const }) }),
  result: Promise.resolve({ stop: "end" }),
  cancel: () => {},
});

test("namespaced sugar is built from the spec's dotted keys", async () => {
  const calls: string[] = [];
  const client = createRpcClient(spec, async (m) => (calls.push(m), { id: "1" }), stubStream);
  await client.chat.send({ text: "hi" });
  assert.deepEqual(calls, ["chat.send"]);
});

test("call() and the sugar reach the same method", async () => {
  const calls: string[] = [];
  const client = createRpcClient(spec, async (m) => (calls.push(m), { id: "1" }), stubStream);
  await client.call("chat.send", { text: "hi" });
  await client.chat.send({ text: "hi" });
  assert.deepEqual(calls, ["chat.send", "chat.send"]);
});

test("a `chunk` entry routes to the stream transport, not the unary one", () => {
  // The runtime split must agree with the type-level one, which reads
  // `"chunk" extends keyof S[K]`. If these ever disagree, streaming methods
  // silently unary-call and hang waiting for an ack that carries no chunks.
  let unary = 0;
  let streamed = 0;
  const client = createRpcClient(
    spec,
    async () => (unary++, {}),
    () => (streamed++, stubStream()),
  );
  client.llm.stream({ prompt: "x" });
  assert.equal(streamed, 1, "streaming method must use the stream transport");
  assert.equal(unary, 0, "streaming method must not use the unary transport");
});

test("a streaming method without a stream transport fails loudly", () => {
  // Better than returning something half-alive that never yields.
  const client = createRpcClient(spec, async () => ({}));
  assert.throws(() => client.llm.stream({ prompt: "x" }), /streaming method/);
});

test("RpcError carries the wire code", () => {
  const error = new RpcError("NOT_FOUND", "nope");
  assert.equal(error.code, "NOT_FOUND");
  assert.equal(error.name, "RpcError");
  assert.ok(error instanceof Error);
});
