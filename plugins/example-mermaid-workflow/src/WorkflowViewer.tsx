import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import type { PluginComponentProps } from "@trellis/plugin-sdk";
import type { WorkflowState } from "@trellis/plugin-sdk";

let mermaidInitialized = false;

function ensureMermaidInitialized() {
  if (mermaidInitialized) return;
  mermaid.initialize({ startOnLoad: false, theme: "neutral" });
  mermaidInitialized = true;
}

function toMermaidSource(state: WorkflowState): string {
  const lines = ["flowchart TD"];
  for (const node of state.nodes) {
    const label = node.label.replace(/"/g, "'");
    lines.push(`  ${node.id}["${label}"]`);
  }
  for (const edge of state.edges) {
    const label = edge.label ? `|${edge.label.replace(/"/g, "'")}|` : "";
    lines.push(`  ${edge.from} -->${label} ${edge.to}`);
  }
  lines.push(`  class ${state.currentNodeId} active;`);
  lines.push("  classDef active fill:#2563eb,stroke:#1d4ed8,color:#fff,stroke-width:2px;");
  return lines.join("\n");
}

export function WorkflowViewer({ host }: PluginComponentProps) {
  const [state, setState] = useState<WorkflowState | null>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const renderCount = useRef(0);

  useEffect(() => {
    if (!host.workflow) return;
    let unsubscribed = false;

    host.workflow.getState().then((s) => {
      if (!unsubscribed) setState(s);
    });

    const unsubscribe = host.workflow.onChange((s) => {
      if (!unsubscribed) setState(s);
    });

    return () => {
      unsubscribed = true;
      unsubscribe();
    };
  }, [host.workflow]);

  useEffect(() => {
    if (!state) return;
    ensureMermaidInitialized();
    const id = `workflow-diagram-${renderCount.current++}`;
    mermaid
      .render(id, toMermaidSource(state))
      .then(({ svg }) => setSvg(svg))
      .catch((err) => setError(String(err)));
  }, [state]);

  if (!host.workflow) {
    return <p>This plugin requires the workflow:read capability, which was not granted.</p>;
  }

  if (error) {
    return <p role="alert">Failed to render workflow diagram: {error}</p>;
  }

  if (!state) {
    return <p>Loading workflow…</p>;
  }

  const availableTransitions = state.edges.filter((e) => e.from === state.currentNodeId);

  return (
    <div>
      <h2>Workflow</h2>
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      {host.workflow.transition && availableTransitions.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {availableTransitions.map((edge) => (
            <button
              key={edge.to}
              onClick={() => host.workflow!.transition(edge.to)}
            >
              {edge.label ?? `Move to ${edge.to}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
