import { useCallback, useEffect, useState } from "react";
import type { PluginComponentProps } from "@trellis/sdk";
import { channels } from "#channelSpec";
import { rpc } from "./rpc.js";
import type { ChatMessage } from "#rpcSpec";

// One hardcoded room for now — room selection is UI work, not transport work.
const ROOM_ID = "general";

/**
 * Chat lives here rather than in the SDK's TrellisInfo because it's built on
 * this deployment's own methods, and the SDK must stay domain-free.
 *
 * Sending is RPC (`rpc.chat.send`) — depending on the broadcast to display
 * your own sent message is what made this look broken.
 *
 * History comes from the subscribe ack's snapshot, not a separate
 * `rpc.chat.history` call, because the broker joins the room only after the
 * snapshot resolves: fetching history independently leaves a window where a
 * message sent between the fetch and the join is in neither. `rpc.chat.history`
 * remains the fallback for when the subscription itself fails, which degrades
 * this to send-and-refresh rather than breaking it.
 */
export const ChatPanel: React.FC<PluginComponentProps> = ({ host }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  /** Merge by id, so the send response and the echoed push can't double up. */
  const merge = useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const message of incoming) byId.set(message.id, message);
      return [...byId.values()].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    });
  }, []);

  // History and live delivery in one round trip: the snapshot is the state
  // as of the moment this socket joined the room, so nothing falls between.
  useEffect(() => {
    const realtime = host.realtime;
    if (!realtime) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // async IIFE so a synchronous throw from the rpc proxy in the fallback
    // becomes a rejection this catch actually sees.
    void (async () => {
      try {
        const subscription = await realtime.subscribe(
          channels.chat(ROOM_ID),
          (event) => {
            if (event.type === "message") merge([event.message]);
          },
          // A reconnect rejoins the room but cannot replay what was published
          // while the socket was down. The fresh snapshot is the only way back
          // to a correct history, and `merge` is already id-keyed, so
          // reconciling it is the same operation as the initial load.
          { onResync: merge },
        );
        // subscribe() can resolve after unmount; drop it rather than leak.
        if (cancelled) {
          subscription.unsubscribe();
          return;
        }
        unsubscribe = subscription.unsubscribe;
        merge(subscription.snapshot);
      } catch (cause) {
        if (cancelled) return;
        // Live updates are gone, but the panel is still usable for the local
        // user — so fall back to a plain history fetch and say so.
        setLiveError(describe(cause));
        try {
          const history = await rpc.chat.history({ roomId: ROOM_ID });
          if (!cancelled) merge(history);
        } catch (historyCause) {
          if (!cancelled) setError(describe(historyCause));
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [host.realtime, merge]);

  async function send(): Promise<void> {
    const pending = text.trim();
    if (!pending || sending) return;

    setSending(true);
    setError(null);
    setText("");
    try {
      // Render from the response rather than waiting for the broadcast —
      // the message is confirmed the moment this resolves.
      merge([await rpc.chat.send({ roomId: ROOM_ID, text: pending })]);
    } catch (cause) {
      setError(describe(cause));
      setText(pending); // don't lose what they typed
    } finally {
      setSending(false);
    }
  }

  if (!host.realtime) return null;

  return (
    <>
      <h3>Chat</h3>
      {error && <p role="alert">Send failed: {error}</p>}
      {liveError && <p role="status">Live updates unavailable ({liveError}) — messages you send still work.</p>}
      <ul>
        {messages.map((message) => (
          <li key={message.id}>
            <strong>{message.from}:</strong> {message.text}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          disabled={sending}
        />
        <button type="submit" disabled={sending || !text.trim()}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </>
  );
};

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
