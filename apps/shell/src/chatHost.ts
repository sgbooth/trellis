import { feathers } from "@feathersjs/feathers";
import socketio from "@feathersjs/socketio-client";
import { io } from "socket.io-client";
import type { ChatApi, ChatMessage, IdentityInfo } from "@trellis/sdk";

// dev-only hardcode — no deployed broker location yet.
const SERVER_URL = "http://localhost:8787";

/**
 * Shell-owned Feathers/Socket.io relay client — plugins never get a raw
 * network client of their own, only what's exposed through HostContext.
 * Calls the `identity` service once on connect to attach OS identity to the
 * socket for server-side audit logging; this happens unconditionally,
 * independent of whether the plugin being handed this ChatApi was actually
 * granted `chat:invoke` — the shell isn't bound by plugin capability grants
 * the way plugins are (see CLAUDE.md).
 */
export function createChatApi(identity: IdentityInfo): ChatApi {
  const socket = io(SERVER_URL);
  const app = feathers().configure(socketio(socket));
  const chatService = app.service("chat");

  socket.on("connect", () => {
    app.service("identity").create({ username: identity.username, displayName: identity.displayName });
  });

  const listeners = new Set<(message: ChatMessage) => void>();
  chatService.on("created", (message: ChatMessage) => {
    for (const listener of listeners) listener(message);
  });

  return {
    async send(text) {
      await chatService.create({ text });
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
