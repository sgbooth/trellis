import { useEffect, useState } from "react";
import type { DeviceInfo, IdentityInfo } from "./types";
import type { PluginComponentProps } from "./definePlugin";

/**
 * Starter component for a new client app: identity + device info, both
 * feature-detected off HostContext.
 *
 * Deliberately domain-free. Anything built on a concrete channel (chat,
 * matter, docket) belongs in apps/client, not here — those channels' types
 * live in apps/client/rpcSpec.ts, and importing them from the SDK would
 * invert the sdk → app dependency.
 */
export const TrellisInfo: React.FC<PluginComponentProps> = ({ host }) => {
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);

  useEffect(() => {
    if (!host.identity) return;
    let cancelled = false;
    void host.identity
      .get()
      .then((value) => {
        if (!cancelled) setIdentity(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [host.identity]);

  useEffect(() => {
    if (!host.device) return;
    let cancelled = false;
    void host.device
      .get()
      .then((value) => {
        if (!cancelled) setDevice(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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
