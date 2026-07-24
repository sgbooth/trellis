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
3. **Build your feature in `apps/client`** — that's the one directory meant to change per deployment (see `CLAUDE.md` for the full operating manual on what's real vs. not-yet-implemented).

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

# Project Summary: Dynamically-Loaded Client Shell (Tauri)

A Tauri desktop shell that dynamically loads a bespoke client app fetched at runtime from a small companion server, without requiring a shell reinstall per feature. `apps/shell` and `apps/client` are built by the same team at the same trust level — there is no capability-review boundary between them, and no signing/sandboxing story to maintain.

**Primary pitch:** ship a new feature by rebuilding `apps/client`, pushing it to the server, and reloading — no shell rebuild, no reinstall, no app-store-style release cycle. The value is deploy velocity, full stop; this project does not model or defend against a less-trusted plugin author.

> **Earlier design history:** this project originally modeled `apps/client` as a less-trusted, signed/sandboxed plugin, reviewed once by IT against a fixed capability surface, loaded via a custom Rust `plugin://` protocol reading a local dev-time path (see the "Build phases" section below for what that looked like). The `Capability` enum, the Rust-enforced allowlist, and ed25519 signing were built out and then deliberately retired once it became clear the actual org structure doesn't have a less-trusted team to sandbox against. The FeatherJS server (`apps/server`) briefly went with it too, then came back for a different reason — see CLAUDE.md's "Backend" section — it's no longer a trust boundary, just where genuinely shared/global things live (bundle distribution, and later broadcast-style features). `CLAUDE.md` is the authoritative, current description of the architecture; this file has been updated to match.

## Architecture

```
apps/server (Node, FeatherJS)
 - Serves apps/client's built bundle as static files — the real
   distribution mechanism, not a stub
 - Shared identity/audit service
 - Slot for future global/shared features (broadcast, chat) and any
   server-owned endpoint the client app needs

Tauri Host (Rust)
 - IPC commands (identity, device info, file-close detection, ...)

Webview (React host shell)
 - React.lazy + Suspense fetches the client app from apps/server
 - Full HostContext passed through to the client app, unscoped — same
   trust level, no per-plugin grant system
```

The client app is a user-facing app built entirely on top of whatever `HostContext` the shell can construct. There's no capability declaration or grant step — if the shell can build an API (files, identity, device info, etc.), the client app gets it.

## Host API surface (current)

`HostContext` (see `sdk/src/types.ts`) is a plain set of optional fields, each an interface (`FilesApi`, `ClipboardApi`, `SecretsApi`, `IdentityApi`, `LlmApi`, `EmailApi`, `CalendarApi`, `ContactsApi`, `DeviceApi`, `CameraApi`, `MicrophoneApi`, `NotificationsApi`). Fields are optional because the backing implementation may not be wired up yet, not because of any access grant — the client app should feature-detect (`if (host.device)`) rather than assume a field exists.

Most of these are declared but not yet implemented: `FilesApi.read`/`write`/`watch`/`openDialog`, `LlmApi`, `ClipboardApi`, `SecretsApi`, `CameraApi`, `MicrophoneApi`, `NotificationsApi`, `EmailApi`, `CalendarApi`, `ContactsApi`. `FilesApi.open`/`onClosed` (Linux only so far) and the identity/device APIs are real.

**Adding a new one:** extend `sdk/src/types.ts` (a new interface + a field on `HostContext`), then wire the shell-side implementation. There's no allowlist or manifest entry to update. **`apps/server` is not a general place to route these** — it exists only for genuinely global/shared concerns (see CLAUDE.md's "Backend" section), and per-user/per-request calls like `LlmApi`/`EmailApi`/`CalendarApi`/`ContactsApi` aren't that. Those should be **direct Tauri Rust commands** instead — Rust already has full OS/network access, and `apps/shell/src-tauri/src/close_watch.rs` is the existing precedent for a command doing real OS-level work.

`system:shell-exec`-style raw command execution is still avoided — not because of a trust boundary, but because it's a bad API shape regardless of trust level; model the underlying need as a specific typed operation instead.

