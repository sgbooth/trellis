import { serverConfig } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();

app.httpServer.listen(serverConfig.port, () =>
  console.log(`[server] listening on :${serverConfig.port}`),
);

/**
 * Shut down on the signals a supervisor actually sends. Without this, SIGTERM
 * kills the process outright and every in-flight streaming handler dies without
 * running its `finally` — which is the hook that releases provider calls, so a
 * redeploy would strand exactly the work cancellation exists to stop.
 *
 * A second signal exits immediately: if someone is pressing Ctrl-C again, they
 * want it gone, not a longer wait.
 */
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      console.log(`[server] ${signal} again — exiting now`);
      process.exit(130);
    }
    shuttingDown = true;
    console.log(`[server] ${signal} received, closing…`);
    void app.close().then(() => {
      console.log("[server] closed");
      process.exit(0);
    });
  });
}
