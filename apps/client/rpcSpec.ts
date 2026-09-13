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

/**
 * Who a peer message reaches. `all` is every connected client; `room` narrows
 * to one. These are the only two cases today — a component starts on `all`
 * and moves to a room by changing this one value, nothing else.
 *
 * Adding a target means a case here plus a case in `channelForTarget` in
 * channelSpec.ts. Both are exhaustive `switch`es, so neither compiles until
 * the other is updated.
 */
export type PeerTarget = { kind: "all" } | { kind: "room"; roomId: string };

/**
 * A durable peer message. Sent via `rpc.peer.send` rather than a channel
 * publish precisely because the server has to stamp `id`/`from`/`ts` — the
 * rule from CLAUDE.md's channels section.
 */
export type PeerMessage = {
  id: string;
  from: string;
  text: string;
  ts: number;
  /** Echoed back so a receiver can tell how widely a message was sent. */
  target: PeerTarget;
};

/**
 * An ephemeral peer signal — not stored, not replayed in a snapshot, no id.
 * This is the traffic channel `publish` exists for: high-frequency, and the
 * server has nothing to answer. `from` is overwritten server-side, so a
 * client cannot sign a signal as someone else.
 */
export type PeerSignal = { kind: "typing" | "here"; from: string };

export type WeatherReading = {
  place: string;
  temperatureC: number;
  windSpeedKph: number;
  /** WMO weather code — see describeWeather() in the client component. */
  code: number;
  isDay: boolean;
  /** Provider's observation time, ISO 8601, in the location's own timezone. */
  observedAt: string;
};

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

  //! peer
  "peer.send": {
    params: {} as { target: PeerTarget; text: string },
    result: {} as PeerMessage,
  },

  //! weather
  "weather.current": {
    params: {} as { latitude: number; longitude: number; place: string },
    result: {} as WeatherReading,
  },
};
