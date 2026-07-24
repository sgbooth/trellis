import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches failed bundle loads (fetched from apps/server) / render errors
 * from the dynamically loaded plugin, so a bad bundle shows an error
 * instead of a blank/crashed shell. Error boundaries can't be function
 * components — must be a class.
 */
export class PluginErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <p role="alert">Failed to load plugin: {this.state.error.message}</p>;
    }
    return this.props.children;
  }
}
