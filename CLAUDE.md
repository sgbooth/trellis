# CLAUDE.md

Operating manual for making changes in this repo. See [README.md](README.md) for the
full product/architecture writeup.

## What this is

Trellis is a scaffold for prototyping features in Tauri. It is not a finished
product shell.

A Tauri desktop shell loads a client app at runtime, fetched from
[apps/server](apps/server). Shipping a feature means: rebuild `apps/client`, push
the build to the server, reload. No shell rebuild or reinstall.

There is exactly one client app, at a fixed location — no registry, no selection
mechanism, no per-checkout config. To build a different app, replace the contents
of `apps/client`.

`apps/shell` and `apps/client` are built by the same team at the same trust level.
The client receives the full `HostContext` the shell can construct, unscoped.
**There is no capability-grant or sandboxing layer, and none is planned.** Dynamic
loading exists for deploy speed, not isolation.

Features prototyped here are expected to graduate into their own standalone Tauri
app once they matter. Do not add code signing, real authentication, an
auto-updater, or a capability-review system to this repo — those belong to the
standalone app, not the scaffold.

```
apps/shell/     Tauri host — Rust IPC layer + React chrome
apps/server/    Broker — node:http + socket.io on one namespace (`/socket`).
                Wire protocol, rooms, handler registry. Mounts the client
                app's server-owned handlers. The same node:http server
                serves apps/client's built bundle as static files.
apps/client/    The client app. The only thing that changes when building a
                feature. Owns its UI and, optionally, its server-owned
                handlers, which apps/server mounts.
sdk/            Shared contract: HostContext, definePlugin, the realtime and
                RPC machinery. Also exports reusable UI components (e.g.
                TrellisInfo). `@trellis/sdk/realtime` and `@trellis/sdk/rpc`
                are React-free subpaths, so the Node broker can import them.
```

Configuration lives in the app that reads it — in practice
`apps/server/src/config.ts`, since the shell needs exactly one build-time value.
See "Configuration" below.

**Where to put new work:** new user-facing functionality goes in `apps/client`.
See "Shell changes" and "Backend" below for the narrow cases that belong elsewhere.

### Starting your own app

`pnpm reset:client` strips the demo (chat, peer, weather) and leaves a minimal
client that still builds and runs, keeping one trivial `app.ping` method so the
spec → handler → call path stays wired end to end. It prints what it would do
and writes nothing without `--write`.

The demo files are committed, so anything it removes is recoverable with
`git show HEAD:apps/client/<path>`. It touches `apps/client` only.

## Where does this go?

Start here. Most mistakes in this repo are putting a change in the wrong tier,
not writing it badly.

| What you're adding | Goes in | Section |
|---|---|---|
| A screen, panel, or any UI | `apps/client/src` | "Client app" |
| Logic needing shared/global state, or state the server must stamp | an RPC method in `apps/client` | "RPC" |
| Server→client push (live updates, presence, deltas) | a channel in `apps/client` | "Channels" |
| Long or incremental output (LLM tokens, progress) | a **streaming** RPC method | "Streaming methods" |
| Access to the OS, hardware, or local filesystem | a Tauri command + `HostContext` API | "Shell changes" |
| A new environment value | the config of the app that reads it | "Configuration" |
| A reusable, domain-free UI component | `sdk` (like `TrellisInfo`) | "Rules" |

Two questions settle most of it:

1. **Is the state shared between clients?** If yes it belongs on the broker
   (RPC or channels). If no, it is a Tauri command — *unless* question 2 applies.
2. **Does it have to work in the browser too?** The web entry has no Tauri, so a
   Tauri-only implementation silently does not exist there. That overrides
   question 1: this is why LLM streaming is a broker RPC method despite being
   per-user with no fan-out.

If the answer is "none of these", it probably belongs in `apps/client` anyway —
that is the default, not the last resort.

## What exists and what doesn't

Check this before assuming an API is wired up.

**Working:**

- Dynamic client loading. [pluginLoader.ts](apps/shell/src/pluginLoader.ts)
  `React.lazy`-loads the plugin component from `apps/server`'s `/client/index.js`
  (see `serveStatic` in [app.ts](apps/server/src/app.ts)). `apps/client/build.mjs`
  is the esbuild step producing `dist/index.js`.
- **A deployable broker.** `apps/server/build.mjs` bundles it to a single
  `dist/index.js` that plain `node` runs, plus `/healthz` and clean SIGTERM
  handling. See "Deploying".
- **Tests.** `pnpm test`, Node's built-in runner. See "Tests".
- **Two shell entry points over one `App`** — see "Entry points" below.
- `FilesApi.open` and `FilesApi.onClosed`. Linux uses inotify, macOS uses `libproc`
  polling — see [close_watch.rs](apps/shell/src-tauri/src/close_watch.rs). Windows
  is not implemented.
- The backend: [apps/server](apps/server), including both RPC and channels.

**Declared in [types.ts](sdk/src/types.ts) but not implemented** — the type shape
exists, the plumbing does not: `FilesApi.read`/`write`/`watch`/`openDialog`,
`LlmApi`, `ClipboardApi`, `SecretsApi`, `CameraApi`, `MicrophoneApi`,
`NotificationsApi`, `EmailApi`, `CalendarApi`, `ContactsApi`.

