import { createContext, useContext } from "react";
import { useAppStore } from "../../stores/app-store";

export interface ShellNavigationState {
  collapsed: boolean;
  toggle: () => void;
}

export const ShellNavigationContext = createContext<ShellNavigationState | null>(null);

export function useShellNavigation(): ShellNavigationState {
  const navigation = useContext(ShellNavigationContext);
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  const toggle = useAppStore((state) => state.toggleSidebar);
  return navigation ?? { collapsed, toggle };
}
