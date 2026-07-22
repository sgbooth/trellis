import { useEffect, useState } from "react";
import type { ChatMessage, DeviceInfo, IdentityInfo } from "./types";
import type { PluginComponentProps } from "./definePlugin";

export const TrellisInfo: React.FC<PluginComponentProps> = ({ host }) => {
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!host.identity) return;
    host.identity.get().then(setIdentity);
  }, [host.identity]);

  useEffect(() => {
    if (!host.device) return;
    host.device.get().then(setDevice);
  }, [host.device]);

  useEffect(() => {
    if (!host.chat) return;
    return host.chat.onMessage((message) => {
      setMessages((prev) => [...prev, message]);
    });
  }, [host.chat]);

  return (
    <div>
      <h2>Trellis Info!</h2>
      <p>Signed in as: {identity ? `${identity.displayName} (${identity.username})` : "loading…"}</p>

      <h3>Device</h3>
      {!host.device ? (
        <p>This plugin requires the device:info capability, which was not granted.</p>
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

      {host.chat && (
        <>
          <h3>Chat</h3>
          <ul>
            {messages.map((message, i) => (
              <li key={i}>
                <strong>{message.from}:</strong> {message.text}
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              host.chat!.send(text);
              setText("");
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" />
            <button type="submit">Send</button>
          </form>
        </>
      )}
    </div>
  );
};