## Repo structure (pnpm + turborepo monorepo)

```
your-app/
├── apps/
│   ├── shell/                    # the Tauri app
│   │   ├── src-tauri/            # Rust: IPC commands
│   │   └── src/                  # host React app (shell chrome)
│   ├── server/                   # FeatherJS: serves apps/client's built
│   │   │                           bundle, shared identity/audit service
│   │   └── src/
│   └── client/                   # the bespoke client app for this
│       │                           deployment — the one thing that
│       │                           actually changes when a team builds
│       │                           their feature; optionally owns a
│       │                           server-side endpoint (apps/client/server)
│       ├── src/
│       └── server/
└── sdk/                          # shared contract
    └── src/types.ts, definePlugin.ts
```

Each deployment (fork/checkout of this repo) has its own `apps/client` — that's the one thing that actually changes when a team builds their feature. Third-party client apps don't strictly need to live in this repo either — they just need `@yourthing/sdk` (published to npm once external authors exist; workspace-only reference is fine until then). The SDK can also export reusable UI components (not just types/`definePlugin`) for a new client app to start from — see `TrellisInfo`.

## Shared contract (`sdk`)

```typescript
interface PluginManifest {
  id: string;
  version: string;
  sdkVersion: string;       // semver range plugin was built against
  entry: string;
}

interface HostContext {
  files?: { read, write, watch, onClosed, openDialog, open };  // optional —
  clipboard?: { read, write };                                 // undefined
  secrets?: { read, write };                                   // if that
  identity?: { get };                                          // API isn't
  llm?: { invoke };                                            // wired up
  email?: { send };                                            // yet, not
  calendar?: { list, create };                                 // because of
  contacts?: { search };                                       // a grant
  device?: { get };
  camera?: { capture };
  microphone?: { record };
  notifications?: { send };
}

// thin helper for plugin authors — just type-checking, no logic
function definePlugin(mod: { manifest, Component }): PluginModule
```

Plugin build config must externalize `react`/`react-dom`/
`react/jsx-runtime` (host provides these at runtime) — the classic
footgun is a duplicate React instance breaking hooks/context
silently.

## Build phases

1. **Static shell** — one hardcoded client app, prove the props
   contract makes sense
2. **Local dynamic loading** — client app as a built folder served over
   a custom Rust `plugin://` protocol + `React.lazy`, reading a
   dev-time-only local path
3. ~~Manifest + capability declarations~~ / ~~Signing/verification~~ —
   built out in full, then retired: these existed to support a
   less-trusted-plugin-author threat model that doesn't describe this
   project's actual team structure. Not planned; would be a fresh design
   question if that ever changes.
4. **Real distribution** — `apps/server` serves the built bundle over
   HTTP instead of the shell reading a local path; the client app fetches
   it directly. This is real, current state, and unrelated to the
   retired signing/capability items above — it's a plain static-file
   server, not a signed/verified artifact registry.
5. **Real product wiring** — the app in `apps/client` becomes real
   product functionality; per-user host APIs it needs get built as
   direct Tauri Rust commands, and any genuinely global/shared feature
   (broadcast, chat) gets added to `apps/server`
6. **Graduation** — once a client-app feature has proven itself, it
   forks out of this scaffold into its own standalone Tauri app with
   its own shell, release cycle, and (if it needs one) real
   authentication. This scaffold is intentionally not built to be that
   end state — it stays a fast, disposable place to experiment with the
   next idea.

## Deployment notes

- No code signing, no capability allowlist, no plugin registry — the
  client app is trusted the same as the shell.
- No auto-updater is built for the shell binary itself. This was
  explicitly considered and explicitly deferred — bundle drops via
  `apps/server` cover client-app feature velocity without one; revisit
  if shell-level (Rust/Tauri) changes start needing to ship without a
  manual reinstall.
- `apps/server` exists, but only for global/shared concerns (bundle
  distribution, a shared identity/audit service, and future
  broadcast-style features) — it is not a general backend for arbitrary
  per-request integrations. See CLAUDE.md's "Backend" section for the
  test of what belongs there vs. as a direct Tauri command.