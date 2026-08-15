# CLAUDE.md

Guidance for agentic (Claude Code) development in this repo. See [README.md](README.md) for the full product/architecture writeup — this file is the condensed operating manual for making changes here correctly.

## What this is

Trellis is a **bare scaffold for experimenting with building features in Tauri**, not a finished product shell. It's a Tauri desktop shell that dynamically loads a bespoke client app, fetched at runtime from [apps/server](apps/server), so a new feature ships by rebuilding `apps/client`, pushing the new build to the server, and reloading — no shell reinstall required. `apps/shell` and `apps/client` are built by the same team at the same trust level, so the client gets the full `HostContext` the shell can construct, unscoped — there's no capability-grant/sandboxing layer between them. Dynamic loading exists purely for deploy velocity, not as a trust boundary. New user-facing functionality should almost always be built in **`apps/client`**, not a shell or server change.

The intended lifecycle: prototype a feature idea quickly here, in `apps/client`, with low ceremony. Once it proves itself and becomes something people actually depend on, it's expected to **graduate out into its own standalone Tauri app** — its own shell, its own release cycle, and real authentication if it needs one. Don't build this scaffold toward becoming that end state (e.g. don't add code signing, real auth, or a capability-review system here) — that would defeat the point of keeping it a fast, disposable place to experiment before committing to a real app.

```
apps/shell/          the Tauri host — Rust IPC layer + React chrome
apps/server/          the core broker — node:http + socket.io on one
                      namespace (`/socket`); wire protocol, rooms, and the
                      handler registry; mounts the client app's server-owned
                      handlers. The same node:http server also serves
                      apps/client's built bundle as static files — the
                      actual distribution mechanism
apps/client/          the bespoke client app for this deployment — the one
                      thing that actually changes when a team builds their
                      feature; owns its client UI and (optionally) its
                      server-owned endpoint, mounted into apps/server
sdk/                  shared contract: PluginManifest, HostContext,
                      definePlugin — also exports reusable UI components a new
                      client app can start from (e.g. TrellisInfo), not just types.
                      `@trellis/sdk/realtime` is a React-free subpath holding the
                      transport contract, so the Node broker can import it
```

**There's exactly one client app, at a fixed location.** `apps/shell` dynamically loads `@trellis/client`'s built bundle from `apps/server` at runtime — no selection mechanism, no per-checkout config. To build a different app, replace what's in `apps/client`.

## What's implemented vs. not — read this before assuming anything is real

- [App.tsx](apps/shell/src/App.tsx) `React.lazy`-loads the plugin's component from `apps/server`'s `/index.js` (see [app.ts](apps/server/src/app.ts)'s `serveClientBundle`) — no static import, so a new `apps/client` build is live on next reload without a shell rebuild. See `apps/client/build.mjs` for the esbuild step that produces `dist/index.js`/`dist/manifest.json`.
- **There is no capability-grant system.** `apps/client` and `apps/shell` are built by the same team; `App.tsx` hands the plugin the full `HostContext` it can construct, unscoped. `HostContext` fields can still be `undefined` (e.g. `host.secrets`, `host.llm`) but only because that API isn't implemented yet, not because of any per-plugin grant — plugins should still feature-detect (`if (host.device)`) for that reason.
- `FilesApi.read`/`write`/`watch`/`openDialog`, `LlmApi`, `ClipboardApi`, `SecretsApi`, `CameraApi`, `MicrophoneApi`, `NotificationsApi`, `EmailApi`, `CalendarApi`, and `ContactsApi` are all declared in [types.ts](sdk/src/types.ts) but have no real implementation yet — shape exists, plumbing doesn't. `Email`/`Calendar`/`Contacts` are placeholders for an eventual move of business functions (email, calendar, directory lookup) that currently live in separate tools like Outlook into this app. None of these are global/shared state, so none of them belong on `apps/server` (see "Backend" below) — a direct Tauri Rust command is the expected way to build any of them. `FilesApi.open` and `onClosed` (Linux via inotify, macOS via `libproc` polling — see [close_watch.rs](apps/shell/src-tauri/src/close_watch.rs); Windows not yet implemented) are real.
- **Scoping parameters (path prefixes, allowed domains, etc.) belong in Tauri's own `capabilities/*.json`.** When a Tauri-plugin-backed API like file access gets implemented for real, its fine-grained restriction (which paths, which domains) is Tauri's own permission/scope system — the same mechanism already granting `opener:default` in [default.json](apps/shell/src-tauri/capabilities/default.json) — not something `PluginManifest` needs to carry.
- **Not done, and not planned**: no plugin registry (still exactly one client app, fixed location), no code-signature verification, no auto-updater. None of these were ever about protecting against a less-trusted plugin author — that was the only reason any of them were on a roadmap, and that roadmap has been retired along with the capability model. Real bundle distribution (as opposed to a dev-time local path) **is** done now — see "Backend" below — that's different from the retired items above; it just happens to be a plain static-file server rather than anything signed/verified.

- **Backend exists and is real.** [apps/server](apps/server) is a `node:http` + socket.io broker with **no authentication** — deliberate, temporary, "trust based on nothing," flagged loudly in [app.ts](apps/server/src/app.ts). It handles the wire protocol, room membership, an unverified `identity:claim`, and mounts the client app's server-owned handlers. The **RPC** half is done and load-bearing; the **channels/subscription** half is parked mid-design — see "Channels" below before touching it.

When asked to "wire up X for the client app," check whether the plumbing exists yet before assuming it does — extend `HostContext`/`sdk/src/types.ts` directly.

## Core invariants to preserve

- **Host API shape lives in `sdk`, not per-plugin.** Adding a new host API means: add its interface to [types.ts](sdk/src/types.ts) (e.g. `FilesApi`), add it to `HostContext`, then wire the shell-side implementation in `apps/shell/src`. Don't let the client app invent its own ad hoc host API or reach past `HostContext` into Tauri/Node APIs directly — not for a trust reason, just so `sdk` stays the one place documenting what the shell exposes.
- **`react`/`react-dom`/`react/jsx-runtime` are externalized**, not bundled per plugin — the host provides them. If you touch plugin build config, don't break this (duplicate React instances silently break hooks).
- Don't add a raw arbitrary-shell-exec host API (a `HostContext.exec(command)` escape hatch) — not because of a trust boundary, but because it's a bad API shape that defeats the point of having a typed `HostContext` at all; model the underlying need as a specific typed operation instead.

## Scope of future shell-side changes

`apps/shell` (the Tauri/Rust side) is meant to stay small and mostly stable so forks can keep merging from upstream without fighting conflicts (see README's "Forking and maintaining your fork"). Legitimate reasons to touch `apps/shell/src-tauri` going forward are basically two:

1. **New Tauri-exposed commands backing a `HostContext` API.** Same pattern as `close_watch.rs`/`watch_file_closed`: add the `#[tauri::command]`, register it in the `tauri::generate_handler!` list in [lib.rs](apps/shell/src-tauri/src/lib.rs), wire it through `HostContext` per "Core invariants" above. This is expected, ordinary growth, not a special case.
2. **Security/dependency maintenance and staying aligned with current Tauri practice** — bumping the `tauri` crate and plugins, following upstream Tauri's own security advisories, keeping `capabilities/*.json` scoped correctly as new permissions get requested, and periodic `cargo audit`/`pnpm audit`. This is maintenance, not feature work — it shouldn't grow the shell's responsibilities, just keep it patched and conventional.

Anything that isn't one of those two — new UI chrome, new business logic, new per-plugin scoping concepts — almost certainly belongs in `apps/client` or `sdk` instead (see "What this is" above). If a change to `apps/shell` doesn't fit either bucket, treat that as a signal to double check it's actually needed there.

## Workflow

- `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm lint` run through turborepo across the workspace (`apps/*`, `sdk`).
- `pnpm tauri` proxies to the shell's Tauri CLI.
- New functionality = edit `apps/client` directly (`workspace:*` dep on `@trellis/sdk`, default-exports `definePlugin({ manifest, Component })`). Add/extend `apps/client/server` too if it needs a server-owned endpoint (see "Backend" below) — but most new `HostContext` APIs won't need this; see the next section for when a server endpoint is actually the right call.

## Backend — global/shared concerns only, not a trust boundary

`apps/client` and `apps/shell` are the same trust level, so [apps/server](apps/server) doesn't exist to keep the webview from holding credentials — there's no "the webview can't be trusted" constraint here. It exists for things that are inherently **global or shared**, which no single client's own Tauri process can be on its own:

- **Serving the client bundle.** The static-file handler in [app.ts](apps/server/src/app.ts) over `apps/client/dist` is the actual distribution mechanism — push a new build to the server and every running shell picks it up on next load. This is real, not a stub. It replaced the Rust `plugin://` protocol handler, which read straight off local disk.
- **Brokered realtime + RPC.** Request/response and room-scoped push, so that clients can reach shared state and each other. See "RPC" and "Channels" below.
- **An unverified `identity:claim`** (audit-trail only — see the SECURITY note in [app.ts](apps/server/src/app.ts)) that a socket-connected client sends once to attach `{ username, displayName }` to its connection for server-side logging.

**What does *not* belong here:** anything per-request/per-user with no fan-out requirement — `LlmApi`, `EmailApi`, `CalendarApi`, `ContactsApi` calls are not global state, so they should be direct Tauri Rust commands (see `close_watch.rs` for the existing precedent of Rust doing real OS/network work), not routed through this server. Before adding something to `apps/server`, ask whether it's actually shared/global — if not, it's a Tauri command instead.

The broker is `node:http` + socket.io, everything on one namespace, `/socket`. It was a FeathersJS app through Stage 3; Feathers was removed because the work ahead (CRDT-backed collaborative editing) wants high-frequency binary deltas and ephemeral presence traffic, which fit service methods and a per-event hook pipeline badly. Feathers was already socket.io underneath, so this removed a layer rather than swapping a transport. Serving the client bundle came along with it: `koa-static` became a small static handler on the same `node:http` server.

## RPC — how to add and call a backend method

This is the load-bearing path for backend logic, and the layout is deliberate:
open the file named for the method prefix and you see every method with that
prefix. Follow it rather than inventing a parallel mechanism.

| File | Role |
|---|---|
| [apps/client/rpcSpec.ts](apps/client/rpcSpec.ts) | **The whole API surface.** Every method, its params and result. |
| [apps/client/server/handlers/](apps/client/server/handlers/) | One file per prefix. `chat.*` → `chatHandlers.ts`. Logic goes **directly in the handler**. |
| [apps/client/server/rpcHandlers.ts](apps/client/server/rpcHandlers.ts) | Spreads the handler files into one map; `satisfies HandlerMap` proves the spec is covered. |
| [apps/client/src/rpc.ts](apps/client/src/rpc.ts) | The client singleton. `initRpc(host)` arms it; `rpc` is a Proxy so other modules can import it at top level. |
| [sdk/src/rpc.ts](sdk/src/rpc.ts) | Generic machinery — `HandlerMap`, `HandlersFor`, `createRpcClient`. Domain-free. |
| [apps/server/src/rpcServer.ts](apps/server/src/rpcServer.ts) | `mountRpc()` — dispatches the wire `request` event to the handler map. |

**To add a method**, two files:

```ts
// 1. apps/client/rpcSpec.ts — `{} as X` because this is a real runtime value
//    (the client needs the key list to build rpc.chat.send) that also carries
//    every type via `typeof rpcSpec`.
"chat.rename": {
  params: {} as { roomId: string; name: string },
  result: {} as { ok: boolean },
},

// 2. apps/client/server/handlers/chatHandlers.ts — HandlersFor<_, "chat">
//    now *requires* this key; the file won't compile until it's added.
"chat.rename": async ({ roomId, name }, ctx) => {
  if (typeof name !== "string" || !name.trim()) throw new Error("name is required");
  return { ok: true };
},
```

A new prefix means a new `<prefix>Handlers.ts` plus one spread line in
`rpcHandlers.ts`.

**To call it**, either form — both typed off the same spec:

```ts
import { rpc } from "./rpc";
await rpc.chat.rename({ roomId, name });        // namespaced sugar
await rpc.call("chat.rename", { roomId, name }); // greppable literal
```

Rules that keep this working:

- **`HandlersFor<typeof rpcSpec, "chat">` slices the spec by prefix**, so a
  handler file must implement its whole slice and nothing else. Spec and
  handlers cannot drift in either direction. Don't weaken this to `Partial`.
- **No `services/` layer by default.** Put logic in the handler; extract only
  on genuine reuse. A previous `services/` split was removed for being
  indirection without payoff.
- **Handlers take `(params, ctx)`**, `ctx` being `{ identity, socketId }`.
  Most ignore it. `identity` is client-claimed and unverified.
- **Types are not a trust boundary.** The spec types params but nothing
  enforces them on the wire, so handlers validate at runtime regardless.
- **Errors become acks, never transport throws.** Throw from a handler and the
  caller's promise rejects; `RpcError` in `rpcServer.ts` controls the code.
- **Don't add speculative types to `rpcSpec.ts`.** `result: {} as unknown` is
  the marker for "real model goes here"; narrowing at the call site is the
  reminder.

## Channels — PARKED, read before touching

The realtime half is **on hold mid-design** and is half-wired. Verified state:

- **Works:** `subscribe` joins a room; server→client push via
  `publishToRoom("chat/<id>", payload)` in a handler, routed through
  [channelBridge.ts](apps/client/server/channelBridge.ts) → `registry.publishRaw`
  → `ns.to(room).emit("event", …)`.
- **Dead, zero callers:** `Registry.onSnapshot` (so every subscribe returns
  `snapshot: null`), `Registry.onPublish` (so client→server `publish` always
  fails `NO_HANDLER`), the typed `registry.publish()`, and
  `HandlerError`/`ok`/`fail` in [registry.ts](apps/server/src/registry.ts).
- **Known inconsistency:** the sender addresses rooms with a raw template
  string while the subscriber uses the typed `channels.chat(id)` constructor
  from [channelSpec.ts](apps/client/channelSpec.ts). Nothing checks they agree.
- Chat history lives on `rpc.chat.history`, not a channel snapshot, because
  the snapshot path is dead.

Open question, unanswered: whether channels need snapshots and client-publish
at all, or whether server→client push is the whole requirement. Intended
direction is to mirror the RPC layout above. **Don't build on channels without
picking that design back up.**

## Transport

**The wire contract lives in [sdk/src/realtime.ts](sdk/src/realtime.ts).** The
event set is small and closed (`subscribe`/`unsubscribe`/`publish`/`request`/
`identity:claim`, plus `event` server→client). The channel name is an
*argument*, never the event name — encoding the room into the event name
(`socket.emit("matter/123", …)`) is the obvious-looking design that makes the
socket untypeable. Every layer is type-erased on the wire and restored above
it, confining casts to one place per side.

Architecture:

- **The client app owns its server-side handlers, not just its UI.**
  `apps/client/server/index.ts` is a composition root only, exporting
  `rpcSpec`/`handlers`; `apps/server/src/app.ts` imports it via
  `@trellis/client/server` and mounts it. Generic contracts live in the SDK
  because apps/server depends on apps/client, so the arrow can't point back.
- **The core broker stays minimal**: wire protocol, room membership,
  `identity:claim`, and `mountRpc`. It never learns what a "matter" is.
- **`authorizeSubscribe` in [app.ts](apps/server/src/app.ts) returns `true` for
  everything.** It exists early on purpose: `matter/{matterId}` is where joining
  the wrong room leaks privileged material, and retrofitting that check across
  every caller later is much worse than a stub now. Don't add paths that bypass
  it — `publish` is gated through it for the same reason.
- **The shell must re-subscribe on reconnect**
  ([realtimeHost.ts](apps/shell/src/realtimeHost.ts)). A reconnect is a new
  socket server-side: room membership and claimed identity are both gone.
  Without it, RPC keeps working while subscriptions go silently dead — a
  single-window smoke test passes and the bug ships.
- **Acks time out (8s).** socket.io buffers emits while disconnected and retries
  forever, so without a timeout an unreachable broker leaves every call pending
  with no error — far harder to diagnose than a failure.
- **No authentication anywhere in `apps/server`.** Explicit and temporary —
  "trust based on nothing." Nothing may assume a claimed identity is verified.
- **The client app never constructs its own broker client.** The shell does
  (`identityHost.ts`, `realtimeHost.ts`) and hands it through `HostContext` —
  not for a trust reason, but to keep `HostContext` the one seam between the
  two, so the client app never needs to know the server's URL or transport.
  Hence `rpcSpec.ts`/`channelSpec.ts` are imported by both the UI and the
  handlers and must stay dependency-free: they only *describe* the surface;
  the socket lives in the shell.
- **`pnpm tauri dev` runs `pnpm -w run dev`**, not the shell's own `dev`. Tauri
  executes `beforeDevCommand` from `apps/shell`, where `dev` is only `vite` —
  pointing it there starts no broker and no plugin-bundle watcher. The broker
  is now what serves the client bundle, so without it the shell has nothing
  to load at all.
