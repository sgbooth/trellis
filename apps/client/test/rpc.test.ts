import { test } from "node:test";
import assert from "node:assert/strict";
import type { RealtimeApi } from "@trellis/sdk";
import { initRpc, rpc } from "../src/rpc.js";

function createRealtime(calls: string[]): RealtimeApi {
  return {
    call: async (method) => {
      calls.push(method);
      return [];
    },
    stream: () => {
      throw new Error("not used");
    },
    subscribe: async () => {
      throw new Error("not used");
    },
    publish: async () => {},
  };
}

test("initRpc reuses the current transport and rebinds when it changes", async () => {
  const firstCalls: string[] = [];
  const firstRealtime = createRealtime(firstCalls);
  initRpc({ realtime: firstRealtime });
  initRpc({ realtime: firstRealtime });
  await rpc.chat.history({ roomId: "first" });
  assert.deepEqual(firstCalls, ["chat.history"]);

  const secondCalls: string[] = [];
  const secondRealtime = createRealtime(secondCalls);
  initRpc({ realtime: secondRealtime });
  await rpc.chat.history({ roomId: "second" });
  assert.deepEqual(secondCalls, ["chat.history"]);
});
