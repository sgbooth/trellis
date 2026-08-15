export type {
  PluginManifest,
  FileEntry,
  FilesApi,
  ClipboardApi,
  SecretsApi,
  IdentityInfo,
  IdentityApi,
  LlmEvent,
  LlmApi,
  EmailMessage,
  EmailApi,
  CalendarEvent,
  CalendarApi,
  ContactInfo,
  ContactsApi,
  DeviceInfo,
  DeviceApi,
  CameraApi,
  MicrophoneApi,
  NotificationsApi,
  HostContext,
} from "./types";
// Also available React-free as `@trellis/sdk/realtime`, which is how the
// broker (Node) and apps/client/rpcSpec.ts must import them.
export type {
  Channel,
  ParsedChannel,
  Subscription,
  RealtimeApi,
  HandlerContext,
  SnapshotProvider,
  PublishHandler,
  Registry,
  Result,
  WireError,
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "./realtime";
export { channel, parseChannel, asRegistry, SOCKET_NAMESPACE } from "./realtime";
// Also available React-free as `@trellis/sdk/rpc`.
export type {
  RpcSpec,
  RpcContext,
  RpcClient,
  RpcInvoke,
  HandlerMap,
  HandlersFor,
  MethodKeysOf,
  ParamsFor,
  ResultFor,
} from "./rpc";
export { createRpcClient } from "./rpc";
export { definePlugin } from "./definePlugin";
export type { PluginComponentProps, PluginModule } from "./definePlugin";
export { TrellisInfo } from "./TrellisInfo";
