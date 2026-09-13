import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Server as SocketServer, type Socket } from "socket.io";
import { SOCKET_NAMESPACE } from "@trellis/sdk/realtime";
import type {
  ClientToServerEvents,
  IdentityInfo,
  ServerToClientEvents,
  SocketData,
} from "@trellis/sdk/realtime";
import { channelHandlers, handlers, rpcSpec, setChannelPublisher } from "@trellis/client/server";
import { mountRpc } from "./rpcServer.js";
import { mountChannels } from "./channelServer.js";

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

function safeAck(ack: unknown): (result: unknown) => void {
  return typeof ack === "function" ? (ack as (result: unknown) => void) : () => {};
}
// Both resolved relative to this file so they work regardless of cwd, and by
// path rather than by package dependency — neither adds an edge to the
// workspace graph. apps/client's build.mjs produces dist/index.js;
// apps/shell's vite build produces web.html + assets/.
const CLIENT_DIST_DIR = fileURLToPath(new URL("../../client/dist", import.meta.url));
const SHELL_DIST_DIR = fileURLToPath(new URL("../../shell/dist", import.meta.url));

/**
 * The client bundle is machine-fetched by whatever shell is running, so it
 * lives under a prefix; the root is left for the human-visitable browser
 * shell. A shell that isn't built yet just 404s.
 */
const CLIENT_PREFIX = "/client";

const MIME_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const BROWSER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self' ws: wss:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

function matchesEtag(value: string | undefined, etag: string): boolean {
  return value?.split(",").some((candidate) => candidate.trim() === etag || candidate.trim() === "*") ?? false;
}

/**
 * Longest identity token kept from a claim. Generous for a real name, short
 * enough that a claim cannot flood the audit log.
 */
const MAX_IDENTITY_LENGTH = 64;

/**
 * Reduces one claimed identity field to a bounded, single-line token.
 *
 * The claim arrives from an unauthenticated client and goes straight into a
 * line-oriented audit log, so a value containing a newline could forge
 * additional log entries — the one consequence an unverified identity should
 * not have, given the log is the only thing it is good for. Control and
 * format characters (newlines, NULs, zero-width joiners) become spaces rather
 * than being stripped, so a forged token can't be made to look like a
 * different real one by deleting a separator.
 *
 * This is sanitization, not authentication. Nothing here makes the claim
 * true — see the SECURITY note above.
 */
function sanitizeIdentityField(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().slice(0, MAX_IDENTITY_LENGTH);
  return cleaned || "unknown";
}

/**
 * The authorization seam. Returns true for everything right now — see the
 * SECURITY note above. Do not add callers that bypass it.
 */
function authorizeSubscribe(socket: TrellisSocket, channelName: string): boolean {
  void socket;
  void channelName;
  return true;
}

/**
 * A running broker, plus the handle needed to stop one cleanly.
 *
 * `close` exists because shutting down is not just "stop listening": in-flight
 * streaming RPC handlers hold provider calls open, and the only thing that
 * releases them is the generator's `finally`, which runs when its socket
 * disconnects. A process that exits without disconnecting its sockets leaks
 * exactly the work cancellation was built to stop.
 */
export interface TrellisApp {
  httpServer: HttpServer;
  /** Disconnects every socket, then closes the listener. */
  close(): Promise<void>;
}

/**
 * How long to wait for a clean close before forcing sockets shut. A keep-alive
 * HTTP connection can hold the listener open well past the point where the
 * process should be gone, and an orchestrator will SIGKILL us anyway.
 */
const SHUTDOWN_GRACE_MS = 5000;

