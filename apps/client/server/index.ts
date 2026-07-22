import type { Application, Params } from "@feathersjs/feathers";
// Module augmentation only — adds .publish()/.channel() to Application's type.
import "@feathersjs/transport-commons";

interface ChatCreateData {
  text: string;
}

interface ConnectionIdentity {
  connection?: {
    identity?: { username?: string };
  };
}

/**
 * The chat plugin's own broker-hosted endpoint. Mounted by apps/server
 * (the core broker), not by the plugin itself — this file runs in the
 * trusted Node process, never in the sandboxed plugin webview.
 *
 * `params.connection.identity` is set by the core `identity` service when a
 * socket client calls it after connecting (see apps/shell's chatHost.ts);
 * it's unverified and audit-trail-only, same caveat as IdentityInfo.
 */
export function registerChatService(app: Application): void {
  app.use("chat", {
    async create(data: ChatCreateData, params?: Params & ConnectionIdentity) {
      return {
        from: params?.connection?.identity?.username ?? "unknown",
        text: data.text,
        ts: Date.now(),
      };
    },
  });

  // future: room-scoped channels once chat capability grows a manifest scoping param
  app.service("chat").publish(() => app.channel("everyone"));
}
