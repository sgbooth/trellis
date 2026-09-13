/**
 * Everything the broker can be told by its environment, in one place.
 *
 * Scope is this app only — `apps/shell` has its own `src/config.ts` for the
 * build-time values it needs. That split is deliberate and is the security
 * boundary: the shell does not depend on `@trellis/server`, so nothing
 * declared in this file can reach a browser bundle even by mistake. A single
 * shared config module would have had to keep that boundary with a comment
 * instead.
 *
 * ## No `.env` file
 *
 * Deliberate. A `.env` is a second place to look, it is gitignored (so its
 * contents are invisible to anyone reading the repo), and it splits "declared
 * here" from "valued there". Values come from the real process environment:
 *
 *   ANTHROPIC_KEY=sk-… pnpm dev        # one run
 *   export ANTHROPIC_KEY=sk-…          # one shell
 *                                      # or systemd/launchd/CI secrets in prod
 *
 * Nothing stops a fork adding `.env` loading on top; the declarations stay
 * here either way.
 */

const env = (name: string, fallback = ""): string => process.env[name] ?? fallback;

export const serverConfig = {
  /**
   * Port the broker listens on. Also where `apps/shell` expects to find it —
   * the shell's default `SERVER_URL` names this same port, so changing one in
   * a real deployment means setting the other.
   */
  port: Number(env("PORT", "8787")),

  /**
   * Provider credentials for the LLM work described in "Backend" below — an
   * `llm.*` streaming RPC method on the broker rather than a Tauri command,
   * because it has to work on the browser host too.
   *
   * Declared and currently unused. They are the worked example of what this
   * file is for: a value that must reach the broker's Node process and must
   * never reach a bundle. Empty by default rather than a realistic-looking
   * fake, so "not configured" fails as a missing value instead of a confusing
   * 401 — see `requireSecret`.
   *
   * NOTE: the handlers that will consume these live in `apps/client/server`,
   * which cannot import from here — the dependency arrow runs server → client.
   * They reach it the way they reach the channel publisher: the broker installs
   * it at mount time. See `channelBridge.ts` for the existing pattern, and
   * CLAUDE.md's "Configuration" section.
   */
  openaiKey: env("OPENAI_KEY"),
  anthropicKey: env("ANTHROPIC_KEY"),
} as const;

/**
 * Reads a secret a code path genuinely cannot run without, failing with the
 * variable's name rather than letting an empty string reach a provider and come
 * back as an opaque auth error.
 *
 * ```ts
 * const key = requireSecret("ANTHROPIC_KEY", serverConfig.anthropicKey);
 * ```
 */
export function requireSecret(name: string, value: string): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Export it in the broker's environment; it is declared in apps/server/src/config.ts.`,
    );
  }
  return value;
}