`EmailApi`/`CalendarApi`/`ContactsApi` are placeholders for moving business
functions (email, calendar, directory lookup) out of tools like Outlook and into
this app.

None of these are shared state, so none belong on `apps/server` — implement each as
a direct Tauri command (see "Backend" below).

**Not implemented and not planned:** plugin registry, code-signature verification,
auto-updater. These only existed on a roadmap to guard against untrusted plugin
authors; that roadmap is retired along with the capability model.

Because `HostContext` fields can be `undefined` for unimplemented APIs, client code
should feature-detect: `if (host.device) { … }`.

**Fine-grained scoping (path prefixes, allowed domains) goes in Tauri's own
`capabilities/*.json`.** That is the same mechanism already granting
`opener:default` in [default.json](apps/shell/src-tauri/capabilities/default.json).
There is no manifest or per-plugin declaration to update — the client app gets
whatever the shell can construct.

## Rules

- **Host API shape lives in `sdk`.** To add a host API: add its interface to
  [types.ts](sdk/src/types.ts), add it to `HostContext`, then implement it in
  `apps/shell/src`. The client app must not define its own ad hoc host API or call
  Tauri/Node APIs directly, so that `sdk` remains the single description of what the
  shell exposes.
- **`react` and `react/jsx-runtime` are aliased to shims,** not bundled per
  plugin — `apps/client/shims/*.cjs` re-export the single instance the shell
  published on `globalThis` (see [reactGlobals.ts](apps/shell/src/reactGlobals.ts)).
  Do not change this in `build.mjs`; two React instances break hooks silently.

  **`react-dom` is not aliased, and `apps/client` must not import it.** There is
  no shim for it and nothing publishes it globally, so an import would quietly
  bundle a second copy of React DOM into the client bundle — the same footgun,
  without the compile error. If a client genuinely needs it (`createPortal`,
  `flushSync`), add the global in `reactGlobals.ts` and a matching shim + alias,
  rather than letting it bundle.
- **No arbitrary shell exec host API.** Do not add `HostContext.exec(command)`.
  Model the specific underlying need as a typed operation instead.

## Shell changes

`apps/shell` (the Tauri/Rust side) stays small and stable so forks can keep merging
from upstream (see README, "Forking and maintaining your fork"). Two reasons to
change `apps/shell/src-tauri`:

1. **A new Tauri command backing a `HostContext` API** — the four-file path below.
2. **Dependency and security maintenance.** Bumping the `tauri` crate and plugins,
   following Tauri security advisories, keeping `capabilities/*.json` scoped, running
   `cargo audit` / `pnpm audit`.

Anything else — new UI chrome, business logic, per-plugin scoping concepts — belongs
in `apps/client` or `sdk`.

### Adding a host API

Four edits, in order. `get_device_info`/`DeviceApi` is the smallest complete
example in the tree; `watch_file_closed` is the one that also emits events.

```rust
// 1. apps/shell/src-tauri/src/lib.rs — the command
#[tauri::command]
fn get_thing() -> Result<Thing, String> { … }

// …and register it, or it is invisible to the webview:
.invoke_handler(tauri::generate_handler![…, get_thing])
```

```ts
// 2. sdk/src/types.ts — the shape, plus a field on HostContext
export interface ThingApi {
  get(): Promise<Thing>;
}
// HostContext: thing?: ThingApi;   ← optional, like every other field
```

```ts
// 3. apps/shell/src/thingHost.ts — the IPC adapter
import { invoke } from "@tauri-apps/api/core";
export const createThingApi = (): ThingApi => ({
  get: () => invoke<Thing>("get_thing"),
});

// 4. apps/shell/src/hosts/tauriHost.ts — hand it to the client
thing: createThingApi(),
```

Rules:

- **Step 2 is not optional.** `sdk` is the single description of what the shell
  exposes; a client app must never define its own ad hoc host API or call
  Tauri/Node directly.
- **Adapters are imported only from `tauriHost.ts`.** That is what keeps
  `@tauri-apps/*` out of the browser bundle — `invoke` rejects at call time
  rather than on import, so a web build that pulled it in would fail late and
  confusingly instead of simply not offering the API.
- **Leave the field out of `webHost.ts`** unless it genuinely works in a browser.
  Absence is the mechanism; consumers already feature-detect.
- **Fine-grained scoping goes in `capabilities/*.json`**, Tauri's own mechanism —
  not a new concept in the SDK.
- **If it needs to work on both hosts, it is not a Tauri command.** See "Where
  does this go?" — that case belongs on the broker instead.

## Entry points

The shell runs in two places. Everything below it — the client app, the broker, RPC
and channels — is already host-agnostic, so the entries differ only in where
identity comes from and which host APIs exist.

