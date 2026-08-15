import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Server as SocketServer, type Socket } from "socket.io";
import { SOCKET_NAMESPACE, parseChannel } from "@trellis/sdk/realtime";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "@trellis/sdk/realtime";
import { handlers, rpcSpec, setRoomPublisher } from "@trellis/client/server";
import { mountRpc } from "./rpcServer.js";
import { createRegistry, type RegistryHandle } from "./registry.js";

// SECURITY: no authentication is registered on this app. Any process that
// can reach this port can open the socket and claim any identity it likes
// via `identity:claim` below. This is a deliberate temporary placeholder
// — "trust based on nothing" — not a design decision to defend later.
//
// The specific thing to fix first is `authorizeSubscribe`: rooms like
// `matter/{matterId}` are the point where joining the wrong one leaks
// privileged material, and today it lets everyone into everything. The
// hook exists so that check has one obvious home when auth lands, rather
// than needing to be retrofitted across every caller.
//
// Note this server is not a trust boundary between an untrusted client and
// real credentials — apps/client and apps/shell are built by the same team
// at the same trust level. It exists for things that are inherently
// global/shared: serving the one current client bundle to every shell
// instance (see CLIENT_DIST_DIR below), and brokering realtime/RPC traffic
// that no single client's own Tauri process could carry on its own.

type TrellisSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type TrellisServer = SocketServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type TrellisNamespace = ReturnType<TrellisServer["of"]>;

// Resolved relative to this file so it works regardless of cwd — apps/client's
// build step (build.mjs) is what produces dist/index.js + dist/manifest.json.
const CLIENT_DIST_DIR = fileURLToPath(new URL("../../client/dist", import.meta.url));

const MIME_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".css": "text/css",
  ".html": "text/html",
};

/**
 * The authorization seam. Returns true for everything right now — see the
 * SECURITY note above. Do not add callers that bypass it.
 */
function authorizeSubscribe(socket: TrellisSocket, channelName: string): boolean {
  void socket;
  void channelName;
  return true;
}

export function createApp(): HttpServer {
  const httpServer = createServer(serveClientBundle);

  const io: TrellisServer = new SocketServer(httpServer, { cors: { origin: "*" } });
  const ns = io.of(SOCKET_NAMESPACE);

  ns.on("connection", (socket: TrellisSocket) => {
    socket.on("identity:claim", (identity, ack) => {
      socket.data.identity = { username: identity.username, displayName: identity.displayName };
      console.log(`[audit] connect username=${identity.username} displayName=${identity.displayName}`);
      ack?.({ ok: true, data: undefined });
    });
  });

  // Request/response. The client app owns both the spec and the handlers —
  // apps/server never learns what a "matter" is.
  mountRpc(ns, rpcSpec, handlers);

  mountChannels(ns);

  return httpServer;
}

/**
 * Serves apps/client's built bundle at e.g. GET /index.js and
 * GET /manifest.json — the actual distribution mechanism: push a new build
 * here and every running shell picks it up on next load, no per-machine
 * file copy. Replaces the old Rust `plugin://` protocol handler, which read
 * straight off local disk.
 *
 * socket.io re-registers this listener behind its own, so requests on its
 * path never reach here.
 */
function serveClientBundle(req: IncomingMessage, res: ServerResponse): void {
  // The shell reaches the bundle via a cross-origin `import()`, which is a
  // CORS-checked fetch — without this header the module load fails opaquely.
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  // normalize collapses `..` before the prefix check, so an encoded
  // traversal can't escape dist/ into the rest of the checkout.
  const filePath = resolve(CLIENT_DIST_DIR, `.${normalize(pathname)}`);
  if (filePath !== CLIENT_DIST_DIR && !filePath.startsWith(CLIENT_DIST_DIR + sep)) {
    res.writeHead(403).end();
    return;
  }

  stat(filePath)
    .then((stats) => {
      if (!stats.isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
        "Content-Length": stats.size,
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(filePath).pipe(res);
    })
    .catch(() => {
      res.writeHead(404).end();
    });
}

/**
 * PARKED — the room/subscription half. Left mounted so the chat panel keeps
 * working, but the design is on hold; see apps/client/channelSpec.ts.
 */
function mountChannels(ns: TrellisNamespace): void {
  const registry: RegistryHandle = createRegistry((channelName, payload) => {
    ns.to(channelName).emit("event", channelName, payload);
  });
  setRoomPublisher((channelName, payload) => registry.publishRaw(channelName, payload));

  ns.on("connection", (socket: TrellisSocket) => {
    socket.on("subscribe", async (channelName, ack) => {
      if (!authorizeSubscribe(socket, channelName)) {
        ack?.({ ok: false, error: { code: "FORBIDDEN", message: `not authorized for ${channelName}` } });
        return;
      }
      const { family, id } = parseChannel(channelName);
      try {
        const provider = registry.getSnapshotProvider(family);
        const snapshot = provider
          ? await provider({ channel: channelName, family, id, identity: socket.data.identity })
          : null;
        // Join only after the snapshot resolves, so a client can't miss an
        // event published between joining and receiving its initial state.
        await socket.join(channelName);
        ack?.({ ok: true, data: snapshot });
      } catch (cause) {
        ack?.({
          ok: false,
          error: { code: "SNAPSHOT_FAILED", message: cause instanceof Error ? cause.message : String(cause) },
        });
      }
    });

    socket.on("unsubscribe", async (channelName, ack) => {
      await socket.leave(channelName);
      ack?.({ ok: true, data: undefined });
    });

    socket.on("publish", async (channelName, event, ack) => {
      // Publishing into a room you were never authorized to join would be a
      // trivial bypass of authorizeSubscribe, so it's gated the same way.
      if (!authorizeSubscribe(socket, channelName)) {
        ack?.({ ok: false, error: { code: "FORBIDDEN", message: `not authorized for ${channelName}` } });
        return;
      }
      const { family, id } = parseChannel(channelName);
      const handler = registry.getPublishHandler(family);
      if (!handler) {
        ack?.({ ok: false, error: { code: "NO_HANDLER", message: `no publish handler for ${family}` } });
        return;
      }
      try {
        await handler({ channel: channelName, family, id, identity: socket.data.identity }, event);
        ack?.({ ok: true, data: undefined });
      } catch (cause) {
        ack?.({
          ok: false,
          error: { code: "PUBLISH_FAILED", message: cause instanceof Error ? cause.message : String(cause) },
        });
      }
    });
  });
}
