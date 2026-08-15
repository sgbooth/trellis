# CLAUDE.md

Guidance for agentic (Claude Code) development in this repo. See [README.md](README.md) for the full product/architecture writeup — this file is the condensed operating manual for making changes here correctly.

## What this is

Trellis is a Tauri desktop shell that serves a bespoke client app (a sandboxed ES module) without a shell reinstall per feature. The shell owns a fixed, IT-reviewed capability surface; the app consumes a scoped subset of it via `HostContext`. New user-facing functionality should almost always be built in **`apps/client`**, not a shell change.

```
apps/shell/          the Tauri host — Rust capability/IPC layer + React chrome
apps/server/          the core broker — node:http + socket.io on one
                      namespace (`/socket`); wire protocol, rooms, and the
                      handler registry + provisional llm/bundles stubs;
                      mounts the client app's server-owned handlers
apps/client/          the bespoke client app for this deployment — the one
                      thing that actually changes when a team builds their
                      feature; owns its client UI and (optionally) its
                      server-side endpoint (apps/client/server)
sdk/                  shared contract: Capability, PluginManifest, HostContext,
                      definePlugin — also exports reusable UI components a new
                      client app can start from (e.g. TrellisInfo), not just types.
                      `@trellis/sdk/realtime` is a React-free subpath holding the
                      transport contract, so the Node broker can import it
```

**There's exactly one client app, at a fixed location.** `apps/shell` statically imports `@trellis/client` directly — no selection mechanism, no per-checkout config. To build a different app, replace what's in `apps/client`.

## Current build phase — read this before assuming anything is real

We're through **Stage 3** per the README's build-phases list (Stage 1 static shell, Stage 2 local dynamic loading, Stage 3 manifest + capability declarations). Concretely:

- [App.tsx](apps/shell/src/App.tsx) fetches `apps/client`'s manifest over `plugin://client/manifest.json` and `React.lazy`-loads its component from `plugin://client/index.js` — no more static import. See [lib.rs](apps/shell/src-tauri/src/lib.rs)'s `register_uri_scheme_protocol("plugin", ...)` for the protocol handler, and `apps/client/build.mjs` for the esbuild step that produces `dist/index.js`/`dist/manifest.json`.
- `files:read`/`write`/`watch`/`open-dialog`, `llm:invoke`, `clipboard:*`, `database:query`, `secrets:*`, `media:camera`, `media:microphone`, and `notifications:send` are all declared in [types.ts](sdk/src/types.ts) but have no real implementation yet — shape exists, plumbing doesn't. `files:open-file` is the one exception: it's real ([filesHost.ts](apps/shell/src/filesHost.ts), backed by `tauri-plugin-opener`, which was already a dependency for unrelated reasons).
- **Capability grants are Rust-enforced, not just self-declared.** The `plugin://` handler filters `manifest.json`'s `capabilities` against [allowed-capabilities.json](apps/shell/src-tauri/allowed-capabilities.json) (compiled into the binary via `include_str!`, not read from disk at runtime — it's policy, not something local file access should be able to edit) before the shell ever sees the manifest. `App.tsx` then reduces `HostContext` via [scopeHostContext.ts](apps/shell/src/scopeHostContext.ts) using that already-filtered list — `scopeHostContext` itself is just the mechanical reduction, not a security boundary. Confirmed working live, not just in the Rust unit tests: a capability outside the allowlist gets stripped before the shell ever sees it, with a `[capabilities] ... denied ...` log line — the plugin just doesn't get that key on `HostContext` (`host.files === undefined`, no error, no crash). This is deliberate — see the `HostContext` doc comment.
- **Scoping parameters (path prefixes, allowed domains, etc.) belong in Tauri's own `capabilities/*.json`, not `PluginManifest`.** Our allowlist is coarse/boolean — does the deployment's one client app get a capability at all. The *fine-grained* restriction (which paths, which domains) for a capability backed by a real Tauri plugin is Tauri's own permission/scope system, the same mechanism already granting `opener:default`. Don't add a scoping field to `PluginManifest`/`Capability` — when a capability like `files:read` actually gets implemented, its scoping shows up as a `capabilities/*.json` permission entry alongside it, not as new manifest syntax.
- **Not done yet**: no plugin registry (still exactly one client app, fixed location), no signature verification (Stage 4 — a plugin's *code* isn't verified, only which capabilities it can request), no real distribution (Stage 5 — `apps/client/dist` is read from a dev-time path, not an installed-plugins directory).
- **Backend exists, minimally.** [apps/server](apps/server) is a socket.io broker with **no authentication** — deliberate, temporary, "trust based on nothing," flagged loudly in [app.ts](apps/server/src/app.ts). It handles the wire protocol, room membership, and an unverified `identity:claim`, and mounts the client app's server-owned handlers; `llm`/`bundles` are provisional core-owned stub operations (`NOT_IMPLEMENTED`) until something claims them for real. See "Backend" below.

