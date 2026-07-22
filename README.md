# trellis
A Tauri desktop shell deployed internally that hot-loads plugins (signed, sandboxed ES modules) without requiring a shell reinstall or a new IT security review per feature.
IT/security reviews the shell's fixed capability surface once. New functionality ships as plugins consuming that surface, not as shell updates.

In practice: a team needs a feature, you build it, and it's live for them within the hour — no build pipeline, no app-store review, no shell release. Because plugins run inside the shell's reviewed capability surface rather than a browser tab, they can touch real user-space resources — local files, watched directories, native pickers, connected devices — the same way a native app would, not the sandboxed-away-from-everything model of a typical web app. The result behaves like an embedded, realtime local application per feature: fully dynamic, hot-swappable, and disposable, without carrying the cost (or risk) normally attached to that level of access.


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
3. **Build your feature in `apps/client`** — that's the one directory meant to change per deployment (see `CLAUDE.md` for the full operating manual on what's real vs. not-yet-implemented at the current build phase).

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

# Project Summary: Capability-Gated Plugin Shell (Tauri)


A Tauri desktop shell deployed internally that hot-loads plugins, which are signed, sandboxed ES modules, without
requiring a shell reinstall or a new IT security review per feature.
IT/security reviews the shell's fixed capability surface once; new
functionality ships as plugins consuming that surface, not as shell
updates.

