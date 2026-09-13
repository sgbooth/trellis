# trellis
Trellis is a **bare scaffold for experimenting with building features in Tauri** — a desktop shell that dynamically loads a bespoke client app, fetched at runtime from a small companion server, so a new feature ships by rebuilding `apps/client`, pushing the build to the server, and reloading, no shell reinstall required. `apps/shell` and `apps/client` are built by the same team at the same trust level; there's no capability-sandboxing layer between them.

In practice: a team wants to try a feature idea in Tauri, you build it in `apps/client`, and it's live within the hour — no build pipeline for the shell, no app-store review, no shell release. Because the client app runs with full access to whatever `HostContext` the shell can construct, it can touch real user-space resources — local files, watched directories, native pickers, connected devices — the same way a native app would, not the sandboxed-away-from-everything model of a typical web app. The result behaves like an embedded, realtime local application per feature: fully dynamic and hot-swappable, without a shell-side capability review gating what it can do.

This is a launchpad, not the intended end state for a mature feature. It's deliberately quick and low-ceremony so a team can prove out whether a feature idea in Tauri is worth building at all, before paying for a proper shell of its own. Once a feature graduates from "experiment" to "real product people depend on," the expected path is to fork it out into its own standalone Tauri app — with its own release cycle, its own auth story, and no dependency on this scaffold's shared shell/server. Trellis intentionally doesn't try to be that end state itself (no code signing, no auth, no capability review — see below); building those in would defeat the point of having a fast, disposable place to experiment first.


## Getting started

Each deployment/team forks this repo and builds their own `apps/client` on top of the shared shell — see "Repo structure" below for why. To get going:

1. **Fork the repo.** On GitHub, fork `sgbooth/trellis` into your own account or org, then clone your fork:
   ```bash
   git clone https://github.com/<your-account>/trellis.git
   cd trellis
   git remote add upstream https://github.com/sgbooth/trellis.git
   ```
   `origin` points at your fork (where you push your work); `upstream` points at this repo (where you pull shell/SDK updates from).
2. **Install and run:**
   ```bash
   pnpm install
   pnpm dev
   ```
3. **Clear out the demo:**
   ```bash
   pnpm reset:client            # shows what it would do
   pnpm reset:client --write    # applies it
   ```
   This strips the bundled chat/peer/weather demo and leaves a minimal client that still builds and runs, keeping one trivial `app.ping` method so the spec → handler → call path stays wired end to end. The demo stays in git history (`git show HEAD:apps/client/<path>`) if you want it back as reference.
4. **Build your feature in `apps/client`** — that's the one directory meant to change per deployment (see `CLAUDE.md` for the full operating manual on what's real vs. not-yet-implemented).

