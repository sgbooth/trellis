import { definePlugin, TrellisInfo } from "@trellis/sdk";
import type { PluginComponentProps } from "@trellis/sdk";
import { ChatPanel } from "./ChatPanel";
import { PeerPanel } from "./PeerPanel";
import { WeatherPanel } from "./WeatherPanel";
import { initRpc } from "./rpc.js";

// TrellisInfo is the SDK's domain-free starter (identity + device); anything
// built on this deployment's own channels belongs here instead.
const Component: React.FC<PluginComponentProps> = ({ host }) => {
  // Arms the `rpc` singleton before anything can call it. Synchronous and
  // idempotent, so it's safe to run during render rather than in an effect.
  initRpc(host);
  return (
    <>
      <TrellisInfo host={host} />
      <ChatPanel host={host} />
      <PeerPanel host={host} />
      <WeatherPanel host={host} />
    </>
  );
};

export default definePlugin({ Component });
