import { useEffect, useState } from "react";
import type { DeviceInfo, IdentityInfo } from "./types";
import type { PluginComponentProps } from "./definePlugin";

export const TrellisInfo: React.FC<PluginComponentProps> = ({ host }) => {
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);

  useEffect(() => {
    if (!host.identity) return;
    host.identity.get().then(setIdentity);
  }, [host.identity]);

  useEffect(() => {
    if (!host.device) return;
    host.device.get().then(setDevice);
  }, [host.device]);

  return (
    <div>
      <h2>Trellis Info!</h2>
      <p>Signed in as: {identity ? `${identity.displayName} (${identity.username})` : "loading…"}</p>

      <h3>Device</h3>
      {!host.device ? (
        <p>Device info isn't available.</p>
      ) : !device ? (
        <p>loading device info…</p>
      ) : (
        <ul>
          <li>
            <strong>Device name:</strong> {device.deviceName}
          </li>
          <li>
            <strong>Hostname:</strong> {device.hostname}
          </li>
          <li>
            <strong>Platform:</strong> {device.platform}
          </li>
          <li>
            <strong>Distro:</strong> {device.distro}
          </li>
          <li>
            <strong>Architecture:</strong> {device.arch}
          </li>
          <li>
            <strong>Desktop environment:</strong> {device.desktopEnv}
          </li>
        </ul>
      )}
    </div>
  );
};
