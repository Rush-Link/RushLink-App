import { SunMoon } from "lucide-react";
import { useAppStore } from "../../stores/app-store";
import { Select } from "../ui";

/** Available before connecting, so appearance never depends on a device session. */
export function ThemeControl() {
  const theme = useAppStore(state => state.preferences.theme);
  const setPreference = useAppStore(state => state.setPreference);
  return <label className="theme-control"><span><SunMoon size={15} aria-hidden="true"/>Color mode</span><Select value={theme} aria-label="Color mode" onChange={event => setPreference("theme", event.target.value as typeof theme)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></Select></label>;
}
