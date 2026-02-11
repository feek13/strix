import { create } from "zustand";
import type { LogEntry } from "../types";

interface LogStore {
  logs: LogEntry[];

  initLogs: (logs: LogEntry[]) => void;
  addLog: (log: LogEntry) => void;
  clearAll: () => void;
}

export const useLogStore = create<LogStore>((set) => ({
  logs: [],

  initLogs: (logs) => set({ logs }),

  addLog: (log) =>
    set((state) => {
      const logs = [...state.logs, log];
      // Cap at 5000 entries to prevent unbounded memory growth
      return { logs: logs.length > 5000 ? logs.slice(-5000) : logs };
    }),

  clearAll: () => set({ logs: [] }),
}));