export function createApp(): TrellisApp {
  const httpServer = createServer(serveStatic);

  const io: TrellisServer = new SocketServer(httpServer, { cors: { origin: "*" } });
  const ns = io.of(SOCKET_NAMESPACE);

  ns.on("connection", (socket: TrellisSocket) => {
    socket.on("identity:claim", (identity, ack) => {
      const reply = safeAck(ack);
      // Typed as IdentityInfo by the wire contract, but the wire enforces
      // nothing — this is an object off an unauthenticated socket.
      const claim = identity as Partial<IdentityInfo> | undefined;
      const username = sanitizeIdentityField(claim?.username);
      const displayName = sanitizeIdentityField(claim?.displayName);

      socket.data.identity = { username, displayName };
      console.log(`[audit] connect socket=${socket.id} username=${username} displayName=${displayName}`);
      reply({ ok: true, data: undefined });
    });
  });

  // Request/response. The client app owns both the spec and the handlers —
  // apps/server never learns what a "matter" is.
  mountRpc(ns, rpcSpec, handlers);

  // Room membership and server→client push, same division: the client app
  // owns the families and what flows over them. The returned broadcast is
  // handed back to the app so its handlers can fan out without a socket.
  setChannelPublisher(mountChannels(ns, channelHandlers, authorizeSubscribe));

  return {
    httpServer,
    close() {
      return new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        // Forced fallback: io.close()'s callback waits on the HTTP listener,
        // which a keep-alive connection can hold open indefinitely.
        const timer = setTimeout(() => {
          httpServer.closeAllConnections?.();
          done();
        }, SHUTDOWN_GRACE_MS);
        // Disconnects every socket first — that is what runs each one's
        // `disconnect` handler in mountRpc, returning its live generators so
        // their `finally` releases whatever they were holding.
        io.close(() => {
          clearTimeout(timer);
          done();
        });
      });
    },
  };
}

/**
 * Serves two built frontends off one origin — the actual distribution
 * mechanism: push a new build here and every running shell picks it up on
 * next load, no per-machine file copy. Replaces the old Rust `plugin://`
 * protocol handler, which read straight off local disk.
 *
 *   GET /healthz              liveness probe (answered before routing)
 *   GET /client/index.js      apps/client's bundle, fetched by any shell
 *   GET /                     apps/shell's browser entry (web.html)
 *   GET /assets/…             apps/shell's hashed assets
 *
 * Sharing an origin is what lets the browser shell reach the bundle and the
 * socket without any cross-origin hop; the Tauri shell still crosses origins,
 * which is what the CORS header below is for.
 *
 * socket.io re-registers this listener behind its own, so requests on its
 * path never reach here.
 */
function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  // The Tauri webview reaches the bundle via a cross-origin `import()`, which
  // is a CORS-checked fetch — without this header the module load fails
  // opaquely.
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }

  // Liveness probe for whatever supervises the process — systemd, a container
  // orchestrator, a load balancer. Answered before any routing so it stays
  // true even with no frontend built.
  if (pathname === "/healthz") {
    const body = JSON.stringify({ status: "ok", uptime: Math.round(process.uptime()) });
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(req.method === "HEAD" ? undefined : body);
    return;
  }

  // Route to a root first, then resolve within it — so the traversal check
  // below runs against whichever root actually serves the request, and
  // neither can be reached from the other's prefix.
  const [root, relative] =
    pathname === CLIENT_PREFIX || pathname.startsWith(CLIENT_PREFIX + "/")
      ? [CLIENT_DIST_DIR, pathname.slice(CLIENT_PREFIX.length) || "/"]
      : [SHELL_DIST_DIR, pathname];

  if (root === SHELL_DIST_DIR) {
    res.setHeader("Content-Security-Policy", BROWSER_CSP);
  }

  // The browser entry is the root document; index.html is Tauri's, and is
  // never what a browser should get here.
  const requested = relative === "/" ? "/web.html" : relative;

  // normalize collapses `..` before the prefix check, so an encoded
  // traversal can't escape the root into the rest of the checkout.
  const filePath = resolve(root, `.${normalize(requested)}`);
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }

  stat(filePath)
    .then((stats) => {
      if (!stats.isFile()) {
        res.writeHead(404).end();
        return;
      }
      const revalidate = root === CLIENT_DIST_DIR && requested === "/index.js";
      const etag = `W/\"${stats.size}-${Math.trunc(stats.mtimeMs)}\"`;
      const headers = revalidate ? { "Cache-Control": "no-cache", ETag: etag } : {};
      if (revalidate && matchesEtag(req.headers["if-none-match"], etag)) {
        res.writeHead(304, headers).end();
        return;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, {
          ...headers,
          "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
          "Content-Length": stats.size,
        }).end();
        return;
      }
      const stream = createReadStream(filePath);
      stream.once("open", () => {
        res.writeHead(200, {
          ...headers,
          "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
          "Content-Length": stats.size,
        });
        stream.pipe(res);
      });
      stream.once("error", () => {
        if (res.headersSent) res.destroy();
        else res.writeHead(404).end();
      });
    })
    .catch(() => {
      res.writeHead(404).end();
    });
}
