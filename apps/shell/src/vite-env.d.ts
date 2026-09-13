/// <reference types="vite/client" />

/**
 * Build-time values the shell reads through `import.meta.env`. Declared so a
 * typo is a compile error rather than `undefined` at runtime.
 *
 * These are read in exactly one place — src/config.ts — which is what the rest
 * of the shell imports. See that file for why they are build-time and why
 * there is no `.env`.
 */
interface ImportMetaEnv {
  /** Broker origin baked into the bundle. See src/config.ts. */
  readonly VITE_TRELLIS_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
