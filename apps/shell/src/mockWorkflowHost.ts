import type { WorkflowApi, WorkflowState } from "@trellis/plugin-sdk";

/**
 * Phase 1 stand-in for the Rust-backed workflow capability. Replaced by a
 * real Tauri IPC-backed implementation once the capability registry lands
 * (Phase 3+); the plugin-facing WorkflowApi shape doesn't change.
 */
export function createMockWorkflowApi(): WorkflowApi {
  let state: WorkflowState = {
    currentNodeId: "intake",
    nodes: [
      { id: "intake", label: "Intake" },
      { id: "review", label: "Review" },
      { id: "revise", label: "Revise" },
      { id: "approved", label: "Approved" },
    ],
    edges: [
      { from: "intake", to: "review", label: "submit" },
      { from: "review", to: "approved", label: "approve" },
      { from: "review", to: "revise", label: "request changes" },
      { from: "revise", to: "review", label: "resubmit" },
    ],
  };

  const listeners = new Set<(state: WorkflowState) => void>();

  return {
    async getState() {
      return state;
    },
    async transition(toNodeId: string) {
      const valid = state.edges.some(
        (e) => e.from === state.currentNodeId && e.to === toNodeId,
      );
      if (!valid) {
        throw new Error(`No transition from ${state.currentNodeId} to ${toNodeId}`);
      }
      state = { ...state, currentNodeId: toNodeId };
      for (const listener of listeners) listener(state);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
