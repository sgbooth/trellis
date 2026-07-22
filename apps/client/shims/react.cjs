// Aliased in place of "react" at build time (see ../build.mjs). Re-exports
// the one shared React instance the shell exposed on globalThis before
// loading this plugin, rather than bundling a duplicate copy — a duplicate
// React instance silently breaks hooks/context.
module.exports = globalThis.__trellisReact;