**Primary pitch:** solves the actual friction that slows legal-tech
adoption — the security/procurement review cycle — by decoupling
feature velocity from the reviewed trust boundary. Frames as a
governance model ("practice groups build their own tools within a
boundary security already approved"), not just an engineering trick.

## Architecture

```
Tauri Host (Rust)
 - Fixed capability set (declared once, reviewed once)
 - Custom asset protocol (plugin://...)
 - Signature verification (ed25519; internal deployment allows a
   delegated-signer chain — root key held by IT, delegated keys
   issued to practice groups/individuals)
 - Plugin manifest registry

Webview (React host shell)
 - React.lazy + Suspense per plugin
 - Shared context passed to plugins: file API, database/secrets
   access, LLM proxy, etc. — scoped to only the capabilities that
   plugin declared and was granted
```

Plugins are user-facing apps built entirely on top of the shell's
fixed capability verbs. They don't add capabilities — they consume a
subset of what already exists, the same way an iOS app requests
existing OS permissions rather than inventing new ones.

## Capability set (v1)

Modeled as **verbs on resource types** — the manifest just declares
which verbs a plugin wants, as a flat list (no parameters baked into
the enum or the manifest) — this is what keeps the capability list
stable as plugins grow in number and variety.

**Where scoping actually lives:** not in `PluginManifest`. Capabilities
backed by a real Tauri plugin (files, network, database, secrets,
camera, mic) get their fine-grained restriction from **Tauri's own
`capabilities/*.json` permission system** — glob path patterns,
`$HOME`/`$APPDATA`-style path variables, allowed-origin lists — the
exact mechanism already granting `opener:default` today
(`apps/shell/src-tauri/capabilities/default.json`). Our own allowlist
(`allowed-capabilities.json`) only answers the coarse question: does
this deployment's client app get the capability *at all*. The table
below describes what each capability's Tauri-side scope would restrict
once it's actually implemented — it's descriptive of intent, not a
field `PluginManifest` carries. Don't invent a second scoping syntax
alongside the one Tauri already has.

| Capability | Scoping parameter (enforced via Tauri's own capability file, once implemented) |
|---|---|
| `files:read` | path prefix / allowed directory list |
| `files:write` | same |
| `files:watch` | separate from read — subscription, own resource cost |
| `files:open-dialog` | none — native picker, no blanket read access needed |
| `files:open-file` | none for v1; could restrict to an allowed-path-prefix later like files:read. Real (tauri-plugin-opener), not just declared |
| `network:fetch` | allowed domain list (internal hostnames for internal deployment) |
| `llm:invoke` | unscoped for v1; consider model-tier/maxTokens param later |
| `clipboard:read` | — |
| `clipboard:write` | split from read; read is higher trust |
| `database:query` | local DB file/scope (tauri-plugin-sql) |
| `secrets:read` | key prefix / namespace (tauri-plugin-stronghold) |
| `secrets:write` | split from read; write is lower trust, read is higher — same rationale as clipboard |
| `media:camera` | OS-level permission prompt, separate integration surface |
| `media:microphone` | same as camera |
| `notifications:send` | — |
| `custom:invoke` | named, host-registered function ID — escape hatch for anything unanticipated |

**Deferred to later versions:** long-lived network connections beyond
`chat:invoke` — `chat:invoke` is the one concrete instance today (a
broker-relayed connection), but it's still the *only* consumer, so a
generic capability (scoping by service? room? something else?) is
deferred until a second real need shows up to model its shape against.
A connector-invoke-style capability (external system integrations, e.g. iManage)
and a workflow-state capability were both cut from v1 for the same
reason plus one more — connector because there's no real connector to
model its shape against yet, workflow because it turned out to be an
app-specific business concept, not a system-level resource like the
rest of this table.
**Avoid entirely if possible:** `system:shell-exec` — undermines the
sandboxing story if granted broadly.

**Design test for the enum:** five unrelated plugin ideas (time
tracker, billing tracker, client-comms summarizer, doc-comparison
tool, calendar sync) should all be expressible as combinations of
existing verbs. If one forces a new capability, that's a signal
either the verb was too narrow or the plugin needs trust you should
think hard about granting.

## Repo structure (pnpm + turborepo monorepo)

```
your-app/
├── apps/
│   ├── shell/                    # the Tauri app
│   │   ├── src-tauri/            # Rust: capability enforcement, protocol
│   │   │   handler, signature verification, IPC commands
│   │   └── src/                  # host React app (shell chrome)
│   ├── server/                   # the core broker (identity/audit,
│   │   │                           provisional llm stub)
│   │   └── src/
│   └── client/                   # the bespoke plugin app for this
│       │                           deployment — client UI + optional
│       │                           server-owned endpoint (apps/client/server)
│       ├── src/
│       └── server/
└── sdk/                          # shared contract
    └── src/types.ts, definePlugin.ts
```

Each deployment (fork/checkout of this repo) has its own `apps/client` — that's the one thing that actually changes when a team builds their feature. Third-party client apps don't strictly need to live in this repo either — they just need `@yourthing/sdk` (published to npm once external authors exist; workspace-only reference is fine until then). The SDK can also export reusable UI components (not just types/`definePlugin`) for a new client app to start from — see `TrellisInfo`.

## Shared contract (`sdk`)

```typescript
type Capability =
  | 'files:read' | 'files:write' | 'files:watch' | 'files:open-dialog' | 'files:open-file'
  | 'network:fetch' | 'llm:invoke'
  | 'clipboard:read' | 'clipboard:write'
  | 'database:query' | 'secrets:read' | 'secrets:write'
  | 'media:camera' | 'media:microphone' | 'notifications:send'
  | 'custom:invoke';

interface PluginManifest {
  id: string;
  version: string;
  sdkVersion: string;       // semver range plugin was built against
  entry: string;
  capabilities: Capability[];
  signature: string;        // ed25519 sig over hash(manifest + entry file)
}

interface HostContext {
  files?: { read, write, watch, openDialog, open };   // optional — undefined
  llm?: { invoke };                                   // if capability
  clipboard?: { read, write };                        // wasn't granted
  database?: { query };
  secrets?: { read, write };
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

1. **Static shell** — fixed capabilities, one hardcoded plugin, prove
   the props contract makes sense
2. **Local dynamic loading** — plugin as folder + custom protocol +
   `React.lazy`, no signing yet
3. **Manifest + capability declarations** — Rust checks requested
   capabilities against allowlist, constructs scoped `HostContext`
4. **Signing/verification** — ed25519, reject before any JS executes
5. **Distribution** — manifest-of-manifests, internal artifact
   server/network share for local deployment (no public CDN needed)
6. **Real product wiring** — the app in `apps/client` becomes real
   product functionality; file/chat/versioning becomes the core
   capability surface it consumes

## Internal deployment notes

- Distributed via existing MDM (Jamf/Intune), not app stores
- Delegated signing: IT holds root key, issues signing keys to
  practice groups — central security controls *who* can sign, not
  *what* gets built
- `network:fetch` allowlists are firm-internal hostnames, easier to
  audit than arbitrary external domains
- Still need a shell updater — just far less frequently, since
  feature velocity moves to plugin drops instead of shell releases