import { feathers } from "@feathersjs/feathers";
import { koa, rest, bodyParser, errorHandler } from "@feathersjs/koa";
import socketio from "@feathersjs/socketio";
import { NotImplemented } from "@feathersjs/errors";
import { registerChatService } from "@trellis/client/server";

// SECURITY: no authentication is registered on this app. Any process that
// can reach this port can call any service as any identity it claims via
// the `identity` service below. This is a deliberate temporary placeholder
// — "trust based on nothing" — not a design decision to defend later. This
// is the natural slot for @feathersjs/authentication once this stops being
// a prototype.

interface ConnectionIdentity {
  identity?: { username: string; displayName: string };
}

class IdentityService {
  async create(
    data: { username: string; displayName: string },
    params?: { connection?: ConnectionIdentity },
  ) {
    if (params?.connection) {
      params.connection.identity = { username: data.username, displayName: data.displayName };
    }
    console.log(`[audit] connect username=${data.username} displayName=${data.displayName}`);
    return data;
  }
}

/**
 * Provisional core-owned stub. Not wired into HostContext/LlmApi yet —
 * exists to give the request shape a home. Once the client app needs this
 * capability for real, it should own the endpoint the way it already owns
 * `chat` (see apps/client/server), and this stub should be deleted rather
 * than grown.
 */
class StubService {
  constructor(private readonly capability: string) {}
  async find(): Promise<never> {
    throw new NotImplemented(`${this.capability} is not implemented yet`);
  }
  async create(): Promise<never> {
    throw new NotImplemented(`${this.capability} is not implemented yet`);
  }
}

export function createApp() {
  const app = koa(feathers());

  app.use(errorHandler());
  app.use(bodyParser());
  app.configure(rest());
  app.configure(socketio());

  app.use("identity", new IdentityService());
  app.use("llm", new StubService("llm:invoke"));
  app.use("bundles", new StubService("plugin-bundles"));

  // The client app's own server-owned endpoint — see apps/client/server.
  registerChatService(app);

  app.on("connection", (connection) => app.channel("everyone").join(connection));

  return app;
}
