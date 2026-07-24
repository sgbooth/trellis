export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** semver range this plugin was built against */
  sdkVersion: string;
  entry: string;
}

export interface FileEntry {
  path: string;
  isDirectory: boolean;
}

export interface FilesApi {
  read?(path: string): Promise<string>;
  write?(path: string, contents: string): Promise<void>;
  watch?(path: string, onChange: (event: { path: string }) => void): () => void;
  /**
   * Fires once when `path` is closed by a process that had it open for
   * writing — a distinct system-level concern from `watch`'s content-change
   * events, backed by a different (and on some platforms more privileged)
   * mechanism per OS. See apps/shell/src-tauri/src/close_watch.rs.
   */
  onClosed?(path: string, callback: () => void): () => void;
  openDialog?(options?: { multiple?: boolean; directory?: boolean }): Promise<string[]>;
  /** Opens a path with the OS default app (or `openWith` if given). Real,
   * Tauri-opener-backed implementation — unlike the rest of FilesApi. */
  open?(path: string, openWith?: string): Promise<void>;
}

export interface ClipboardApi {
  read?(): Promise<string>;
  write?(text: string): Promise<void>;
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

export type LlmEvent =
  | { type: "chunk"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Streaming relay to an LLM provider call. Not yet implemented — no backend
 * exists. When built, this should be a direct Tauri Rust command (see
 * close_watch.rs for the precedent of Rust doing real OS/network work
 * directly), not a broker call — there is no broker in this architecture.
 * Chunk-streamed rather than buffer-then-return so a real implementation
 * doesn't double perceived latency.
 */
export interface LlmApi {
  invoke(prompt: string, onEvent: (event: LlmEvent) => void, options?: { maxTokens?: number }): () => void;
}

export interface EmailMessage {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
}

/**
 * Send-only relay to a mail transport (SMTP or similar — backend TBD). Not
 * yet implemented — no backend exists. When built, this should be a direct
 * Tauri Rust command, not a broker call. Kept as its own interface rather
 * than folded into a generic "network" API because SMTP isn't HTTP and the
 * call shape (fire-and-forget send to arbitrary recipients) doesn't match
 * a fetch-style API.
 */
export interface EmailApi {
  send(message: EmailMessage): Promise<void>;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  attendees: string[];
  location?: string;
}

/**
 * Calendar access (Exchange/Graph/CalDAV — backend TBD). Not yet
 * implemented — no backend exists; would be a direct Tauri Rust command
 * when built. Split into `list`/`create` because they're different
 * operations (a query vs. sending a real invite to real people), not
 * because of any access-control distinction.
 */
export interface CalendarApi {
  list?(range: { start: string; end: string }): Promise<CalendarEvent[]>;
  create?(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent>;
}

export interface ContactInfo {
  name: string;
  email: string;
  department?: string;
}

/**
 * Corporate directory/address-book lookup (backend TBD — e.g.
 * LDAP/Graph/CardDAV). Not yet implemented — no backend exists; would be a
 * direct Tauri Rust command when built. Read-only for now: writing to a
 * shared corporate directory isn't a use case this models yet.
 */
export interface ContactsApi {
  search(query: string): Promise<ContactInfo[]>;
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
 * Fields are optional because not every host API is wired up yet (e.g.
 * `secrets`, `camera`, `llm` have no real implementation behind them) — not
 * because of any per-plugin grant. Plugins should feature-detect via
 * `if (host.device)` rather than assume a field exists.
 */
export interface HostContext {
  files?: FilesApi;
  clipboard?: ClipboardApi;
  secrets?: SecretsApi;
  identity?: IdentityApi;
  llm?: LlmApi;
  email?: EmailApi;
  calendar?: CalendarApi;
  contacts?: ContactsApi;
  device?: DeviceApi;
  camera?: CameraApi;
  microphone?: MicrophoneApi;
  notifications?: NotificationsApi;
}
