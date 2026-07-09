import { definePlugin } from "@trellis/plugin-sdk";
import { WorkflowViewer } from "./WorkflowViewer";

export default definePlugin({
  manifest: {
    id: "example-mermaid-workflow",
    name: "Workflow Viewer",
    version: "0.1.0",
    sdkVersion: "^0.1.0",
    entry: "index.tsx",
    capabilities: ["workflow:read", "workflow:transition"],
  },
  Component: WorkflowViewer,
});
