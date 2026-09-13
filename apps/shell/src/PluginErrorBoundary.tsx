import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /**
   * Invoked when the user asks to retry. The parent is responsible for
   * actually making a retry possible — resetting this boundary alone would
   * re-render the same rejected `React.lazy` and fail identically. See
   * `clearPluginCache` in pluginLoader.ts.
   */
  onRetry?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Catches failed bundle loads (fetched from apps/server) and render errors
 * from the dynamically loaded client app, so a bad bundle shows an error
 * instead of a blank or crashed shell. Error boundaries can't be function
 * components — must be a class.
 *
 * Offers a retry because the most likely failure here is transient and
 * external: the broker was briefly down, or a deploy replaced the bundle
 * mid-fetch. Without one, a momentary blip wedges the window until the user
 * knows to reload — an odd result for an app whose whole pitch is swapping
 * bundles underneath a running shell.
 */
export class PluginErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert">
        <p>Failed to load the client app: {error.message}</p>
        {this.props.onRetry && (
          <button
            type="button"
            onClick={() => {
              // Clear first: the parent's handler re-renders us, and a stale
              // error here would immediately re-trigger the fallback.
              this.setState({ error: null });
              this.props.onRetry?.();
            }}
          >
            Try again
          </button>
        )}
      </div>
    );
  }
}
