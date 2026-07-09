import { useMemo } from "react";
import type { HostContext } from "@trellis/plugin-sdk";
import ExampleMermaidWorkflow from "@trellis/example-mermaid-workflow";
import { createMockWorkflowApi } from "./mockWorkflowHost";
import "./App.css";

function App() {
  // Phase 1: one hardcoded plugin, statically imported, to prove the
  // HostContext props contract before dynamic loading (Phase 2) exists.
  const host: HostContext = useMemo(
    () => ({
      workflow: createMockWorkflowApi(),
    }),
    [],
  );

  const { Component: PluginComponent, manifest } = ExampleMermaidWorkflow;

  return (
    <main className="container">
      <header>
        <h1>Trellis</h1>
        <p className="plugin-label">
          Plugin: {manifest.name} ({manifest.id}@{manifest.version}) — capabilities:{" "}
          {manifest.capabilities.join(", ")}
        </p>
      </header>
      <section className="plugin-panel">
        <PluginComponent host={host} />
      </section>
    </main>
  );
}

export default App;
