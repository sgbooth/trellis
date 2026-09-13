#!/usr/bin/env node
/**
 * Strips the demo app out of apps/client, leaving a minimal client that still
 * builds, runs, and demonstrates one complete spec → handler → call path.
 *
 * Run once per fork, then start building. The demo files are committed
 * upstream, so anything here is recoverable with `git show HEAD:<path>` or by
 * browsing the upstream repo — nothing is lost, it just stops being in your way.
 *
 *   pnpm reset:client            # show what would change
 *   pnpm reset:client --write    # actually do it
 */
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(ROOT, "apps", "client");
const write = process.argv.includes("--write");

const DELETE = [
  "src/ChatPanel.tsx",
  "src/PeerPanel.tsx",
  "src/WeatherPanel.tsx",
  "src/peers.ts",
  "server/handlers/chatHandlers.ts",
  "server/handlers/peerHandlers.ts",
  "server/handlers/weatherHandlers.ts",
  "server/channels/chatChannels.ts",
  "server/channels/peerChannels.ts",
  "server/chatStore.ts",
  "server/peerStore.ts",
  "test/stores.test.ts",
];

// One trivial method survives, so every wiring file stays present and
// non-empty. An empty spec teaches nothing and invites deleting the structure
// rather than filling it in.
const FILES = {
  "rpcSpec.ts": `/**
 * Every RPC method in this deployment, in one place.
 *
 * Method names are \`<prefix>.<verb>\`, and the prefix maps to exactly one
 * handler file: every \`app.*\` is implemented in
 * \`server/handlers/appHandlers.ts\`. Read this file for the API surface; open
 * the matching handler file for the implementation.
 *
 * \`{} as X\` rather than a plain type: this is a real runtime value (the client
 * needs the key list to build \`rpc.app.ping(...)\`) that also carries every type
 * via \`typeof rpcSpec\`.
 *
 * Keep this file free of runtime dependencies. It is bundled into the browser
 * by esbuild *and* loaded under Node by the broker.
 */

export const rpcSpec = {
  //! app
  /** Replace me. Here to keep the spec → handler → call path wired end to end. */
  "app.ping": {
    params: {} as Record<string, never>,
    result: {} as { ok: true },
  },
};
`,
  "channelSpec.ts": `import { channel } from "@trellis/sdk/realtime";
import type { Channel } from "@trellis/sdk/realtime";

/**
 * Every channel family in this deployment, in one place — the channel
 * counterpart to rpcSpec.ts.
 *
 * A family maps to exactly one handler file: everything for \`thing\` would be
 * implemented in \`server/channels/thingChannels.ts\`. Adding a family here makes
 * \`server/channelHandlers.ts\` fail to compile until it has an entry.
 *
 * Empty to start. Add a family when you have server→client push to carry; use
 * RPC for anything the server must answer or stamp. See CLAUDE.md's "Channels".
 */

export type TrellisChannels = Record<string, never>;

// Constructors, not string constants, so an id segment is a typed required
// argument. Example, once you have a family:
//
//   export const channels = {
//     thing: (id: string) => channel<ThingEvent, ThingSnapshot>(\`thing/\${id}\`),
//   };
export const channels = {} as Record<string, (id?: string) => Channel<unknown, unknown>>;
`,
  "server/handlers/appHandlers.ts": `import type { HandlersFor } from "@trellis/sdk/rpc";
import type { rpcSpec } from "#rpcSpec";

/**
 * Every \`app.*\` method. \`HandlersFor\` requires this file to implement the whole
 * \`app.*\` slice of the spec and nothing else, so the spec and the handlers
 * cannot drift in either direction.
 *
 * Put logic directly in the handler — there is no services/ layer. Extract only
 * on real reuse.
 */
export const appHandlers: HandlersFor<typeof rpcSpec, "app"> = {
  // Handlers take (params, ctx). \`ctx\` is { identity, socketId }; \`identity\` is
  // client-claimed and UNVERIFIED — audit trail only, never authorization.
  // Validate params at runtime: the spec types the caller, the wire enforces
  // nothing.
  "app.ping": async () => ({ ok: true }),
};
`,
  "server/rpcHandlers.ts": `import type { HandlerMap } from "@trellis/sdk/rpc";
import { rpcSpec } from "#rpcSpec";
import { appHandlers } from "./handlers/appHandlers.js";

/**
 * Every handler file, spread into one flat map. The \`satisfies\` is what
 * guarantees the whole spec is covered — a method in rpcSpec.ts with no handler
 * fails here, at compile time.
 *
 * A new method prefix means a new \`<prefix>Handlers.ts\` plus one spread line.
 */
export const handlers = {
  ...appHandlers,
} satisfies HandlerMap<typeof rpcSpec>;
`,
  "server/channelHandlers.ts": `import type { ChannelHandlerMap } from "@trellis/sdk/realtime";
import type { TrellisChannels } from "#channelSpec";

/**
 * Every channel family's handlers, keyed by family. The \`satisfies\` guarantees
 * the spec is covered — a family in channelSpec.ts with no entry here fails at
 * compile time, exactly as rpcHandlers.ts does for methods.
 *
 * Empty while channelSpec.ts declares no families.
 */
export const channelHandlers = {} satisfies ChannelHandlerMap<TrellisChannels>;
`,
  "src/index.tsx": `import { definePlugin, TrellisInfo } from "@trellis/sdk";
import type { PluginComponentProps } from "@trellis/sdk";
import { initRpc } from "./rpc.js";

/**
 * This deployment's client app. Everything user-facing goes here or in a
 * sibling component — see CLAUDE.md's "Client app — adding a screen".
 *
 * TrellisInfo is the SDK's domain-free starter (identity + device). Replace it
 * with your own panels as you build.
 */
const Component: React.FC<PluginComponentProps> = ({ host }) => {
  // Arms the \`rpc\` singleton before anything can call it. Synchronous and
  // idempotent, so it's safe to run during render rather than in an effect.
  initRpc(host);

  return (
    <>
      <TrellisInfo host={host} />
    </>
  );
};

export default definePlugin({ Component });
`,
};

const changes = [];
for (const file of DELETE) {
  if (existsSync(join(CLIENT, file))) changes.push(["delete", file]);
}
for (const file of Object.keys(FILES)) {
  const path = join(CLIENT, file);
  if (!existsSync(path) || readFileSync(path, "utf8") !== FILES[file]) changes.push(["rewrite", file]);
}

if (changes.length === 0) {
  console.log("Already reset — nothing to do.");
  process.exit(0);
}

for (const [action, file] of changes) {
  console.log(`  ${action.padEnd(8)} apps/client/${file}`);
}

if (!write) {
  console.log(`\n${changes.length} change(s). Nothing written — re-run with --write to apply.`);
  console.log("The demo files stay in git history: git show HEAD:apps/client/<path>");
  process.exit(0);
}

for (const [action, file] of changes) {
  const path = join(CLIENT, file);
  if (action === "delete") {
    rmSync(path, { force: true });
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, FILES[file]);
  }
}

console.log(`\nDone — ${changes.length} change(s) applied to ${relative(ROOT, CLIENT)}.`);
console.log("Next: pnpm typecheck && pnpm test, then start building in apps/client.");
