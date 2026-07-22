# CLAUDE.md

Guidance for agentic (Claude Code) development in this repo. See [README.md](README.md) for the full product/architecture writeup — this file is the condensed operating manual for making changes here correctly.

## What this is

Trellis is a Tauri desktop shell that serves a bespoke client app (a sandboxed ES module) without a shell reinstall per feature. The shell owns a fixed, IT-reviewed capability surface; the app consumes a scoped subset of it via `HostContext`. New user-facing functionality should almost always be built in **`apps/client`**, not a shell change.

```
apps/shell/          the Tauri host — Rust capability/IPC layer + React chrome
apps/server/          the core broker — minimal FeatherJS app; identity/audit
                      service + provisional llm/bundles stubs;
                      mounts the client app's server-owned service
apps/client/          the bespoke client app for this deployment — the one
                      thing that actually changes when a team builds their
                      feature; owns its client UI and (optionally) its
                      server-side endpoint (apps/client/server)
sdk/                  shared contract: Capability, PluginManifest, HostContext,
                      definePlugin — also exports reusable UI components a new
                      client app can start from (e.g. TrellisInfo), not just types
```

**There's exactly one client app, at a fixed location.** `apps/shell` statically imports `@trellis/client` directly — no selection mechanism, no per-checkout config. To build a different app, replace what's in `apps/client`.

## Current build phase — read this before assuming anything is real

We're through **Stage 3** per the README's build-phases list (Stage 1 static shell, Stage 2 local dynamic loading, Stage 3 manifest + capability declarations). Concretely:

- [App.tsx](apps/shell/src/App.tsx) fetches `apps/client`'s manifest over `plugin://client/manifest.json` and `React.lazy`-loads its component from `plugin://client/index.js` — no more static import. See [lib.rs](apps/shell/src-tauri/src/lib.rs)'s `register_uri_scheme_protocol("plugin", ...)` for the protocol handler, and `apps/client/build.mjs` for the esbuild step that produces `dist/index.js`/`dist/manifest.json`.
- `files:read`/`write`/`watch`/`open-dialog`, `llm:invoke`, `clipboard:*`, `database:query`, `secrets:*`, `media:camera`, `media:microphone`, and `notifications:send` are all declared in [types.ts](sdk/src/types.ts) but have no real implementation yet — shape exists, plumbing doesn't. `files:open-file` is the one exception: it's real ([filesHost.ts](apps/shell/src/filesHost.ts), backed by `tauri-plugin-opener`, which was already a dependency for unrelated reasons).
- **Capability grants are Rust-enforced, not just self-declared.** The `plugin://` handler filters `manifest.json`'s `capabilities` against [allowed-capabilities.json](apps/shell/src-tauri/allowed-capabilities.json) (compiled into the binary via `include_str!`, not read from disk at runtime — it's policy, not something local file access should be able to edit) before the shell ever sees the manifest. `App.tsx` then reduces `HostContext` via [scopeHostContext.ts](apps/shell/src/scopeHostContext.ts) using that already-filtered list — `scopeHostContext` itself is just the mechanical reduction, not a security boundary. Confirmed working live, not just in the Rust unit tests: a capability outside the allowlist gets stripped before the shell ever sees it, with a `[capabilities] ... denied ...` log line — the plugin just doesn't get that key on `HostContext` (`host.files === undefined`, no error, no crash). This is deliberate — see the `HostContext` doc comment.
- **Scoping parameters (path prefixes, allowed domains, etc.) belong in Tauri's own `capabilities/*.json`, not `PluginManifest`.** Our allowlist is coarse/boolean — does the deployment's one client app get a capability at all. The *fine-grained* restriction (which paths, which domains) for a capability backed by a real Tauri plugin is Tauri's own permission/scope system, the same mechanism already granting `opener:default`. Don't add a scoping field to `PluginManifest`/`Capability` — when a capability like `files:read` actually gets implemented, its scoping shows up as a `capabilities/*.json` permission entry alongside it, not as new manifest syntax.
- **Not done yet**: no plugin registry (still exactly one client app, fixed location), no signature verification (Stage 4 — a plugin's *code* isn't verified, only which capabilities it can request), no real distribution (Stage 5 — `apps/client/dist` is read from a dev-time path, not an installed-plugins directory).
- **Backend exists, minimally.** [apps/server](apps/server) is a FeatherJS app with **no authentication** — deliberate, temporary, "trust based on nothing," flagged loudly in [app.ts](apps/server/src/app.ts). It hosts a shared `identity` service (audit-trail only, unverified) and mounts the client app's server-owned service; `llm`/`bundles` are provisional core-owned stubs (`501 NotImplemented`) until something claims them for real. See "Backend" below.

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

The shell's webview is sandboxed and untrusted-by-design; plugins running inside it must never hold real credentials, API keys, or unmediated network access to internal/external systems. That means capabilities like `llm:invoke`, `network:fetch`, and `chat:invoke` can't terminate in the webview — they need a trusted broker in front of them.

That broker is [apps/server](apps/server), a FeatherJS app (opinionated choice — accepted trade-off of a heavier dependency footprint for services/hooks/channels structure and a clean slot for `@feathersjs/authentication` later instead of a rewrite). Its architecture:

- **The client app owns its own server-side endpoint, not just its client UI.** `apps/client/server/index.ts` exports `registerChatService(app)`; `apps/server/src/app.ts` imports it directly (`@trellis/client/server`) and mounts it. This is the pattern for real backend logic — extend `apps/client/server`, don't add feature logic to the core app.
- **The core app stays minimal**: a shared `identity` service (any client can call it to attach an unverified `{ username, displayName }` to its connection — audit logging only, not auth), plus a provisional `llm`/`bundles` stub services that 501 until the client app claims them for real and takes over ownership the way it already did for `chat`.
- **No authentication is registered anywhere in `apps/server` today.** This is explicit and temporary — "trust based on nothing." Don't build anything that assumes a client-claimed identity is verified; it isn't.
- **The client app never constructs its own broker client.** The shell does (`apps/shell/src/identityHost.ts`, `chatHost.ts`) and hands the result through `HostContext`, same as every other capability — the app importing `socket.io-client` or `@feathersjs/feathers` directly would be a capability-model violation.
- `apps/client` does have a build step now (`build.mjs`, esbuild → `dist/`), but it's only consumed via the `plugin://` protocol for the client bundle itself — real bundle *distribution* over the broker (serving it to other machines, per README's Stage 5) isn't implemented. The `bundles` stub exists to name that concern, not to work yet.
