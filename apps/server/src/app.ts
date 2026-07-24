import { fileURLToPath } from "node:url";
import { feathers } from "@feathersjs/feathers";
import { koa, rest, bodyParser, errorHandler } from "@feathersjs/koa";
import socketio from "@feathersjs/socketio";
import cors from "@koa/cors";
import serveStatic from "koa-static";

// SECURITY: no authentication is registered on this app. Any process that
// can reach this port can call any service as any identity it claims via
// the `identity` service below. This is a deliberate temporary placeholder
// — "trust based on nothing" — not a design decision to defend later. This
// is the natural slot for @feathersjs/authentication once this stops being
// a prototype.
//
// Unlike the sandboxed-webview architecture this project used to have,
// this server isn't a trust boundary between an untrusted client and real
// credentials — apps/client and apps/shell are built by the same team at
// the same trust level. This server exists for things that are inherently
// global/shared: serving the one current client bundle to every shell
// instance (see CLIENT_DIST_DIR below), and — later — broadcast-style
// features (chat, notifications) that need a process every connected
// client can reach, which no single client's own Tauri process can be on
// its own. FeatherJS was kept specifically because its services/channels
// model is built for adding more of that shape without a rewrite.

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

// Resolved relative to this file so it works regardless of cwd — apps/client's
// build step (build.mjs) is what produces dist/index.js + dist/manifest.json.
const CLIENT_DIST_DIR = fileURLToPath(new URL("../../client/dist", import.meta.url));

export function createApp() {
  const app = koa(feathers());

  app.use(errorHandler());
  app.use(cors());
  app.use(bodyParser());

  // Serves apps/client's built bundle at e.g. GET /index.js and
  // GET /manifest.json — the actual distribution mechanism: push a new
  // build here and every running shell picks it up on next load, no
  // per-machine file copy. Replaces the old Rust `plugin://` protocol
  // handler, which read straight off local disk.
  app.use(serveStatic(CLIENT_DIST_DIR));

  app.configure(rest());
  app.configure(socketio({ cors: { origin: "*" } }));

  app.use("identity", new IdentityService());

  // Extend here: mount whatever server-owned endpoints the client app
  // needs, the way `identity` is mounted above — see CLAUDE.md's Backend
  // section for the client-owns-its-endpoint pattern (apps/client/server,
  // imported into this file via `@trellis/client/server` once something
  // real exists there).

  return app;
}