`pnpm test` runs the suite (Node's built-in test runner — no framework dependency). `pnpm dev` starts all three pieces: the broker on `:8787`, the client-bundle watcher, and the shell's Vite server on `:1420`. Open `http://localhost:1420` for the browser shell, or run `pnpm tauri dev` for the desktop one. There is no `.env` to create — see "Configuration" below for how to point a build at a real broker.

## Forking and maintaining your fork

The point of forking rather than copying is that your fork keeps a live connection to this repo's shell/SDK — new Tauri commands, dependency bumps, security fixes — without you having to re-implement any of it. Your fork's own changes should live almost entirely in `apps/client` (see CLAUDE.md's "Shell changes" for the narrow set of legitimate `apps/shell` edits: new Tauri-exposed commands and security/dependency maintenance). Keeping `apps/shell`/`sdk` untouched (or minimally touched) is what keeps the merges below conflict-free.

### Staying up to date with upstream

To pull in shell/SDK changes from this repo without losing your fork's `apps/client` work:

```bash
git fetch upstream
git merge upstream/main
```

Resolve conflicts if your fork has touched shared files (`apps/shell`, `sdk`) — conflicts inside `apps/client` are expected only if you diverged from the example client rather than replacing it outright. Prefer `merge` over `rebase` here so shared history stays intact for anyone else tracking the same upstream.

If you'd rather review upstream changes before merging:

```bash
git fetch upstream
git log main..upstream/main   # see what's new
git diff main..upstream/main  # see the actual diff
```

Do this periodically even absent a specific feature need — upstream is also where Tauri version bumps and security patches to the shell will land.

### Versioning this repo

Trellis isn't distributed as an npm package — forks don't `npm install` it, they `git fetch`/`git merge` from `upstream` as above. So "releasing" a version means tagging a commit on this repo, not publishing anywhere:

```bash
git tag -a v0.2.0 -m "Shell: macOS close-watch support"
git push origin v0.2.0        # or upstream, if you're pushing to the shared repo
```

That gives forks a stable point to reference — "we're on `v0.1.0`, upstream is at `v0.3.0`, here's what changed" — via `git log v0.1.0..v0.3.0` or a GitHub Release page listing tags. Bump `version` in [tauri.conf.json](apps/shell/src-tauri/tauri.conf.json) (currently `0.1.0`) to match the tag; that field is also what shows up as the installed app's version once a fork builds a real installer. Follow semver by convention (breaking `HostContext`/`sdk` changes bump major, new host APIs bump minor, fixes bump patch) — nothing enforces it, it's just what makes the tags legible to forks deciding whether a merge is safe.

This only applies to versioning the scaffold itself. A `apps/client` feature that's graduated into its own standalone app (see "What this is" above) gets its own independent release story once it's out — that's unrelated to tags on this repo.

### Rebranding: app name, identifier, icon

Everything below lives in `apps/shell/src-tauri/` and is safe to change per-fork without creating upstream-merge conflicts, since upstream doesn't touch your branding:

- **App name and window title** — [tauri.conf.json](apps/shell/src-tauri/tauri.conf.json)'s `productName` and `app.windows[0].title` (both ship as `"Trellis"`), the `<title>` in `index.html` and `web.html`, and `authors`/`description` in [Cargo.toml](apps/shell/src-tauri/Cargo.toml).
- **Bundle identifier** — the same file's `identifier`, which ships as `dev.trellis.app`. **Change this before shipping a build to anyone**: it is what macOS and Windows use to tell your app apart from every other Tauri app on a machine, so two forks that both leave it alone will collide on a user's device.
- **Rust crate name** — optional, and internal rather than user-visible: `name`/`[lib] name` in `Cargo.toml` (`trellis`/`trellis_lib`) and the matching call in `src/main.rs`. Rename both together or it won't compile.
- **Icon** — replace the source artwork and regenerate the whole icon set (all the sizes under [icons/](apps/shell/src-tauri/icons)) rather than hand-editing individual PNGs:
  ```bash
  pnpm tauri icon path/to/your-icon.png   # wants a large (≥1024x1024) source image
  ```
  This regenerates everything `tauri.conf.json`'s `bundle.icon` list points at, plus the platform-specific sizes (`Square*Logo.png` for Windows Store, `icon.icns` for macOS, `icon.ico` for Windows) it doesn't explicitly list.

None of this affects `apps/client` or `sdk` — it's purely the shell's presentation, so it's the kind of change you make once per fork and rarely touch again.
## How it works

**The pitch, restated concretely:** ship a new feature by rebuilding `apps/client`, pushing it to the server, and reloading — no shell rebuild, no reinstall, no app-store-style release cycle. The value is deploy velocity, full stop; this project does not model or defend against a less-trusted plugin author.

## Architecture

```
apps/server (Node — node:http + socket.io, one namespace: /socket)
 - Serves apps/client's built bundle as static files under /client/, and
   apps/shell's browser build at the root — the real distribution
   mechanism, not a stub
 - Brokers RPC (request/response, plus streaming methods) and channels
   (room-scoped server→client push, snapshots, client publish)
 - Accepts an unverified identity claim, for audit logging only
 - Answers /healthz and shuts down cleanly on SIGTERM, disconnecting
   sockets first so in-flight stream handlers run their cleanup
 - Knows nothing domain-specific: apps/client owns the spec and the
   handlers, and the broker just mounts them

Tauri Host (Rust)
 - IPC commands (identity, device info, file-close detection, ...)

Webview (React host shell) — two entry points over one App
 - Desktop (index.html): identity from the OS, plus device/files APIs
 - Browser  (web.html):  identity typed once and kept in localStorage
 - React.lazy + Suspense fetches the client app from apps/server
 - Full HostContext passed through to the client app, unscoped — same
   trust level, no per-plugin grant system
```

It was a FeathersJS app until Stage 3. Feathers was removed because service methods and a per-event hook pipeline fit the planned work (CRDT-backed collaborative editing, with high-frequency binary deltas and ephemeral presence traffic) badly. Don't reintroduce a service/hook framework.

The client app is a user-facing app built entirely on top of whatever `HostContext` the shell can construct. There's no capability declaration or grant step — if the shell can build an API (files, identity, device info, realtime, etc.), the client app gets it.

## Host API surface (current)

`HostContext` (see `sdk/src/types.ts`) is a plain set of optional fields, each an interface (`FilesApi`, `ClipboardApi`, `SecretsApi`, `IdentityApi`, `RealtimeApi`, `LlmApi`, `EmailApi`, `CalendarApi`, `ContactsApi`, `DeviceApi`, `CameraApi`, `MicrophoneApi`, `NotificationsApi`). Fields are optional because the backing implementation may not be wired up yet, not because of any access grant — the client app should feature-detect (`if (host.device)`) rather than assume a field exists. The browser entry point genuinely has fewer of them than the desktop one, and that needs no extra mechanism.

Real today: `IdentityApi`, `DeviceApi`, `RealtimeApi`, and `FilesApi.open`/`onClosed` (Linux via inotify, macOS via libproc polling; Windows not implemented). Declared but not implemented: `FilesApi.read`/`write`/`watch`/`openDialog`, `LlmApi`, `ClipboardApi`, `SecretsApi`, `CameraApi`, `MicrophoneApi`, `NotificationsApi`, `EmailApi`, `CalendarApi`, `ContactsApi`.

**Adding a new one:** extend `sdk/src/types.ts` (a new interface + a field on `HostContext`), then wire the shell-side implementation. There's no allowlist or manifest entry to update. **`apps/server` is not a general place to route these** — it exists only for genuinely global/shared concerns (see CLAUDE.md's "Backend" section), and per-user/per-request calls like `EmailApi`/`CalendarApi`/`ContactsApi` aren't that. Those should be **direct Tauri Rust commands** instead — Rust already has full OS/network access, and `apps/shell/src-tauri/src/close_watch.rs` is the existing precedent for a command doing real OS-level work.

The exception is anything the browser entry also needs: "make it a Tauri command" assumes every host has Tauri, and the web SPA doesn't. That's why LLM streaming is planned as a **streaming RPC method** on the broker rather than a Tauri command, despite being per-user with no fan-out. Fan-out is the usual test; "does it have to work on both hosts" overrides it.

`system:shell-exec`-style raw command execution is still avoided — not because of a trust boundary, but because it's a bad API shape regardless of trust level; model the underlying need as a specific typed operation instead.

## Repo structure (pnpm + turborepo monorepo)

```
your-app/
├── apps/
│   ├── shell/                    # the Tauri app
│   │   ├── src-tauri/            # Rust: IPC commands
│   │   └── src/                  # host React app (shell chrome);
│   │                               main.tsx + mainWeb.tsx over one App
│   ├── server/                   # the broker: serves both built
│   │   └── src/                    frontends, mounts RPC + channels
│   └── client/                   # the bespoke client app for this
│       │                           deployment — the one thing that
│       │                           actually changes when a team builds
│       │                           their feature
│       ├── src/                  # its UI
│       ├── server/               # its server-owned handlers,   (#server/*)
│       │                           which apps/server mounts
│       ├── rpcSpec.ts            # every RPC method             (#rpcSpec)
│       └── channelSpec.ts        # every channel family         (#channelSpec)
└── sdk/                          # shared contract
    └── src/                        types.ts, definePlugin.ts,
                                    realtime.ts, rpc.ts
```

Each deployment (fork/checkout of this repo) has its own `apps/client` — that's the one thing that actually changes when a team builds their feature. Third-party client apps don't strictly need to live in this repo either — they just need `@trellis/sdk` (published to npm once external authors exist; workspace-only reference is fine until then). The SDK can also export reusable UI components (not just types/`definePlugin`) for a new client app to start from — see `TrellisInfo`.

## Shared contract (`sdk`)

```typescript
interface HostContext {
  files?: { read, write, watch, onClosed, openDialog, open };  // optional —
  clipboard?: { read, write };                                 // undefined
  secrets?: { read, write };                                   // if that
  identity?: { get };                                          // API isn't
  realtime?: { call, stream, subscribe, publish };             // wired up
  llm?: { invoke };                                            // yet, not
  email?: { send };                                            // because of
  calendar?: { list, create };                                 // a grant
  contacts?: { search };
  device?: { get };
  camera?: { capture };
  microphone?: { record };
  notifications?: { send };
}

// thin helper for client authors — just type-checking, no logic
function definePlugin(mod: { Component }): PluginModule
```

There is no `PluginManifest`. One existed, carrying an id, a version and an `sdkVersion` range — but the loader discarded it and nothing ever checked the range, so it was a contract in name only. If a real version handshake is wanted later, it belongs in the loader, where it can actually refuse to mount an incompatible bundle.

The client build must not bundle its own React: `apps/client/build.mjs` aliases `react` and `react/jsx-runtime` to shims that re-export the single instance the shell publishes on `globalThis`. The classic footgun is a duplicate React instance breaking hooks/context silently. Note `react-dom` is **not** aliased and `apps/client` must not import it — see CLAUDE.md's "Rules" for what to do if a client genuinely needs it.

`@trellis/sdk/realtime` and `@trellis/sdk/rpc` are React-free subpaths, so the Node broker can import the wire contract and the RPC machinery without dragging React in.

## Backend surface: RPC and channels

Two mechanisms, same layout — the spec lives in `apps/client`, one handler file per prefix/family, and the broker stays domain-free:

- **RPC** (`apps/client/rpcSpec.ts`) is request/response. A spec entry that declares `chunk` is instead a **streaming** method: an `async function*` handler yielding many chunks then one terminal result, with real cancellation — `break`, `cancel()` or a disconnect all run the handler's `finally`, which is what stops a server burning provider tokens for a caller that walked away.
- **Channels** (`apps/client/channelSpec.ts`) carry room-scoped server→client push, plus a snapshot returned by the subscribe ack and an optional client publish hook. Initial state comes from the snapshot rather than a separate RPC call, because the broker joins the room only after the snapshot resolves — fetching it independently reopens the gap where a message falls between the two.

See CLAUDE.md's "RPC" and "Channels" sections for the step-by-step of adding either.

## Configuration

Configuration is per app, declared in the app that reads it — there is nothing to configure outside `apps/`:

| Where | Holds | Read at |
|---|---|---|
| `apps/server/src/config.ts` | port, provider secrets | broker startup, from `process.env` |
| `apps/shell/src/hosts/tauriHost.ts` | broker URL | shell build, from `import.meta.env.VITE_*` |

The broker's config file is the only one — the shell needs a single build-time value (and only its desktop entry does; the browser entry uses `window.location.origin` in both dev and production), so it reads it at its point of use rather than through a config module.

That separation is a security boundary rather than just tidiness: `apps/shell` doesn't depend on `@trellis/server`, so nothing declared in the broker's config can reach a browser bundle — the import doesn't resolve.

There is deliberately **no `.env` file**, and none is needed — Vite reads `VITE_`-prefixed variables straight from the process environment, and a checkout with nothing exported works against a local broker:

```bash
ANTHROPIC_KEY=sk-…                pnpm dev      # broker, at runtime
VITE_TRELLIS_SERVER_URL=https://… pnpm build    # shell, at build time
```

See CLAUDE.md's "Configuration" section for the rules that keep the boundary intact.

## Import aliases

`apps/client` uses Node's `imports` field for anything that climbs out of its own directory — `#rpcSpec` rather than `../../rpcSpec.js` — so each module has exactly one spelling wherever it's imported from. It's set up ready for a fork's own tree to grow.

This is `apps/client` only, by design: `apps/shell` and `sdk` stay on plain relative paths because forks merge from upstream there, and every avoidable diff is a future conflict. Note it uses Node's own `imports` mechanism rather than tsconfig `paths` — the client's code is resolved by four different toolchains (tsc twice, esbuild, tsx) and only `imports` works in all of them without a build-rewriting step. See CLAUDE.md's "Import paths".

## Deploying

`pnpm build` produces everything a deployment needs — the broker as a single runnable file, plus both frontends for it to serve:

```bash
VITE_TRELLIS_SERVER_URL=https://trellis.example.com pnpm build
node apps/server/dist/index.js          # PORT, ANTHROPIC_KEY, … from the env
```

The desktop CSP allowlists that example broker origin in
`apps/shell/src-tauri/tauri.conf.json`. Replace both its HTTPS and WSS entries
when a fork chooses a real broker hostname; changing only
`VITE_TRELLIS_SERVER_URL` will leave the webview correctly blocking the new
origin. The browser shell is same-origin and receives its CSP from the broker.

| Output | What it is |
|---|---|
| `apps/server/dist/index.js` | the broker — run it with `node` |
| `apps/client/dist/index.js` | the client bundle, served at `/client/` |
| `apps/shell/dist/` | the browser shell, served at `/` |

After that, **shipping a client feature doesn't redeploy the broker**: rebuild `apps/client`, push its `dist/` to where the broker serves it, reload. That's the whole point of the architecture. The desktop shell is the one exception — its broker URL is baked in at build time, so moving it needs a rebuild and reinstall.

Health checks go to `/healthz` (answered before routing, so it works even with no frontend built). Send SIGTERM to stop it and allow a few seconds; killing the process outright skips the cleanup that releases in-flight streaming handlers.

See CLAUDE.md's "Deploying" for the details, including why the broker is bundled rather than emitted by `tsc`.

### Caveats

- No code signing, no capability allowlist, no plugin registry — the
  client app is trusted the same as the shell.
- **No authentication exists anywhere.** The identity a client claims is
  unverified and used only for audit logging; `authorizeSubscribe` in
  `apps/server/src/app.ts` currently returns `true` for everything. This
  is deliberate and temporary — a real auth story is a graduate-out
  concern, not something to build into the scaffold.
- No auto-updater is built for the shell binary itself. This was
  explicitly considered and explicitly deferred — bundle drops via
  `apps/server` cover client-app feature velocity without one; revisit
  if shell-level (Rust/Tauri) changes start needing to ship without a
  manual reinstall.
- `apps/server` exists, but only for global/shared concerns (bundle
  distribution, realtime/RPC brokering, and a shared audit trail) — it
  is not a general backend for arbitrary per-request integrations. See
  CLAUDE.md's "Backend" section for the test to apply, and for the one
  case ("does it have to work on the browser host too?") that overrides
  it.
- CORS is wide open by default (`origin: "*"` for both socket.io and
  static serving). Narrow it before putting the broker anywhere
  reachable.
- Server-side state is in-memory, so a restart drops it. Anything you
  keep there must also be **bounded** — the broker is long-lived and
  admits everyone, so an unbounded collection keyed by something a
  client picks is a memory-growth vector. See CLAUDE.md's "Backend".
