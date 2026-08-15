import type { RealtimeApi } from "./realtime.js";

export type Capability =
  | "files:read"
  | "files:write"
  | "files:watch"
  | "files:open-dialog"
  | "files:open-file"
  | "network:fetch"
  | "llm:invoke"
  | "clipboard:read"
  | "clipboard:write"
  | "database:query"
  | "secrets:read"
  | "secrets:write"
  | "media:camera"
  | "media:microphone"
  | "notifications:send"
  | "custom:invoke"
  | "identity:read"
  /**
   * Join broker channels and receive their events; and publish into them.
   * Split read/write like `clipboard:*` and `secrets:*` — receiving is a
   * lower-trust act than writing into a room other people are watching.
   *
   * Deliberately coarse: *which* rooms (`matter/{id}`, `chat/{id}`) is not
   * expressible here, and mustn't become manifest syntax — that would put an
   * app-specific business concept into the capability vocabulary, the same
   * mistake that got `workflow:read` cut. Room-level restriction belongs in
   * Tauri's own capabilities/*.json plus the broker's authorizeSubscribe.
   */
  | "realtime:subscribe"
  | "realtime:publish"
  | "device:info";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** semver range this plugin was built against */
  sdkVersion: string;
  entry: string;
  capabilities: Capability[];
  /** ed25519 signature over hash(manifest + entry file); absent in Phase 1/2 (unsigned) */
  signature?: string;
}

export interface FileEntry {
  path: string;
  isDirectory: boolean;
}

export interface FilesApi {
  read?(path: string): Promise<string>;
  write?(path: string, contents: string): Promise<void>;
  watch?(path: string, onChange: (event: { path: string }) => void): () => void;
  openDialog?(options?: { multiple?: boolean; directory?: boolean }): Promise<string[]>;
  /** Opens a path with the OS default app (or `openWith` if given). Real,
   * Tauri-opener-backed implementation — unlike the rest of FilesApi. */
  open?(path: string, openWith?: string): Promise<void>;
}

export interface LlmApi {
  invoke(prompt: string, options?: { maxTokens?: number }): Promise<string>;
}

export interface ClipboardApi {
  read?(): Promise<string>;
  write?(text: string): Promise<void>;
}

/**
 * Local database access (tauri-plugin-sql). A system-level resource like
 * files/network/clipboard, not yet wired to a real Tauri plugin.
 */
export interface DatabaseApi {
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
}

/**
 * Encrypted local secret storage (tauri-plugin-stronghold) — e.g. storing
 * tokens granted by a connector or LLM auth flow. Split read/write like
 * ClipboardApi/FilesApi: read is higher trust than write.
 */
export interface SecretsApi {
  read?(key: string): Promise<string | null>;
  write?(key: string, value: string): Promise<void>;
}

/**
 * OS-level logged-in user identity. Audit-trail use only — NOT a security
 * or auth signal. The value is whatever the local OS reports for the
 * current session and is trivially spoofable by anyone with shell access
 * to the machine; don't gate any authorization decision on it.
 */
export interface IdentityInfo {
  username: string;
  displayName: string;
}

export interface IdentityApi {
  get(): Promise<IdentityInfo>;
}

/**
 * OS/device info for the machine the shell is running on — hostname,
 * platform, architecture, etc. Purely informational (demonstrates the
 * shell's userspace access), not a security signal — same audit-only
 * spirit as IdentityInfo, just about the device rather than the user.
 */
export interface DeviceInfo {
  deviceName: string;
  hostname: string;
  platform: string;
  distro: string;
  arch: string;
  desktopEnv: string;
}

export interface DeviceApi {
  get(): Promise<DeviceInfo>;
}

/**
 * Camera capture. Likely resolves to the webview's standard getUserMedia()
 * plus an OS permission prompt rather than a dedicated Tauri plugin —
 * unverified, not yet wired.
 */
export interface CameraApi {
  capture(): Promise<string>; // data URL
}

/** Same caveats as CameraApi — not yet wired. */
export interface MicrophoneApi {
  record(): Promise<string>; // data URL
}

/**
 * OS desktop notifications (toast/banner via the system notification
 * center). Needs @tauri-apps/plugin-notification, not yet a dependency.
 */
export interface NotificationsApi {
  send(title: string, body?: string): Promise<void>;
}

/**
 * Capabilities the plugin didn't declare (or wasn't granted) are omitted
 * entirely, not present-but-throwing — plugins should feature-detect via
 * `if (host.realtime)` rather than try/catch.
 */
export interface HostContext {
  files?: FilesApi;
  llm?: LlmApi;
  clipboard?: ClipboardApi;
  database?: DatabaseApi;
  secrets?: SecretsApi;
  identity?: IdentityApi;
  realtime?: RealtimeApi;
  device?: DeviceApi;
  camera?: CameraApi;
  microphone?: MicrophoneApi;
  notifications?: NotificationsApi;
}
