import { create } from "zustand";
import type { Agent, AgentStatus } from "../types";

interface AgentStore {
  agents: Map<string, Agent>;
  selectedAgentId: string | null;

  initAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  updateAgentStatus: (id: string, status: AgentStatus, finishedAt?: string) => void;
  setSelectedAgent: (id: string | null) => void;
  clearAll: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: new Map(),
  selectedAgentId: null,

  initAgents: (agents) =>
    set({ agents: new Map(agents.map((a) => [a.id, a])) }),

  addAgent: (agent) =>
    set((state) => {
      const next = new Map(state.agents);
      next.set(agent.id, agent);
      return { agents: next };
    }),

  updateAgentStatus: (id, status, finishedAt) =>
    set((state) => {
      const agent = state.agents.get(id);
      if (!agent) return state;
      const next = new Map(state.agents);
      next.set(id, { ...agent, status, finishedAt: finishedAt || agent.finishedAt });
      return { agents: next };
    }),

  setSelectedAgent: (id) => set({ selectedAgentId: id }),

  clearAll: () => set({ agents: new Map(), selectedAgentId: null }),
}));
