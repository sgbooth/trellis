# trellis
A Tauri desktop shell deployed internally that hot-loads plugins (signed, sandboxed ES modules) without requiring a shell reinstall or a new IT security review per feature.
IT/security reviews the shell's fixed capability surface once. New functionality ships as plugins consuming that surface, not as shell updates.

In practice: a team needs a feature, you build it, and it's live for them within the hour — no build pipeline, no app-store review, no shell release. Because plugins run inside the shell's reviewed capability surface rather than a browser tab, they can touch real user-space resources — local files, watched directories, native pickers, connected devices — the same way a native app would, not the sandboxed-away-from-everything model of a typical web app. The result behaves like an embedded, realtime local application per feature: fully dynamic, hot-swappable, and disposable, without carrying the cost (or risk) normally attached to that level of access.


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
 - Shared context passed to plugins: file API, workflow state,
   LLM proxy, etc. — scoped to only the capabilities that plugin
   declared and was granted
```

Plugins are user-facing apps built entirely on top of the shell's
fixed capability verbs. They don't add capabilities — they consume a
subset of what already exists, the same way an iOS app requests
existing OS permissions rather than inventing new ones.

## Capability set (v1)

Modeled as **verbs on resource types**, scoped by parameters in the
plugin manifest (not baked into the enum) — this is what keeps the
capability list stable as plugins grow in number and variety.

| Capability | Scoping parameter |
|---|---|
| `files:read` | path prefix / allowed directory list |
| `files:write` | same |
| `files:watch` | separate from read — subscription, own resource cost |
| `files:open-dialog` | none — native picker, no blanket read access needed |
| `connector:invoke` | connector ID + allowed actions (e.g. iManage checkout/checkin) — new connectors added via shell-side registry, not new capabilities |
| `network:fetch` | allowed domain list (internal hostnames for internal deployment) |
| `llm:invoke` | unscoped for v1; consider model-tier/maxTokens param later |
| `clipboard:read` | — |
| `clipboard:write` | split from read; read is higher trust |
| `workflow:read` | — |
| `workflow:transition` | — |
| `custom:invoke` | named, host-registered function ID — escape hatch for anything unanticipated |

**Deferred to later versions:** `media:camera`, `media:microphone`
(OS-level permission prompts, separate integration surface),
`notifications:send` (low risk, add when needed), and long-lived network connections.
**Avoid entirely if possible:** `system:shell-exec` — undermines the
sandboxing story if granted broadly.

**Design test for the enum:** five unrelated plugin ideas (workflow
viewer, billing tracker, client-comms summarizer, doc-comparison
tool, calendar sync) should all be expressible as combinations of
existing verbs. If one forces a new capability, that's a signal
either the verb was too narrow or the plugin needs trust you should
think hard about granting.

## Repo structure (pnpm + turborepo monorepo)

```
your-app/
├── apps/
│   └── shell/                    # Project 1 — the Tauri app
│       ├── src-tauri/            # Rust: plugin registry, protocol
│       │   handler, signature verification, IPC commands
│       └── src/                  # host React app (shell chrome)
├── packages/
│   └── plugin-sdk/                # Project 3 — shared contract
│       └── src/types.ts, definePlugin.ts
└── plugins/
    └── example-mermaid-workflow/  # Project 2 — a plugin (one of many)
```

Third-party/future plugins don't need to live in this repo — they
just need `@yourthing/plugin-sdk` (published to npm once external
plugin authors exist; workspace-only reference is fine until then).

## Shared contract (`plugin-sdk`)

```typescript
type Capability =
  | 'files:read' | 'files:write' | 'files:watch' | 'files:open-dialog'
  | 'connector:invoke' | 'network:fetch' | 'llm:invoke'
  | 'clipboard:read' | 'clipboard:write'
  | 'workflow:read' | 'workflow:transition'
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
  files?: { read, write, watch, openDialog... };   // optional — undefined
  workflow?: { getState, transition, onChange };    // if capability
  llm?: { invoke };                                 // wasn't granted
  clipboard?: { read, write };
  connector?: { invoke };
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
6. **Real product wiring** — Mermaid workflow viewer becomes the
   first real plugin; file/chat/versioning becomes the core capability
   surface other plugins consume

## First reference plugin: Mermaid workflow viewer

Renders current workflow diagram, highlights active node via
`host.workflow.getState()`, lets user trigger valid transitions.
Uses only `workflow:read` + `workflow:transition` — good first plugin
because it exercises the capability-scoping model without touching
files, network, or LLM.

## Internal deployment notes

- Distributed via existing MDM (Jamf/Intune), not app stores
- Delegated signing: IT holds root key, issues signing keys to
  practice groups — central security controls *who* can sign, not
  *what* gets built
- `network:fetch` allowlists are firm-internal hostnames, easier to
  audit than arbitrary external domains
- Still need a shell updater — just far less frequently, since
  feature velocity moves to plugin drops instead of shell releases