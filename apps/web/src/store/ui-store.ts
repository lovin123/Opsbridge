"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  organizationId: string | null;
  sidebarOpen: boolean;
  setOrganizationId: (organizationId: string | null) => void;
  setSidebarOpen: (sidebarOpen: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      organizationId: null,
      sidebarOpen: false,
      setOrganizationId: (organizationId) => set({ organizationId }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    { name: "opsbridge-ui", partialize: (state) => ({ organizationId: state.organizationId }) },
  ),
);
