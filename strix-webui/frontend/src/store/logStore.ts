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
    set((state) => ({ logs: [...state.logs, log] })),

  clearAll: () => set({ logs: [] }),
}));
