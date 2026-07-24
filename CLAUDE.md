# CLAUDE.md

Guidance for agentic (Claude Code) development in this repo. See [README.md](README.md) for the full product/architecture writeup — this file is the condensed operating manual for making changes here correctly.

## What this is

Trellis is a **bare scaffold for experimenting with building features in Tauri**, not a finished product shell. It's a Tauri desktop shell that dynamically loads a bespoke client app, fetched at runtime from [apps/server](apps/server), so a new feature ships by rebuilding `apps/client`, pushing the new build to the server, and reloading — no shell reinstall required. `apps/shell` and `apps/client` are built by the same team at the same trust level, so the client gets the full `HostContext` the shell can construct, unscoped — there's no capability-grant/sandboxing layer between them. Dynamic loading exists purely for deploy velocity, not as a trust boundary. New user-facing functionality should almost always be built in **`apps/client`**, not a shell or server change.

The intended lifecycle: prototype a feature idea quickly here, in `apps/client`, with low ceremony. Once it proves itself and becomes something people actually depend on, it's expected to **graduate out into its own standalone Tauri app** — its own shell, its own release cycle, and real authentication if it needs one. Don't build this scaffold toward becoming that end state (e.g. don't add code signing, real auth, or a capability-review system here) — that would defeat the point of keeping it a fast, disposable place to experiment before committing to a real app.

```
apps/shell/          the Tauri host — Rust IPC layer + React chrome
apps/server/          minimal FeatherJS app: serves apps/client's built
                      bundle as static files (the actual distribution
                      mechanism) and a shared identity/audit service; the
                      slot for future global/shared features (broadcast,
                      chat) and any server-owned endpoint the client app
                      needs
apps/client/          the bespoke client app for this deployment — the one
                      thing that actually changes when a team builds their
                      feature; owns its client UI and (optionally) its
                      server-owned endpoint, mounted into apps/server
sdk/                  shared contract: PluginManifest, HostContext,
                      definePlugin — also exports reusable UI components a new
                      client app can start from (e.g. TrellisInfo), not just types
```

**There's exactly one client app, at a fixed location.** `apps/shell` dynamically loads `@trellis/client`'s built bundle from `apps/server` at runtime — no selection mechanism, no per-checkout config. To build a different app, replace what's in `apps/client`.

## What's implemented vs. not — read this before assuming anything is real

- [App.tsx](apps/shell/src/App.tsx) `React.lazy`-loads the plugin's component from `apps/server`'s `/index.js` (see [app.ts](apps/server/src/app.ts)'s `koa-static` mount) — no static import, so a new `apps/client` build is live on next reload without a shell rebuild. See `apps/client/build.mjs` for the esbuild step that produces `dist/index.js`/`dist/manifest.json`.
- **There is no capability-grant system.** `apps/client` and `apps/shell` are built by the same team; `App.tsx` hands the plugin the full `HostContext` it can construct, unscoped. `HostContext` fields can still be `undefined` (e.g. `host.secrets`, `host.llm`) but only because that API isn't implemented yet, not because of any per-plugin grant — plugins should still feature-detect (`if (host.device)`) for that reason.
- `FilesApi.read`/`write`/`watch`/`openDialog`, `LlmApi`, `ClipboardApi`, `SecretsApi`, `CameraApi`, `MicrophoneApi`, `NotificationsApi`, `EmailApi`, `CalendarApi`, and `ContactsApi` are all declared in [types.ts](sdk/src/types.ts) but have no real implementation yet — shape exists, plumbing doesn't. `Email`/`Calendar`/`Contacts` are placeholders for an eventual move of business functions (email, calendar, directory lookup) that currently live in separate tools like Outlook into this app. None of these are global/shared state, so none of them belong on `apps/server` (see "Backend" below) — a direct Tauri Rust command is the expected way to build any of them. `FilesApi.open` and `onClosed` (Linux only so far — see [close_watch.rs](apps/shell/src-tauri/src/close_watch.rs)) are real.
- **Scoping parameters (path prefixes, allowed domains, etc.) belong in Tauri's own `capabilities/*.json`.** When a Tauri-plugin-backed API like file access gets implemented for real, its fine-grained restriction (which paths, which domains) is Tauri's own permission/scope system — the same mechanism already granting `opener:default` in [default.json](apps/shell/src-tauri/capabilities/default.json) — not something `PluginManifest` needs to carry.
- **Not done, and not planned**: no plugin registry (still exactly one client app, fixed location), no code-signature verification, no auto-updater. None of these were ever about protecting against a less-trusted plugin author — that was the only reason any of them were on a roadmap, and that roadmap has been retired along with the capability model. Real bundle distribution (as opposed to a dev-time local path) **is** done now — see "Backend" below — that's different from the retired items above; it just happens to be a plain static-file server rather than anything signed/verified.

When asked to "wire up X for the client app," check whether the plumbing exists yet before assuming it does — extend `HostContext`/`sdk/src/types.ts` directly.

## Core invariants to preserve

- **Host API shape lives in `sdk`, not per-plugin.** Adding a new host API means: add its interface to [types.ts](sdk/src/types.ts) (e.g. `FilesApi`), add it to `HostContext`, then wire the shell-side implementation in `apps/shell/src`. Don't let the client app invent its own ad hoc host API or reach past `HostContext` into Tauri/Node APIs directly — not for a trust reason, just so `sdk` stays the one place documenting what the shell exposes.
- **`react`/`react-dom`/`react/jsx-runtime` are externalized**, not bundled per plugin — the host provides them. If you touch plugin build config, don't break this (duplicate React instances silently break hooks).
- Don't add a raw arbitrary-shell-exec host API (a `HostContext.exec(command)` escape hatch) — not because of a trust boundary, but because it's a bad API shape that defeats the point of having a typed `HostContext` at all; model the underlying need as a specific typed operation instead.

## Workflow

- `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm lint` run through turborepo across the workspace (`apps/*`, `sdk`).
- `pnpm tauri` proxies to the shell's Tauri CLI.
- New functionality = edit `apps/client` directly (`workspace:*` dep on `@trellis/sdk`, default-exports `definePlugin({ manifest, Component })`). Add/extend `apps/client/server` too if it needs a server-owned endpoint (see "Backend" below) — but most new `HostContext` APIs won't need this; see the next section for when a server endpoint is actually the right call.

## Backend — global/shared concerns only, not a trust boundary

`apps/client` and `apps/shell` are the same trust level, so [apps/server](apps/server) doesn't exist to keep the webview from holding credentials — there's no "the webview can't be trusted" constraint here. It exists for things that are inherently **global or shared**, which no single client's own Tauri process can be on its own:

- **Serving the client bundle.** `apps/server`'s `koa-static` mount over `apps/client/dist` is the actual distribution mechanism — push a new build to the server and every running shell picks it up on next load. This is real, not a stub.
- **A shared `identity` service** (audit-trail only, unverified — see the SECURITY note in [app.ts](apps/server/src/app.ts)) that a socket-connected client can call once to attach `{ username, displayName }` to its connection for server-side logging.
- **Future broadcast-style features** — chat, notifications, anything that needs a process every connected client can reach. Nothing like this exists yet; FeatherJS was kept specifically because its services/channels model supports adding this without a rewrite when a real need shows up.

**What does *not* belong here:** anything per-request/per-user with no fan-out requirement — `LlmApi`, `EmailApi`, `CalendarApi`, `ContactsApi` calls are not global state, so they should be direct Tauri Rust commands (see `close_watch.rs` for the existing precedent of Rust doing real OS/network work), not routed through this server. Before adding something to `apps/server`, ask whether it's actually shared/global — if not, it's a Tauri command instead.

- **The client app owns its own server-side endpoint, not just its client UI, for anything that does belong here.** The pattern (not currently instantiated — nothing's been added yet): `apps/client/server/index.ts` exports a `registerXService(app)`; `apps/server/src/app.ts` imports it (`@trellis/client/server`) and mounts it, the same way `identity` is mounted directly in `apps/server`. Extend `apps/client/server`, don't add client-specific feature logic to the core app.
- **No authentication is registered anywhere in `apps/server` today.** This is explicit and temporary — "trust based on nothing." Don't build anything that assumes a client-claimed identity is verified; it isn't.
- **The client app never constructs its own broker client.** Whatever server connection is needed lives in `apps/shell/src` and gets handed through `HostContext`, same as every other host API — keeps `HostContext` as the one seam between the two, and the client app never needs to know the server's URL/transport details itself.
