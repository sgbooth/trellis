import { useEffect, useMemo, useState } from "react";
import type { PluginComponentProps } from "@trellis/sdk";
import type { PeerTarget } from "#rpcSpec";
import { usePeers } from "./peers.js";

/**
 * Exercises client-to-client messaging across the two audiences.
 *
 * The audience toggle is the point of the component: `usePeers` takes a
 * target, so moving between "everyone" and a named room changes one value and
 * nothing else. Open two clients (a desktop shell and a browser tab will do)
 * and they see each other's messages when — and only when — their audiences
 * match.
 */
export const PeerPanel: React.FC<PluginComponentProps> = ({ host }) => {
  const [scope, setScope] = useState<"all" | "room">("all");
  const [roomId, setRoomId] = useState("eng");
  const [text, setText] = useState("");
  const [self, setSelf] = useState<string | undefined>();
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    host.identity?.get().then((i) => setSelf(i.username)).catch(() => setSelf(undefined));
  }, [host.identity]);

  // The whole all-vs-room switch, in one value.
  const target = useMemo<PeerTarget>(
    () => (scope === "all" ? { kind: "all" } : { kind: "room", roomId: roomId.trim() || "eng" }),
    [scope, roomId],
  );

  const { messages, lastSignal, state, error, send, signal } = usePeers(host, target, self);

  if (!host.realtime) return null;

  return (
    <section>
      <h3>Peers</h3>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
        <label>
          <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> Everyone
        </label>
        <label>
          <input type="radio" checked={scope === "room"} onChange={() => setScope("room")} /> Room
        </label>
        <input
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          disabled={scope !== "room"}
          aria-label="Room id"
          style={{ width: "8rem" }}
        />
        <span aria-live="polite">
          {state === "ready" ? "connected" : state === "connecting" ? "connecting…" : "failed"}
        </span>
      </div>

      {error && <p role="alert">Subscription failed: {error}</p>}
      {sendError && <p role="alert">Send failed: {sendError}</p>}

      <ul>
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.from}</strong>
            {/* Shows how widely the sender aimed it, which is the thing this
                panel exists to make visible. */}
            <em> → {m.target.kind === "all" ? "everyone" : `room ${m.target.roomId}`}</em>: {m.text}
          </li>
        ))}
      </ul>

      {/* The ephemeral half: published, never stored, gone on next render. */}
      <p aria-live="polite" style={{ minHeight: "1.2em", opacity: 0.7 }}>
        {lastSignal ? `${lastSignal.from} is ${lastSignal.kind === "typing" ? "typing…" : "here"}` : ""}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const pending = text.trim();
          if (!pending) return;
          setText("");
          setSendError(null);
          send(pending).catch((cause: unknown) => {
            setSendError(cause instanceof Error ? cause.message : String(cause));
            setText(pending); // don't lose what they typed
          });
        }}
      >
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            signal("typing");
          }}
          placeholder={scope === "all" ? "Message everyone…" : `Message room ${roomId}…`}
          disabled={state !== "ready"}
        />
        <button type="submit" disabled={state !== "ready" || !text.trim()}>
          Send
        </button>
        <button type="button" onClick={() => signal("here")} disabled={state !== "ready"}>
          Wave
        </button>
      </form>
    </section>
  );
};