| | Desktop | Browser |
|---|---|---|
| HTML | `index.html` (Tauri's `frontendDist`) | `web.html` (served at `/` by the broker) |
| Entry | [main.tsx](apps/shell/src/main.tsx) | [mainWeb.tsx](apps/shell/src/mainWeb.tsx) |
| Host | [hosts/tauriHost.ts](apps/shell/src/hosts/tauriHost.ts) | [hosts/webHost.ts](apps/shell/src/hosts/webHost.ts) |
| Identity | `get_os_identity` Tauri command | typed once, kept in `localStorage` |
| Extra APIs | `device`, `files` | none |
| Broker URL | `VITE_TRELLIS_SERVER_URL`, baked in at build | `window.location.origin`, always |

Rules that keep this working:

- **[App.tsx](apps/shell/src/App.tsx) is presentational** — it takes a built
  `HostContext` and a `serverUrl`, and knows nothing about Tauri. Host construction
  belongs to an entry point. Adding a third entry should mean a new `main*.tsx` plus
  a `hosts/*.ts`, nothing more.
- **Import [reactGlobals.ts](apps/shell/src/reactGlobals.ts) first in every entry.**
  It publishes the shared React instance the client bundle binds to; an entry that
  skips it fails at the first hook the client app calls.
- **Tauri IPC adapters are imported only from `tauriHost.ts`**, which is what keeps
  them out of the browser bundle. `invoke` rejects rather than throwing on import,
  so a web build that pulled them in would fail late and confusingly instead of
  simply not offering the API.
- **The web identity is not authentication.** It is a claim the broker only logs,
  exactly like the OS identity — see the SECURITY note in
  [app.ts](apps/server/src/app.ts). Real auth is a graduate-out concern (see
  "What this is").
- **A failed bundle load is retryable, and retrying needs the cache cleared.**
  [PluginErrorBoundary](apps/shell/src/PluginErrorBoundary.tsx) offers a retry
  because the likely failure is transient and external — the broker was briefly
  down, or a deploy swapped the bundle mid-fetch — and wedging the window until
  someone reloads is a poor look for an app whose pitch is hot-swapping bundles.
  Resetting the boundary alone does nothing: `React.lazy` memoises the *promise*,
  so a rejected lazy component stays rejected and re-renders the same failure
  without another request. `clearPluginCache` in
  [pluginLoader.ts](apps/shell/src/pluginLoader.ts) is what makes a retry
  actually refetch; [App.tsx](apps/shell/src/App.tsx) bumps an attempt counter
  that keys both the memo and the boundary.
- **Absent APIs need no new mechanism.** `host.device`/`host.files` are simply
  missing in the browser; consumers already feature-detect.
- **The browser entry never configures a broker URL.** It uses
  `window.location.origin` in both modes. In production that is literally true —
  the broker serves the build. In dev, Vite's `proxy` block forwards
  `/socket.io` and `/client` to the broker so the same expression stays correct,
  which keeps dev exercising the production code path instead of a `DEV ?`
  branch. Proxy **`/socket.io`** (socket.io's HTTP transport path) with
  `ws: true`, never `/socket` — that is the namespace, an application-level name
  inside the payload that never appears in a request path, so proxying it
  forwards nothing.
- **Both HTML files must be listed in `build.rollupOptions.input`**
  ([vite.config.ts](apps/shell/vite.config.ts)). Dev serves any root `.html` without
  config, so a missing entry there breaks only the build.

## Workflow

- `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm typecheck` run through turborepo
  across `apps/*` and `sdk`. **There is no linter** — no ESLint config exists
  anywhere, so do not add `eslint-disable` comments expecting them to mean
  something. The `lint` task was removed because `turbo run lint` matched no
  package and silently passed, which is worse than not having it.
- `pnpm tauri` proxies to the shell's Tauri CLI.
- `pnpm tauri dev` must run `pnpm -w run dev`, not the shell's own `dev`. Tauri runs
  `beforeDevCommand` from `apps/shell`, where `dev` is only `vite` — that starts no
  broker and no bundle watcher, and the broker is what serves the client bundle, so
  the shell would have nothing to load.
- New functionality means editing `apps/client` directly. It has a `workspace:*`
  dependency on `@trellis/sdk` and default-exports
  `definePlugin({ Component })`. Add to `apps/client/server` only if the feature
  needs server-owned handlers — see "Backend" for when that applies.

### What `pnpm dev` actually starts

Three processes, and all three are needed — the shell alone loads nothing:

| Process | Port | Job |
|---|---|---|
| `@trellis/server` | 8787 | the broker; also serves both built frontends |
| `@trellis/client` | — | esbuild watcher rebuilding `dist/index.js` |
| `@trellis/shell` | 1420 | Vite dev server for the shell chrome |

Then `http://localhost:1420` for the browser shell against a dev build, or
`pnpm tauri dev` for the desktop one. `http://localhost:8787` serves the *built*
shell, which is what a real deployment looks like — so it only reflects your
changes after `pnpm build`.

A client-side edit is picked up by reloading the window: the esbuild watcher
rewrites the bundle and the shell re-fetches it. A change under
`apps/client/server/`, `apps/server/` or `apps/shell/` restarts or rebuilds its
own process instead.

### Tests

`pnpm test` runs everything. The runner is Node's built-in `node --test` via
`tsx` — no framework dependency, and TypeScript runs directly.

| Suite | Covers |
|---|---|
| `sdk/test/` | `parseChannel`, and `createRpcClient`'s streaming/unary split |
| `apps/server/test/rpcServer.test.ts` | RPC mechanics: streaming, cancellation, `finally` on cancel *and* disconnect, transport mismatch, duplicate callId |
| `apps/server/test/channelServer.test.ts` | Channel mechanics: snapshots, room isolation, publish hooks, `authorize` |
| `apps/server/test/app.test.ts` | The broker's own surface: health, traversal, prototype-member rejection, hostile identity claims, clean close |
| `apps/client/test/` | This app's own logic — store bounds and eviction |

Rules:

- **Broker tests must not reference the client app's methods or channels.**
  `apps/server/test/` mounts its *own* purpose-built specs and handler maps. The
  broker never learns what a "chat" is, so its tests must not either — otherwise
  a fork running `pnpm reset:client` deletes the demo and breaks the broker's
  suite along with it. That regression is exactly why these are split.
- **App-specific behaviour is tested in `apps/client/test/`,** and the reset
  script removes those files with the demo they cover.
- **Test the failure paths.** `NO_METHOD`, `SNAPSHOT_FAILED`, `NO_HANDLER`,
  `FORBIDDEN`, a rejected publish — these are tedious to reach by clicking and
  so are the first things to rot.
- **For anything realtime, test two clients and test a reconnect.** A
  single-window smoke test passes even when room membership or re-subscription
  is broken — which is how the reconnect bug survived in the first place.
- **Typecheck is not a test.** The specs make a missing handler or drifted
  payload a compile error, which catches structural mistakes but no behaviour.

## Deploying

`pnpm build` produces everything a deployment needs:

| Output | What it is |
|---|---|
| `apps/server/dist/index.js` | the broker — one file, run it with `node` |
| `apps/client/dist/index.js` | the client bundle, served at `/client/` |
| `apps/shell/dist/` | the browser shell, served at `/` |

```bash
VITE_TRELLIS_SERVER_URL=https://trellis.example.com pnpm build
node apps/server/dist/index.js          # PORT, ANTHROPIC_KEY, … from the env
```

The desktop CSP in `apps/shell/src-tauri/tauri.conf.json` allowlists that
example origin. A fork using another broker hostname must replace both the
HTTPS and WSS entries there as well as setting `VITE_TRELLIS_SERVER_URL`.
The browser shell stays same-origin and receives its CSP from `serveStatic`.

The broker is bundled by `apps/server/build.mjs` rather than emitted by `tsc`,
and that is not a style preference. `apps/server` imports `@trellis/client/server`
and `@trellis/sdk/realtime`, and both workspace packages ship TypeScript source —
their `exports` point at `.ts`. `tsc` passes those specifiers through untouched,
so the emitted JS died on `ERR_MODULE_NOT_FOUND` from a build that had just
reported success. The bundle inlines the workspace packages and leaves real npm
dependencies external, the same split `apps/client/build.mjs` makes.

Rules:

- **Shipping a client feature does not require redeploying the broker.** Rebuild
  `apps/client`, push `dist/` to wherever the broker serves it from, reload. That
  is the entire point of the architecture — see "What this is".
- **The desktop shell is the exception.** Its broker URL is baked in at build
  time, so pointing it somewhere new means a new build and a reinstall. The
  browser shell has no such step.
- **Set `VITE_TRELLIS_SERVER_URL` before building the shell,** not after. It is
  substituted into the bundle; there is nothing to configure at runtime.
- **Send SIGTERM, and give it a few seconds.** Anything that kills the process
  outright skips the stream cleanup described in "Backend".
- **Point health checks at `/healthz`.** It is answered before routing, so it
  works even if no frontend has been built into `dist/`.
- **Narrow CORS before exposing it.** `Access-Control-Allow-Origin: *` and
  socket.io's `origin: "*"` are dev defaults, in [app.ts](apps/server/src/app.ts).
- **There is still no authentication.** Anything that can reach the port can open
  a socket and claim any identity. Do not put this on an untrusted network — see
  the SECURITY note in [app.ts](apps/server/src/app.ts).

## Configuration

Configuration is **per app**, declared in the app that reads it:

| Where | Holds | Read at |
|---|---|---|
| [apps/server/src/config.ts](apps/server/src/config.ts) | `port`, provider secrets | broker startup, from `process.env` |
| [hosts/tauriHost.ts](apps/shell/src/hosts/tauriHost.ts) | `VITE_TRELLIS_SERVER_URL` | shell build, from `import.meta.env` |

**The broker's config file is the only one.** The shell needs exactly one
build-time value, read at its single point of use, so it has no config module —
a file exporting one constant was three hops of indirection for one string, and
it contradicted the rule that a new entry point means a new `main*.tsx` plus a
`hosts/*.ts` and nothing else.

**Nothing declared in the broker's config can reach a browser bundle**, because
`apps/shell` does not depend on `@trellis/server` — the import does not resolve.
That is a structural guarantee rather than a convention, and it is the reason
secrets live there and only there.

**Only the desktop entry needs the URL at all.** The browser entry uses
`window.location.origin` in both dev and production — see "Entry points".

**There is no `.env` file, deliberately.** It is a second place to look, it is
gitignored (so its contents are invisible to anyone reading the repo), and it
splits "declared here" from "valued there". Values come from the real process
environment, and a checkout with nothing exported works against a local broker:

```bash
ANTHROPIC_KEY=sk-…                       pnpm dev     # broker, runtime
VITE_TRELLIS_SERVER_URL=https://…        pnpm build   # shell, build time
```

Rules:

- **Add a value to the config of the app that reads it.** A `process.env` or
  `import.meta.env.VITE_*` read anywhere else is the bug — that is what these two
  files exist to prevent. Two things are *not* config and stay where they are:
  `import.meta.env.DEV`/`PROD` (Vite's build-mode flags, not values a deployment
  supplies) and `TAURI_DEV_HOST` in `vite.config.ts` (Tauri's own dev-server
  plumbing).
- **Secrets go in `apps/server/src/config.ts`, never the shell's.** Everything in
  the shell's config is compiled into a bundle served to every client.
- **Shell values must be `VITE_`-prefixed.** That prefix is Vite's own opt-in
  marker for "may be exposed to client code", so the prefix *is* the
  public/secret declaration, enforced by the bundler. Declare each one in
  [vite-env.d.ts](apps/shell/src/vite-env.d.ts) so a typo is a compile error,
  and read it at its point of use — don't reintroduce a config module for it.
- **A new `VITE_*` variable must be added to `turbo.json`'s `build.env` list.**
  It is part of the build's cache key; without it a cached build ships the
  previous deployment's value with no sign anything is wrong.
- **Use `requireSecret()`** for a secret a code path cannot run without. It fails
  naming the variable rather than letting `""` reach a provider and return an
  opaque 401.
- **`openaiKey`/`anthropicKey` are declared and unused.** They are the worked
  example of a value that must reach the broker and must never reach a bundle.

### Reaching a secret from a client-app handler

`apps/client/server/handlers/*` cannot import `apps/server/src/config.ts` — the
dependency arrow runs server → client, so the client app cannot name anything in
the broker. This is the same problem `publishToChannel` already solves: the
broker installs what it owns at mount time, and the handler imports a bridge.

When an `llm.*` handler actually lands, follow
[channelBridge.ts](apps/client/server/channelBridge.ts) — a module-level value
with a `setX()` the broker calls from `createApp`, and the composition root in
[apps/client/server/index.ts](apps/client/server/index.ts) exporting the setter.
Do not build that bridge before there is a handler that needs it, and do not
read `process.env` directly from a handler to dodge the problem — that puts a
declaration outside both config files.

## Client app — adding a screen

`apps/client` is the default home for new work and the only directory a fork is
expected to rewrite. It owns its UI *and* its server-side handlers; `apps/server`
just mounts the latter.

```
apps/client/
├── rpcSpec.ts          every RPC method, params and result      → #rpcSpec
├── channelSpec.ts      every channel family + `channels.*`      → #channelSpec
├── src/                the UI. index.tsx is the composition root
│   ├── index.tsx       definePlugin({ Component }) — the default export
│   ├── rpc.ts          the `rpc` singleton; initRpc(host) arms it
│   └── *Panel.tsx      one file per panel
└── server/             handlers, mounted by the broker           → #server/*
    ├── handlers/       one file per RPC prefix  — chat.* -> chatHandlers.ts
    └── channels/       one file per family      — chat   -> chatChannels.ts
```

### Import paths

**An import that climbs out of its own directory uses a `#` alias; a sibling
stays relative.**

```ts
import { rpcSpec } from "#rpcSpec";                     // not ../../rpcSpec.js
import { publishToChannel } from "#server/channelBridge.js";
import { ChatPanel } from "./ChatPanel";                // sibling — relative
```

The aliases are declared in `apps/client/package.json`'s `imports` field, which
is **Node's own subpath-imports mechanism**, not a TypeScript invention:

```json
"imports": {
  "#rpcSpec":      "./rpcSpec.ts",
  "#channelSpec":  "./channelSpec.ts",
  "#server/*":     "./server/*"
}
```

Rules:

- **Use `imports`, never tsconfig `paths`.** This code passes through four
  resolvers — `tsc` under `Bundler` (apps/client) *and* `NodeNext` (apps/server
  type-checking across the package boundary), esbuild (the bundle), and tsx (the
  broker loading `server/`). All four honour `imports` natively, with no plugin
  and no path-rewriting build step. `paths` is a type-checker fiction: `tsc`
  emits it verbatim and Node cannot resolve the result, so it would break the
  broker at runtime.
- **This is `apps/client` only.** `apps/shell` and `sdk` deliberately do not have
  it — forks merge from upstream there, and every avoidable diff is a future
  conflict (see README, "Forking and maintaining your fork"). `apps/server` has
  no climbing imports to fix.
- **Why it exists:** before this, `rpcSpec` was imported as `../rpcSpec.js` from
  nine files and `../../rpcSpec.js` from three, so no single grep found all its
  importers. One spelling per module is the point — path length was never the
  problem, since nothing climbed further than two levels.
- **Add an alias when something actually needs one**, not in advance. A `src/`
  tree that grows deep enough to climb wants `"#src/*": "./src/*"` — add that
  line then. Only the entries above earn their place today.
- **Keep the `.js` extension on wildcard imports** (`#server/chatStore.js`) —
  same NodeNext convention the rest of the repo uses. The two bare spec aliases
  map to their files directly and take none.

**To add a panel**, write the component and mount it in `src/index.tsx`:

```tsx
// src/ThingPanel.tsx
import type { PluginComponentProps } from "@trellis/sdk";
import { rpc } from "./rpc.js";

export const ThingPanel: React.FC<PluginComponentProps> = ({ host }) => {
  // Feature-detect: host APIs are optional, and the browser entry genuinely
  // has fewer of them than the desktop one.
  if (!host.realtime) return <p>No realtime transport on this host.</p>;
  …
};
```

```tsx
// src/index.tsx — add it to the fragment
<ThingPanel host={host} />
```

Rules:

- **Take `host` as a prop; never reach around it.** The client app must not
  import `@tauri-apps/*`, open a socket, or read `process.env`. Everything the
  shell offers arrives through `HostContext`, which is what keeps the client
  runnable on both entry points. Need something that isn't there? Add it to the
  SDK and implement it in the shell — see "Rules".
- **Feature-detect every host API** (`if (host.device)`). Fields are optional
  because implementations may not exist, and the browser host is smaller than
  the desktop one.
- **`rpc` is importable at module top level.** It is a Proxy; `initRpc(host)` in
  `index.tsx` arms it before render. Using it before that throws a named error
  rather than returning `undefined`.
- **Don't import `react-dom`** — see "Rules" for why it would silently bundle a
  second React.
- **Panels are plain components.** There is no registration step, no manifest,
  and no route table — mounting it in `index.tsx` is the whole wiring.

A panel that needs the backend adds a method to `rpcSpec.ts` (see "RPC") or a
family to `channelSpec.ts` (see "Channels"). Both specs are imported by the UI
*and* the handlers, so they must stay dependency-free — they describe the
surface; the socket lives in the shell.

## Backend

[apps/server](apps/server) is for state that is **global or shared** across clients,
which a single client's own Tauri process cannot provide. It is not a trust
boundary; `apps/client` and `apps/shell` are the same trust level, so it does not
exist to keep credentials out of the webview.

It does three things:

- **Serves both built frontends.** `serveStatic` in
  [app.ts](apps/server/src/app.ts) serves `apps/client/dist` under `/client/` and
  `apps/shell/dist` at the root, off one origin. Push a build to the server and
  every running shell picks it up on next load. Routing picks a root first and
  then resolves within it, so the traversal check runs against whichever root
  serves the request and neither is reachable from the other's prefix.
- **Brokers realtime and RPC.** Request/response plus room-scoped push, so clients
  can reach shared state and each other. See "RPC" and "Channels".
- **Accepts an unverified `identity:claim`.** A connected client sends
  `{ username, displayName }` once to attach it to its socket for server-side
  logging. Audit trail only — see the SECURITY note in
  [app.ts](apps/server/src/app.ts). Each field is flattened to one bounded,
  single-line token before it is logged: the claim is unauthenticated and the
  log is line-oriented, so a newline in it could otherwise forge entries.
- **Answers `/healthz` and shuts down cleanly.** The probe is served before any
  routing, so it stays true even with no frontend built. `createApp()` returns a
  `close()` that disconnects sockets *before* closing the listener — that order
  matters, because disconnecting is what runs each in-flight stream generator's
  `finally`. A process that just exits strands exactly the work cancellation
  exists to stop.

**Any state you keep here must be bounded.** The broker is long-lived and
`authorizeSubscribe` currently admits everyone, so an unbounded collection keyed
by something a client chooses is a memory-growth vector reachable by anyone.
[chatStore.ts](apps/client/server/chatStore.ts) is the worked example: reads
never allocate (its `historyFor` used to create-on-read, which runs on every
subscribe — so subscribing to `chat/<random>` in a loop grew memory without ever
sending a message), entries are capped per key *and* in number, and eviction is
least-recently-written. Cap both dimensions; capping only one is the easy miss.

**What does not belong here:** anything per-request/per-user with no fan-out.
`EmailApi`, `CalendarApi`, and `ContactsApi` calls are not shared state and should
be Tauri commands instead (`close_watch.rs` is the precedent for Rust doing real OS
and network work). Before adding to `apps/server`, ask whether the thing is actually
shared. If not, it is a Tauri command.

**The exception is anything the browser entry point also needs.** "Make it a Tauri
command" assumes every host has Tauri, and since the web SPA does not, a Tauri-only
implementation silently does not exist there — see "Entry points". That is why LLM
streaming is a **streaming RPC method** on the broker rather than a Tauri command,
despite being per-user with no fan-out. Fan-out is the usual test; "does it have to
work on both hosts" overrides it.

The broker is `node:http` + socket.io, everything on one namespace, `/socket`. It
was a FeathersJS app until Stage 3. Feathers was removed because service methods and
a per-event hook pipeline fit the planned work (CRDT-backed collaborative editing,
with high-frequency binary deltas and ephemeral presence traffic) badly. Do not
reintroduce a service/hook framework.

**No authentication exists anywhere in `apps/server`.** This is deliberate and
temporary. Nothing may assume a claimed identity is verified.

## RPC — adding and calling a backend method

This is the path for backend logic. The layout is: open the file named for the
method prefix and you see every method with that prefix. Use it rather than adding a
parallel mechanism.

| File | Role |
|---|---|
| [apps/client/rpcSpec.ts](apps/client/rpcSpec.ts) | The whole API surface. Every method, its params and result. |
| [apps/client/server/handlers/](apps/client/server/handlers/) | One file per prefix. `chat.*` → `chatHandlers.ts`. Logic goes directly in the handler. |
| [apps/client/server/rpcHandlers.ts](apps/client/server/rpcHandlers.ts) | Spreads the handler files into one map. `satisfies HandlerMap` proves the spec is covered. |
| [apps/client/src/rpc.ts](apps/client/src/rpc.ts) | Client singleton. `initRpc(host)` arms it; `rpc` is a Proxy, so other modules can import it at top level. |
| [sdk/src/rpc.ts](sdk/src/rpc.ts) | Generic machinery: `HandlerMap`, `HandlersFor`, `RpcStream`, `createRpcClient`. No domain types. |
| [apps/server/src/rpcServer.ts](apps/server/src/rpcServer.ts) | `mountRpc()` — dispatches the wire `request` and `request:stream` events to the handler map. |

**To add a method**, edit two files:

```ts
// 1. apps/client/rpcSpec.ts — `{} as X` because the spec is a real runtime value
//    (the client needs the key list to build rpc.chat.send) that also carries
//    every type via `typeof rpcSpec`.
"chat.rename": {
  params: {} as { roomId: string; name: string },
  result: {} as { ok: boolean },
},

// 2. apps/client/server/handlers/chatHandlers.ts — HandlersFor<_, "chat"> now
//    requires this key; the file will not compile until it is added.
"chat.rename": async ({ roomId, name }, ctx) => {
  if (typeof name !== "string" || !name.trim()) throw new Error("name is required");
  return { ok: true };
},
```

A new prefix means a new `<prefix>Handlers.ts` plus one spread line in
`rpcHandlers.ts`.

**To call it**, either form works; both are typed from the same spec:

```ts
import { rpc } from "./rpc";
await rpc.chat.rename({ roomId, name });         // namespaced
await rpc.call("chat.rename", { roomId, name }); // greppable string literal
```

Rules:

- **`HandlersFor<typeof rpcSpec, "chat">` slices the spec by prefix.** A handler
  file must implement its whole slice and nothing else, so spec and handlers cannot
  drift in either direction. Do not weaken this to `Partial`.
- **No `services/` layer.** Put logic in the handler. Extract only on real reuse. An
  earlier `services/` split was removed as indirection with no payoff.
- **Handlers take `(params, ctx)`,** where `ctx` is `{ identity, socketId }`. Most
  handlers ignore it. `identity` is client-claimed and unverified.
- **Validate params at runtime.** The spec types params but nothing enforces them on
  the wire.
- **Errors become acks, not transport throws.** Throwing from a handler rejects the
  caller's promise; `RpcError` in `rpcServer.ts` sets the error code.
- **Method lookup is own-properties-only.** `mountRpc` resolves handlers through
  `Object.hasOwn`, because the method name comes off the wire and the handler
  map is a plain object: a bare index would resolve `Object.prototype` members
  (`constructor`, `toString`, `valueOf`, `hasOwnProperty` are all functions) and
  dispatch them as handlers. Keep any new lookup guarded the same way.
- **No speculative types in `rpcSpec.ts`.** `result: {} as unknown` marks "real model
  goes here", and narrowing at the call site is the reminder.

### Streaming methods

A spec entry that declares **`chunk` is a streaming method**: many chunks, then one
terminal result. Everything else is unchanged, and unary methods are untouched.

```ts
// 1. rpcSpec.ts — `chunk` is what makes it stream
"llm.stream": {
  params: {} as { prompt: string },
  chunk:  {} as { text: string },
  result: {} as { stopReason: string },
},

// 2. the handler file — same HandlersFor slice, now an async generator
"llm.stream": async function* ({ prompt }, ctx) {
  try {
    for await (const token of provider(prompt)) yield { text: token };
    return { stopReason: "end_turn" };
  } finally {
    // runs on cancel — release the provider call here
  }
},
```

```ts
// calling it
const stream = rpc.llm.stream({ prompt });
for await (const chunk of stream) setText((t) => t + chunk.text);
const { stopReason } = await stream.result;   // `break` above cancels instead
```

Rules:

- **`chunk` in the spec is the single source of truth.** The types read it as
  `"chunk" extends keyof S[K]`; `createRpcClient` reads `"chunk" in spec[method]` at
  runtime. Never test it as `S[K] extends { chunk: any }` — with `chunk?: any` on
  the constraint every entry matches, and the streaming/unary split silently
  collapses so every method types as streaming.
- **The two transports don't mix, and say so.** A streaming method over `request`
  acks `IS_STREAMING`; a unary one over `request:stream` acks `NOT_STREAMING`.
  `rpc.call()` and `rpc.stream()` reject each other's methods at compile time too.
- **`result` is a separate promise, not a final chunk,** because `for await`
  discards a generator's return value.
- **Cancellation is real and must stay that way.** `break`, `cancel()`, or a
  disconnect all run the handler's `finally` server-side. Without it an abandoned
  call keeps burning provider tokens.
- **A stream cannot survive a reconnect** — server-side state is per-socket. Both
  sides end it with an error rather than hanging, the same failure mode the
  re-subscribe rule guards against.
- **The idle timeout is per-frame, not total** (`STREAM_IDLE_TIMEOUT_MS` in
  [realtimeHost.ts](apps/shell/src/realtimeHost.ts)). A total budget would kill the
  long generations streaming exists for. The 8s `ACK_TIMEOUT_MS` covers only the
  start ack.
- **socket.io has no backpressure.** A generator that outruns a slow consumer
  buffers in server memory; pace it in the handler.

## Channels — adding and handling one

Channels carry server→client push, plus snapshots and client publish. The layout
mirrors RPC: one file per family.

| File | Role |
|---|---|
| [apps/client/channelSpec.ts](apps/client/channelSpec.ts) | The whole channel surface. Every family, its event and snapshot types, and the `channels.*` room constructors. |
| [apps/client/server/channels/](apps/client/server/channels/) | One file per family. `chat` → `chatChannels.ts`. |
| [apps/client/server/channelHandlers.ts](apps/client/server/channelHandlers.ts) | Family → handlers map. `satisfies ChannelHandlerMap` proves the spec is covered. |
| [apps/client/server/channelBridge.ts](apps/client/server/channelBridge.ts) | `publishToChannel(channel, event)` — lets a handler fan out without holding a socket. |
| [apps/server/src/channelServer.ts](apps/server/src/channelServer.ts) | `mountChannels()` — rooms, wire events, dispatch. Counterpart to `rpcServer.ts`. |

**To add a family**, same two-file shape as RPC: an entry in `channelSpec.ts` plus
its constructor in `channels`, then
`server/channels/<family>Channels.ts` typed
`ChannelHandlersFor<TrellisChannels, "<family>">`. `channelHandlers.ts` will not
compile until the family has a handler entry.

```ts
// apps/client/server/channels/chatChannels.ts
export const chatChannels: ChannelHandlersFor<TrellisChannels, "chat"> = {
  snapshot: ({ id }) => historyFor(id!),   // returned by the subscribe ack
  // publish?: (ctx, event) => …           // omit → client publish gets NO_HANDLER
};
```

Rules:

- **Both hooks are optional; the family's entry is not.** A server-push-only family
  omits `publish` rather than defining a throwing stub. `satisfies ChannelHandlerMap`
  still catches a family declared in the spec with no handler file.
- **Fetch initial state through `snapshot`, not a separate RPC call.**
  `mountChannels` joins the room only after the snapshot resolves, so nothing
  published in between is missed. An RPC call for initial state reopens that gap.
- **Client `publish` is for traffic the server does not need to answer** — CRDT
  deltas, presence. Anything the server must stamp with an authoritative id, sender,
  or timestamp is an RPC method. That is why `chat` has no publish hook: sending is
  `rpc.chat.send`.
- **Address rooms with the `channels.*` constructor, never a template string.**
  `publishToChannel` takes a `Channel` descriptor so sender and subscriber derive the
  room name from one place.
- **`ErasedChannelHandlers.publish` takes `event: never` on purpose.** Handler params
  are contravariant, and `never` is what makes any typed `ChannelHandlerMap`
  assignable to the erased map the broker stores. The broker casts once, at the call
  site.
- **Errors become acks, not transport throws:** `SNAPSHOT_FAILED`, `PUBLISH_FAILED`,
  `NO_HANDLER`, `FORBIDDEN`.
- **`id` comes off the wire.** A snapshot provider validates it rather than trusting
  the type.

## Transport

The wire contract lives in [sdk/src/realtime.ts](sdk/src/realtime.ts). The event set
is small and closed: `subscribe`, `unsubscribe`, `publish`, `request`,
`identity:claim`, plus `event` server→client.

**The channel name is an argument, never the event name.** Encoding the room into
the event name (`socket.emit("matter/123", …)`) makes the socket untypeable. Each
layer is type-erased on the wire and restored above it, which confines casts to one
place per side.

- **The client app owns its server-side handlers, not just its UI.**
  `apps/client/server/index.ts` is a composition root that exports `rpcSpec` and
  `handlers`; `apps/server/src/app.ts` imports it via `@trellis/client/server` and
  mounts it. Generic contracts live in the SDK because `apps/server` depends on
  `apps/client`, so the dependency arrow cannot point back.
- **The broker stays minimal:** wire protocol, room membership, `identity:claim`,
  `mountRpc`, `mountChannels`. It never learns what a "matter" is.
- **`authorizeSubscribe` in [app.ts](apps/server/src/app.ts) currently returns `true`
  for everything.** It exists now because `matter/{matterId}` is where joining the
  wrong room would leak privileged material, and retrofitting the check across every
  caller later is far more work. Do not add code paths that bypass it. `publish` is
  gated through it for the same reason.
- **The shell re-subscribes on reconnect, and hands back the fresh snapshot**
  ([realtimeHost.ts](apps/shell/src/realtimeHost.ts)). A reconnect is a new socket
  server-side, so room membership and claimed identity are both gone. Without
  re-subscribing, RPC keeps working while subscriptions go dead silently, and a
  single-window smoke test still passes.

  Re-joining alone is not enough: nothing published during the gap is ever
  replayed as an `event`, so the re-subscribe's snapshot is the *only* way back
  to correct state. It reaches subscribers through `SubscribeOptions.onResync`
  — pass it from anything rendering accumulated state, usually the same
  id-keyed merge already applied to the initial snapshot. A subscriber whose
  state is purely derived from live events (presence, cursors) can omit it.
- **Acks time out after 8s.** socket.io buffers emits while disconnected and retries
  indefinitely, so without a timeout an unreachable broker leaves every call pending
  with no error.
- **The client app never constructs its own broker client.** The shell does, in
  `identityHost.ts` and `realtimeHost.ts`, and passes it through `HostContext`. This
  keeps `HostContext` the single seam, so the client app never needs the server's URL
  or transport. `rpcSpec.ts` and `channelSpec.ts` are imported by both the UI and the
  handlers, so they must stay dependency-free — they only describe the surface; the
  socket lives in the shell.
