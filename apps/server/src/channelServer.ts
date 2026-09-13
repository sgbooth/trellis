import type { Namespace, Socket } from "socket.io";
import { parseChannel } from "@trellis/sdk/realtime";
import type {
  ClientToServerEvents,
  ErasedChannelHandlers,
  HandlerContext,
  ServerToClientEvents,
  SocketData,
} from "@trellis/sdk/realtime";

/**
 * Mounts a family → handlers map onto a socket.io namespace as room
 * membership plus server→client push. Counterpart to mountRpc: the broker
 * owns the socket, the rooms and the wire protocol; apps/client owns what
 * the channels mean.
 *
 * Handlers are looked up by family from the map the app composes — there is
 * no registration call to forget, the same way an RPC method is reached by
 * name rather than by a `registerMethod()`.
 */

type TrellisSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type TrellisNamespace = Namespace<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function safeAck(ack: unknown): (result: unknown) => void {
  return typeof ack === "function" ? (ack as (result: unknown) => void) : () => {};
}

const MAX_CHANNEL_NAME_LENGTH = 256;
const INVALID_CHANNEL_MESSAGE = `channel name must be a non-empty string of at most ${MAX_CHANNEL_NAME_LENGTH} characters`;

function parseWireChannel(value: unknown): { name: string; family: string; id?: string } | null {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_CHANNEL_NAME_LENGTH) {
    return null;
  }
  const parsed = parseChannel(value);
  return parsed.family.trim().length > 0 ? { name: value, ...parsed } : null;
}

/** Broadcasts a payload to everyone joined to `channelName`. */
export type Broadcast = (channelName: string, payload: unknown) => void;

/**
 * Decides whether this socket may touch this channel at all. Passed in
 * rather than defaulted here so the broker has exactly one implementation,
 * living next to the SECURITY note that explains it.
 */
export type AuthorizeChannel = (socket: TrellisSocket, channelName: string) => boolean;

function toFailure(code: string, cause: unknown) {
  return {
    ok: false as const,
    error: { code, message: cause instanceof Error ? cause.message : String(cause) },
  };
}

/**
 * Returns the broadcast function, which the app hands to the client's
 * channelBridge so handlers can fan out without holding a socket.
 */
export function mountChannels(
  namespace: TrellisNamespace,
  handlers: Record<string, ErasedChannelHandlers>,
  authorize: AuthorizeChannel,
): Broadcast {
  const broadcast: Broadcast = (channelName, payload) => {
    namespace.to(channelName).emit("event", channelName, payload);
  };

  namespace.on("connection", (socket: TrellisSocket) => {
    socket.on("subscribe", async (channelName, ack) => {
      const reply = safeAck(ack);
      const channel = parseWireChannel(channelName);
      if (!channel) {
        reply(toFailure("INVALID_CHANNEL", INVALID_CHANNEL_MESSAGE));
        return;
      }
      if (!authorize(socket, channel.name)) {
        reply({ ok: false, error: { code: "FORBIDDEN", message: `not authorized for ${channel.name}` } });
        return;
      }
      try {
        const snapshot =
          (await handlers[channel.family]?.snapshot?.({
            channel: channel.name,
            family: channel.family,
            id: channel.id,
            identity: socket.data.identity,
          })) ?? null;
        // Join only after the snapshot resolves, so a client can't miss an
        // event published between joining and receiving its initial state.
        await socket.join(channel.name);
        reply({ ok: true, data: snapshot });
      } catch (cause) {
        reply(toFailure("SNAPSHOT_FAILED", cause));
      }
    });

    socket.on("unsubscribe", async (channelName, ack) => {
      const reply = safeAck(ack);
      const channel = parseWireChannel(channelName);
      if (!channel) {
        reply(toFailure("INVALID_CHANNEL", INVALID_CHANNEL_MESSAGE));
        return;
      }
      try {
        await socket.leave(channel.name);
        reply({ ok: true, data: undefined });
      } catch (cause) {
        reply(toFailure("UNSUBSCRIBE_FAILED", cause));
      }
    });

    socket.on("publish", async (channelName, event, ack) => {
      const reply = safeAck(ack);
      const channel = parseWireChannel(channelName);
      if (!channel) {
        reply(toFailure("INVALID_CHANNEL", INVALID_CHANNEL_MESSAGE));
        return;
      }
      // Publishing into a room you were never authorized to join would be a
      // trivial bypass of the subscribe check, so it's gated the same way.
      if (!authorize(socket, channel.name)) {
        reply({ ok: false, error: { code: "FORBIDDEN", message: `not authorized for ${channel.name}` } });
        return;
      }
      const publish = handlers[channel.family]?.publish;
      if (!publish) {
        reply({ ok: false, error: { code: "NO_HANDLER", message: `no publish handler for ${channel.family}` } });
        return;
      }
      try {
        // The event is `unknown` off the wire; the handler declares its real
        // shape. This is the one place that gap is crossed on this side.
        const invoke = publish as (ctx: HandlerContext, event: unknown) => void | Promise<void>;
        await invoke(
          { channel: channel.name, family: channel.family, id: channel.id, identity: socket.data.identity },
          event,
        );
        reply({ ok: true, data: undefined });
      } catch (cause) {
        reply(toFailure("PUBLISH_FAILED", cause));
      }
    });
  });

  // Names the surface at startup, like mountRpc — so a family whose handler
  // file was never spread in is visible in the log, not only on first use.
  const summary = Object.entries(handlers)
    .map(([family, h]) => `${family}(${[h.snapshot && "snapshot", h.publish && "publish"].filter(Boolean).join("+") || "push-only"})`)
    .join(", ");
  console.log(`[channels] mounted ${Object.keys(handlers).length} families: ${summary}`);

  return broadcast;
}
