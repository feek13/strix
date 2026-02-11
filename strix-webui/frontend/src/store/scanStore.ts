import { create } from "zustand";
import type { Scan } from "../types";

interface ScanStore {
  activeScan: Scan | null;
  scans: Scan[];
  setActiveScan: (scan: Scan | null) => void;
  updateScan: (updates: Partial<Scan> & { id: string }) => void;
  setScans: (scans: Scan[]) => void;
  addScan: (scan: Scan) => void;
  removeScan: (id: string) => void;
}

export const useScanStore = create<ScanStore>((set) => ({
  activeScan: null,
  scans: [],

  setActiveScan: (scan) => set({ activeScan: scan }),

  updateScan: (updates) =>
    set((state) => ({
      activeScan:
        state.activeScan?.id === updates.id
          ? { ...state.activeScan, ...updates }
          : state.activeScan,
      scans: state.scans.map((s) => (s.id === updates.id ? { ...s, ...updates } : s)),
    })),

  setScans: (scans) => set({ scans }),

  addScan: (scan) =>
    set((state) => ({ scans: [scan, ...state.scans], activeScan: scan })),

  removeScan: (id) =>
    set((state) => ({
      scans: state.scans.filter((s) => s.id !== id),
      activeScan: state.activeScan?.id === id ? null : state.activeScan,
    })),
}));
