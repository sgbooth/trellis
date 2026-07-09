export type Capability =
  | "files:read"
  | "files:write"
  | "files:watch"
  | "files:open-dialog"
  | "connector:invoke"
  | "network:fetch"
  | "llm:invoke"
  | "clipboard:read"
  | "clipboard:write"
  | "workflow:read"
  | "workflow:transition"
  | "custom:invoke";

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
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  watch(path: string, onChange: (event: { path: string }) => void): () => void;
  openDialog(options?: { multiple?: boolean; directory?: boolean }): Promise<string[]>;
}

export interface WorkflowState {
  currentNodeId: string;
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

export interface WorkflowApi {
  getState(): Promise<WorkflowState>;
  transition(toNodeId: string): Promise<void>;
  onChange(listener: (state: WorkflowState) => void): () => void;
}

export interface LlmApi {
  invoke(prompt: string, options?: { maxTokens?: number }): Promise<string>;
}

export interface ClipboardApi {
  read?(): Promise<string>;
  write?(text: string): Promise<void>;
}

export interface ConnectorApi {
  invoke(connectorId: string, action: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Capabilities the plugin didn't declare (or wasn't granted) are omitted
 * entirely, not present-but-throwing — plugins should feature-detect via
 * `if (host.workflow)` rather than try/catch.
 */
export interface HostContext {
  files?: FilesApi;
  workflow?: WorkflowApi;
  llm?: LlmApi;
  clipboard?: ClipboardApi;
  connector?: ConnectorApi;
}
