import type {
  PublishHandler,
  Registry,
  Result,
  SnapshotProvider,
} from "@trellis/sdk/realtime";

/**
 * Implementation of the SDK's `Registry` contract. The contract itself lives
 * in @trellis/sdk/realtime so apps/client/server can name it — apps/server
 * depends on apps/client, not the reverse.
 */

/** Broadcasts a payload to everyone joined to `channelName`. */
export type Broadcast = (channelName: string, payload: unknown) => void;

export interface RegistryHandle extends Registry {
  /** Untyped broadcast, for the client app's channelBridge. */
  publishRaw(channelName: string, payload: unknown): void;
  getSnapshotProvider(family: string): SnapshotProvider | undefined;
  getPublishHandler(family: string): PublishHandler | undefined;
}

export function createRegistry(broadcast: Broadcast): RegistryHandle {
  const snapshots = new Map<string, SnapshotProvider>();
  const publishers = new Map<string, PublishHandler>();

  const claim = <T>(map: Map<string, T>, key: string, value: T, kind: string) => {
    if (map.has(key)) throw new Error(`[registry] duplicate ${kind} handler for "${key}"`);
    map.set(key, value);
  };

  return {
    onSnapshot: (family, provider) => claim(snapshots, family, provider, "snapshot"),
    onPublish: (family, handler) => claim(publishers, family, handler, "publish"),
    publish: (channel, event) => broadcast(channel.name, event),
    publishRaw: broadcast,
    getSnapshotProvider: (family) => snapshots.get(family),
    getPublishHandler: (family) => publishers.get(family),
  };
}

/**
 * Throw this from a handler to control the `code` the caller sees. A plain
 * Error is fine too — it just gets the generic code for its call site.
 */
export class HandlerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HandlerError";
  }
}

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const fail = (code: string, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});
