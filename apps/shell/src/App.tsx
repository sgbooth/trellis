import { Suspense, useCallback, useMemo, useState } from "react";
import type { HostContext } from "@trellis/sdk";
import { clearPluginCache, loadPluginComponent } from "./pluginLoader";
import { PluginErrorBoundary } from "./PluginErrorBoundary";
import "./App.css";

/**
 * The chrome around the dynamically-loaded client app, shared by every entry
 * point. Deliberately presentational: it takes a fully-built HostContext
 * rather than constructing one, because *which* host it gets is the whole
 * difference between the desktop and browser entries (see src/hosts/). It
 * knows nothing about Tauri.
 */
export interface AppProps {
  /** Everything the entry point's host could construct, unscoped — apps/client
   *  and apps/shell are the same trust level, so there's no scoping step. */
  host: HostContext;
  /** Where the client bundle is fetched from; also the broker's origin. */
  serverUrl: string;
}

function App({ host, serverUrl }: AppProps) {
  // Bumped to retry a failed load. It is part of the memo key, so a retry
  // builds a *new* lazy component — re-rendering the old one would replay its
  // cached rejection without another request.
  const [attempt, setAttempt] = useState(0);

  // `attempt` is in the dep list deliberately, though the factory doesn't read
  // it: bumping it is the whole retry mechanism. (No linter here to object —
  // see CLAUDE.md's "Workflow".)
  const PluginComponent = useMemo(() => loadPluginComponent(serverUrl), [serverUrl, attempt]);

  const retry = useCallback(() => {
    clearPluginCache(serverUrl);
    setAttempt((n) => n + 1);
  }, [serverUrl]);

  return (
    <div className="app-root">
      {/* Keyed so a retry remounts the boundary with clean state, rather than
          leaving a stale error latched across the new attempt. */}
      <PluginErrorBoundary key={attempt} onRetry={retry}>
        <Suspense fallback={<p>Loading client app…</p>}>
          <PluginComponent host={host} />
        </Suspense>
      </PluginErrorBoundary>
    </div>
  );
}

export default App;
