import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HostContext } from "@trellis/sdk";
import { channelForTarget } from "#channelSpec";
import type { PeerMessage, PeerSignal, PeerTarget } from "#rpcSpec";
import { rpc } from "./rpc.js";

/**
 * Client-to-client messaging, in one place.
 *
 * The audience is a parameter, not a shape: `{ kind: "all" }` reaches every
 * connected client, `{ kind: "room", roomId }` reaches one room. Both resolve
 * through `channelForTarget`, so switching a component from broadcast to a
 * room is a change to that value and nothing else — no new subscription code,
 * no new handler, no new channel family.
 *
 * Two send paths, matching the two kinds of traffic:
 *
 * - `send(text)` is durable. It goes over `rpc.peer.send` because the server
 *   must stamp an id, sender and timestamp, and the caller needs them back.
 * - `signal(kind)` is ephemeral (typing, presence). It goes over channel
 *   publish — fire-and-forget, nothing for the server to answer, nothing
 *   stored. Signals are dropped if the socket is down; messages are not.
 */

export type PeerConnectionState = "connecting" | "ready" | "failed";

export interface UsePeersResult {
  /** Durable messages: the snapshot for this audience, then live arrivals. */
  messages: PeerMessage[];
  /** The most recent ephemeral signal from someone else, if any. */
  lastSignal: PeerSignal | null;
  state: PeerConnectionState;
  error: string | null;
  send(text: string): Promise<void>;
  signal(kind: PeerSignal["kind"]): void;
}

/** Stable key for a target, so effects re-run when the audience changes and
 *  not when the caller happens to rebuild the object literal. */
export const targetKey = (target: PeerTarget): string => channelForTarget(target).name;

export function usePeers(host: HostContext, target: PeerTarget, self?: string): UsePeersResult {
  const [messages, setMessages] = useState<PeerMessage[]>([]);
  const [lastSignal, setLastSignal] = useState<PeerSignal | null>(null);
  const [state, setState] = useState<PeerConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);

  const key = targetKey(target);
  // Depend on the key rather than the object, so a caller passing an inline
  // `{ kind: "all" }` doesn't resubscribe on every render. The exhaustive-deps
  // rule would want `target` here; keying on its identity is the whole point,
  // so it is deliberately omitted.
  const resolved = useMemo(() => target, [key]);

  /** Merge by id so the send response and the echoed broadcast can't double up. */
  const merge = useCallback((incoming: PeerMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const message of incoming) byId.set(message.id, message);
      return [...byId.values()].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    });
  }, []);

  // Held so `signal()` can publish without re-rendering when the subscription
  // is replaced, and so a stale audience can't be published into.
  const publishRef = useRef<((signal: PeerSignal) => void) | null>(null);

  useEffect(() => {
    const realtime = host.realtime;
    if (!realtime) {
      setState("failed");
      setError("no realtime transport on this host");
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // Switching audience means starting clean — the previous audience's
    // history is not this one's.
    setMessages([]);
    setLastSignal(null);
    setState("connecting");
    setError(null);

    const channel = channelForTarget(resolved);

    void (async () => {
      try {
        const subscription = await realtime.subscribe(
          channel,
          (event) => {
            if (event.type === "message") merge([event.message]);
            // Your own signals come back too (you're in the room); showing
            // "you are typing" to yourself is noise, so drop them.
            else if (event.signal.from !== self) setLastSignal(event.signal);
          },
          // Durable messages missed during a disconnect come back only in a
          // fresh snapshot. Signals deliberately do not — they are ephemeral,
          // and a stale "typing" replayed on reconnect would be wrong.
          { onResync: merge },
        );

        if (cancelled) {
          subscription.unsubscribe();
          return;
        }
        unsubscribe = subscription.unsubscribe;
        publishRef.current = (signal) => void realtime.publish(channel, { type: "signal", signal });
        // The snapshot arrives in the same round trip that joined the room,
        // so nothing sent in between is missed.
        merge(subscription.snapshot);
        setState("ready");
      } catch (cause) {
        if (cancelled) return;
        setState("failed");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      cancelled = true;
      publishRef.current = null;
      unsubscribe?.();
    };
  }, [host.realtime, resolved, merge, self]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      // Rendered from the response rather than waiting for the broadcast, so
      // a sender sees its own message even if delivery lags.
      merge([await rpc.peer.send({ target: resolved, text })]);
    },
    [resolved, merge],
  );

  const signal = useCallback((kind: PeerSignal["kind"]) => {
    // Fire-and-forget by design: a dropped signal is not worth surfacing, and
    // `self` is overwritten server-side anyway.
    publishRef.current?.({ kind, from: self ?? "" });
  }, [self]);

  return { messages, lastSignal, state, error, send, signal };
}
