import { create } from "zustand";
import type { ToolExecution } from "../types";

interface ToolStore {
  tools: Map<string, ToolExecution>;
  selectedToolId: string | null;

  initTools: (tools: ToolExecution[]) => void;
  addTool: (tool: ToolExecution) => void;
  updateTool: (tool: ToolExecution) => void;
  setSelectedTool: (id: string | null) => void;
  clearAll: () => void;
}

export const useToolStore = create<ToolStore>((set) => ({
  tools: new Map(),
  selectedToolId: null,

  initTools: (tools) =>
    set({ tools: new Map(tools.map((t) => [t.id, t])) }),

  addTool: (tool) =>
    set((state) => {
      const next = new Map(state.tools);
      next.set(tool.id, tool);
      return { tools: next };
    }),

  updateTool: (tool) =>
    set((state) => {
      const next = new Map(state.tools);
      next.set(tool.id, tool);
      return { tools: next };
    }),

  setSelectedTool: (id) => set({ selectedToolId: id }),

  clearAll: () => set({ tools: new Map(), selectedToolId: null }),
}));
