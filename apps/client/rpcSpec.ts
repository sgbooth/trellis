/**
 * Every RPC method in this deployment, in one place.
 *
 * Method names are `<prefix>.<verb>`, and the prefix maps to exactly one
 * handler file: every `chat.*` is implemented in
 * `server/handlers/chatHandlers.ts`. Read this file for the API surface;
 * open the matching handler file for the implementation.
 *
 * `{} as X` rather than a plain type: this is a real runtime value (the
 * client needs the key list to build `rpc.chat.send(...)`) that also carries
 * every type via `typeof rpcSpec`.
 *
 * Adding a method here makes the matching handler file fail to compile until
 * it's implemented — `HandlersFor<typeof rpcSpec, "chat">` requires the
 * complete `chat.*` slice.
 *
 * Keep this file free of runtime dependencies. It is bundled into the browser
 * by esbuild *and* loaded under Node by the broker.
 */

export type ChatMessage = { id: string; from: string; text: string; ts: number };

export const rpcSpec = {
  //! chat
  "chat.send": {
    params: {} as { roomId: string; text: string },
    result: {} as ChatMessage,
  },
  "chat.history": {
    params: {} as { roomId: string },
    result: {} as ChatMessage[],
  },
};