When asked to "add a capability" or "wire up X for the client app," check whether the plumbing exists yet before assuming it does. Most of the capability table in the README is a target design, not current code.

## Core invariants to preserve

- **Plugins never get raw access to Rust/OS.** Everything crosses through `HostContext`, which is assembled from capabilities the plugin's manifest declared. A plugin whose manifest doesn't request `files:read` must get `host.files === undefined`, not a `files` object that throws.
- **Capability shape lives in `sdk`, not per-plugin.** Adding a new capability means: extend `Capability` in [types.ts](sdk/src/types.ts), add its API interface (e.g. `FilesApi`), add it to `HostContext`, then wire the shell-side implementation. Don't let a plugin invent its own ad hoc host API.
- **`react`/`react-dom`/`react/jsx-runtime` are externalized**, not bundled per plugin — the host provides them. If you touch plugin build config, don't break this (duplicate React instances silently break hooks).
- **The manifest's `capabilities` array is the source of truth for what a plugin can touch.** UI (like the capability list rendered in `App.tsx`) should reflect it, not hardcode assumptions.
- **New verbs should be expressible via existing capability verbs, scoped at the Tauri-capability-file layer** (path prefixes, allowed domains, database scopes — see above) rather than new `Capability` enum entries per feature. Before adding a new `Capability`, check if an existing verb with different Tauri-side scoping covers it. Capabilities should map to system-level resources (files, network, a database, secret storage) — not app-specific business concepts; `workflow:read`/`workflow:transition` got cut from v1 for exactly this reason.
- `system:shell-exec` is explicitly off the table — don't introduce arbitrary shell exec as a capability or an escape hatch.

## Workflow

- `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm lint` run through turborepo across the workspace (`apps/*`, `sdk`).
- `pnpm tauri` proxies to the shell's Tauri CLI.
- New functionality = edit `apps/client` directly (`workspace:*` dep on `@trellis/sdk`, default-exports `definePlugin({ manifest, Component })`). Add/extend `apps/client/server` too if it needs backend logic (see "Backend" below).
- Don't add capability needs to the manifest speculatively — request only what the app's actual functionality uses; this list is what a future reviewer/IT approval will read.

## Backend — brokering access to other systems

The shell's webview is sandboxed and untrusted-by-design; plugins running inside it must never hold real credentials, API keys, or unmediated network access to internal/external systems. That means capabilities like `llm:invoke`, `network:fetch`, and `realtime:subscribe` can't terminate in the webview — they need a trusted broker in front of them.

That broker is [apps/server](apps/server): `node:http` + socket.io, everything on one namespace, `/socket`. It was a FeathersJS app through Stage 3; Feathers was removed because the work ahead (CRDT-backed collaborative editing) wants high-frequency binary deltas and ephemeral presence traffic, which fit service methods and a per-event hook pipeline badly. Feathers was already socket.io underneath, so this removed a layer rather than swapping a transport — at the cost of the `@feathersjs/authentication` slot it was being kept for.

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
- **Types are not a trust boundary.** The caller is the sandboxed webview, so
  handlers validate params at runtime even though the spec types them.
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
  the app importing `socket.io-client` directly would be a capability-model
  violation. Hence `rpcSpec.ts`/`channelSpec.ts` are imported by both the
  sandboxed UI and the trusted handlers and must stay dependency-free: they
  only *describe* the surface; the socket lives in the shell.
- **`pnpm tauri dev` runs `pnpm -w run dev`**, not the shell's own `dev`. Tauri
  executes `beforeDevCommand` from `apps/shell`, where `dev` is only `vite` —
  pointing it there starts no broker and no plugin-bundle watcher.

- `apps/client` does have a build step now (`build.mjs`, esbuild → `dist/`), but it's only consumed via the `plugin://` protocol for the client bundle itself — real bundle *distribution* over the broker (serving it to other machines, per README's Stage 5) isn't implemented. The `bundles` stub exists to name that concern, not to work yet.
