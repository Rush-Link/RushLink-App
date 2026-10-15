export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "system" ? value : "dark";
}

export function resolveTheme(preference: unknown, systemDark: boolean): ResolvedTheme {
  const theme = normalizeThemePreference(preference);
  return theme === "system" ? systemDark ? "dark" : "light" : theme;
}
