# Trellis shell

`@trellis/shell` is the stable Tauri and React host for Trellis. It owns the
desktop window, constructs the available `HostContext`, and loads the current
client bundle from `apps/server`. User-facing feature work normally belongs in
`apps/client`, not here.

See the repository [README](../../README.md) for setup and deployment, and
[CLAUDE.md](../../CLAUDE.md) for the architecture and contribution rules.

## Development

Run commands from the repository root:

```bash
pnpm dev          # broker, client watcher, and browser shell
pnpm tauri dev    # the same stack in the native Tauri window
pnpm build        # broker and browser/client production bundles
pnpm tauri build  # native application bundle
```

The browser shell runs at `http://localhost:1420`; the broker defaults to
`http://localhost:8787`. Set `VITE_TRELLIS_SERVER_URL` before a native production
build to point the desktop shell at another broker.

## Structure

- `src/main.tsx` and `index.html` are the desktop entry point.
- `src/mainWeb.tsx` and `web.html` are the browser entry point.
- `src/hosts/tauriHost.ts` exposes desktop APIs; `webHost.ts` intentionally
  exposes fewer capabilities.
- `src/pluginLoader.ts` loads `/client/index.js` from the broker.
- `src-tauri/src/lib.rs` registers Rust commands and Tauri plugins.
- `src-tauri/capabilities/` contains Tauri permissions for the main window.

## Security and configuration

The dynamically loaded client is trusted at the same level as this shell and
receives the complete host context available for its entry point. Keep Tauri
capabilities narrow and expose typed operations instead of raw shell access.

Production and development CSPs live in `src-tauri/tauri.conf.json`. When a fork
changes `VITE_TRELLIS_SERVER_URL`, update the CSP's matching HTTPS and WSS broker
origins too. The browser shell receives its same-origin CSP from `apps/server`.

Window size and position are restored by `tauri-plugin-window-state`; external
paths are opened through `tauri-plugin-opener`.
