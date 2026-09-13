import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const brokerUrl =
  process.env.VITE_TRELLIS_SERVER_URL ?? process.env.TRELLIS_SERVER_URL ?? `http://localhost:${process.env.PORT ?? "8787"}`;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_TRELLIS_SERVER_URL": JSON.stringify(brokerUrl),
  },

  // Two entry points over one App: index.html is what Tauri's window loads
  // (frontendDist: "../dist"), web.html is what the broker serves to
  // browsers. Dev needs no config — vite serves any .html in the root — but
  // the build only emits what's listed here.
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("index.html", import.meta.url)),
        web: fileURLToPath(new URL("web.html", import.meta.url)),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,

    // Makes the dev server look like the broker, so the browser entry can use
    // `window.location.origin` in dev exactly as it does in production (where
    // the broker really does serve it). Without this the entry needs a
    // `DEV ? … : …` branch, and dev stops exercising the same code path as
    // prod — which is where this class of bug hides.
    //
    // NOTE the key is `/socket.io`, socket.io's HTTP transport path — NOT the
    // `/socket` namespace, which is an application-level name inside the
    // payload and never appears in a request path. Proxying `/socket` would
    // silently forward nothing. `ws: true` is what carries the upgrade to a
    // real WebSocket rather than leaving it stuck on long-polling.
    proxy: {
      "/socket.io": { target: brokerUrl, ws: true },
      "/client": brokerUrl,
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
