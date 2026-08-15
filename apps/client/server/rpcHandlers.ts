import type { HandlerMap } from "@trellis/sdk/rpc";
import { rpcSpec } from "../rpcSpec.js";
import { chatHandlers } from "./handlers/chatHandlers.js";

/**
 * Every handler file, spread into one flat map. The `satisfies` is what
 * guarantees the whole spec is covered — a method in rpcSpec.ts with no
 * handler fails here, at compile time.
 */
export const handlers = {
  ...chatHandlers,
} satisfies HandlerMap<typeof rpcSpec>;
